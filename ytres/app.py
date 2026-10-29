"""YouTube Music catalog and bounded internal stream resolver."""
import logging
import os
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor, wait
import math
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.exceptions import RequestValidationError
import requests
from ytmusicapi import YTMusic

from resolver import Resolver, ResolutionError

# One line per resolve (code and duration only; no URLs or titles) so failures are visible in
# `docker logs ytres`. uvicorn itself stays at warning level.
_log_handler = logging.StreamHandler()
_log_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
logging.getLogger("ytres").addHandler(_log_handler)
logging.getLogger("ytres").setLevel(os.environ.get("YTRES_LOG_LEVEL", "INFO"))

class TimedSession(requests.Session):
    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", (3, 6))
        return super().request(method, url, **kwargs)


app = FastAPI(title="Sidewave resolver", version="1.0.0")
_ytm = YTMusic(requests_session=TimedSession())
_ytm_kilit = threading.Lock()
_resolver = Resolver(timeout=float(os.environ.get("RESOLVE_TIMEOUT_SECONDS", "12")))
# Broad search is opt-in. Limit both work and response time; stalled catalog
# requests must not create an unbounded number of background threads.
_catalog_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="catalog-search")
_catalog_slots = threading.BoundedSemaphore(8)
_BROAD_SEARCH_SECONDS = 6.5


@app.middleware("http")
async def request_context(request: Request, call_next):
    supplied = request.headers.get("x-request-id", "")
    request.state.request_id = supplied if len(supplied) <= 80 and supplied.isascii() and supplied.replace("-", "").replace("_", "").isalnum() else str(uuid.uuid4())
    response = await call_next(request)
    response.headers["x-request-id"] = request.state.request_id
    response.headers["cache-control"] = "no-store"
    return response


@app.exception_handler(ResolutionError)
async def resolution_error(request: Request, error: ResolutionError):
    return JSONResponse(status_code=error.status, content=error.payload(request.state.request_id))


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    safe = ResolutionError("INVALID_REQUEST", "İstek parametreleri geçersiz.", 400)
    return JSONResponse(status_code=400, content=safe.payload(request.state.request_id))


@app.exception_handler(HTTPException)
async def http_error(request: Request, error: HTTPException):
    safe = ResolutionError("INVALID_REQUEST", str(error.detail) if error.status_code < 500 else "İstek tamamlanamadı.", error.status_code)
    return JSONResponse(status_code=error.status_code, content=safe.payload(request.state.request_id))


def _catalog_error():
    return ResolutionError("CATALOG_UNAVAILABLE", "Çevrimiçi kataloğa şu anda ulaşılamıyor.", 502, True)


def _ytm_yenile():
    global _ytm
    with _ytm_kilit:
        _ytm = YTMusic(requests_session=TimedSession())
    return _ytm


@app.get("/saglik")
def saglik():
    stats = _resolver.status()
    return {"ok": True, "onbellek": stats["cache"], "resolver": stats,
            "source": {"state": "unverified", "message": "Servis sağlığı, sağlayıcının içerik sunabildiği anlamına gelmez."}}


@app.get("/metrics", response_class=PlainTextResponse)
def metrics():
    stats = _resolver.status()
    return "\n".join([
        "# TYPE ytres_resolution_total counter",
        f'ytres_resolution_total{{outcome="success"}} {stats["resolved"]}',
        f'ytres_resolution_total{{outcome="error"}} {stats["failed"]}',
        "# TYPE ytres_cache_hits_total counter", f'ytres_cache_hits_total {stats["cacheHits"]}',
        "# TYPE ytres_inflight gauge", f'ytres_inflight {stats["inflight"]}',
        "# TYPE ytres_queue gauge", f'ytres_queue {stats["queued"]}', "",
    ])


def _catalog_item(item):
    artists = item.get("artists") or []
    first = artists[0] if artists else {}
    # Top artist cards use artists[0], without a top-level browseId or name.
    artist_card = item.get("resultType") == "artist"
    identifier = item.get("browseId") or (first.get("id") if artist_card else None)
    name = item.get("artist") or item.get("title") or (first.get("name") if artist_card else None)
    if not identifier or not name:
        return None
    thumbs = item.get("thumbnails") or []
    return {"id": identifier, "browseId": identifier, "ad": name, "baslik": name,
            "sanatci": ", ".join(a.get("name", "") for a in artists),
            "yil": item.get("year"), "kapak": thumbs[-1].get("url") if thumbs else None}


def _catalog_submit(query, category):
    slots = _catalog_slots
    if not slots.acquire(blocking=False):
        result = Future()
        result.set_exception(_catalog_error())
        return result
    try:
        search = _ytm.search
        # Pinned ytmusicapi returns the complete initial shelf even at limit=1;
        # this prevents continuation requests. Unfiltered search is one page.
        future = _catalog_pool.submit(search, query, filter=category, limit=1)
    except Exception:
        slots.release()
        raise
    future.add_done_callback(lambda _: slots.release())
    return future


def _broad_search(query, limit):
    jobs = {"songs": _catalog_submit(query, "songs"), "general": _catalog_submit(query, None)}
    done, pending = wait(jobs.values(), timeout=_BROAD_SEARCH_SECONDS)
    for future in pending:
        future.cancel()
    results, errors = {}, {}
    for name, future in jobs.items():
        try:
            if future not in done:
                raise TimeoutError()
            results[name] = future.result()[:100]
        except Exception:
            errors[name] = "Şarkı aramasına ulaşılamıyor." if name == "songs" else "Geniş katalog aramasına ulaşılamıyor."
    if not results:
        raise _catalog_error()

    primary = {}
    for raw in results.get("songs", []):
        if track := _parca_bicimle(raw):
            primary.setdefault(track["id"], track)
    additional, artists, artist_ids = {}, [], set()
    for raw in results.get("general", []):
        kind, video_type = raw.get("resultType"), raw.get("videoType")
        if kind == "artist":
            artist = _catalog_item(raw)
            if artist and artist["id"] not in artist_ids:
                artist_ids.add(artist["id"])
                artists.append(artist)
        # Never blend community uploads, playlists or podcasts into songs.
        # Keep full titles and provider identities, including live/remix names.
        official = video_type in {"MUSIC_VIDEO_TYPE_ATV", "MUSIC_VIDEO_TYPE_OMV"}
        if not ((kind == "song" and (not video_type or official)) or (kind == "video" and official)):
            continue
        track = _parca_bicimle(raw)
        if track and track["id"] not in primary and len(additional) < 8:
            additional.setdefault(track["id"], track)
    # Retain new top-result recordings before applying the requested result
    # limit; otherwise a full song shelf would discard every recall improvement.
    return {"sonuclar": [*additional.values(), *primary.values()][:limit],
            "sanatcilar": artists[:10], "hata": errors}


@app.get("/ara")
def ara(q: str, limit: int = Query(20, ge=1, le=50), type: Literal["songs", "albums", "artists"] = "songs", broad: bool = False):
    if not q.strip():
        return {"sonuclar": []}
    if type == "songs" and broad:
        return _broad_search(q.strip()[:500], limit)
    try:
        ham = _ytm.search(q.strip()[:500], filter=type, limit=limit)
    except Exception:
        try:
            ham = _ytm_yenile().search(q.strip()[:500], filter=type, limit=limit)
        except Exception:
            raise _catalog_error() from None
    if type == "songs":
        out = [p for s in ham if (p := _parca_bicimle(s))]
    else:
        out = [p for item in ham if (p := _catalog_item({"resultType": type[:-1], **item}))]
    return {"sonuclar": out[:limit]}


def _duration(t):
    value = t.get("duration_seconds")
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0:
        return value
    parts = str(t.get("duration") or "").split(":")
    if len(parts) not in (2, 3) or not all(part.isdigit() for part in parts):
        return None
    values = [int(part) for part in parts]
    if any(value >= 60 for value in values[1:]):
        return None
    seconds = 0
    for value in values:
        seconds = seconds * 60 + value
    return seconds or None


def _parca_bicimle(t: dict) -> dict | None:
    """ytmusicapi parca sozlugunu arayuzun bekledigi sekle cevir."""
    vid = t.get("videoId")
    if not vid:
        return None
    alb = t.get("album")
    if isinstance(alb, dict):
        alb = alb.get("name")
    kapaklar = t.get("thumbnails") or []
    artists = t.get("artists") or ([{"name": t["artist"]}] if isinstance(t.get("artist"), str) else [])
    return {
        "id": vid,
        "baslik": t.get("title"),
        "sanatci": ", ".join(a["name"] for a in artists if a.get("name")),
        "album": alb,
        "albumId": t.get("album", {}).get("id") if isinstance(t.get("album"), dict) else None,
        "sanatcilar": [{"ad": a.get("name"), "id": a.get("id")} for a in artists],
        "sure": _duration(t),
        "kapak": kapaklar[-1]["url"] if kapaklar else None,
    }


@app.get("/charts")
def charts(ulke: str = "TR"):
    """Gercek YouTube Music listeleri: trend sanatcilar + trend parcalar.

    NOT: Turkiye icin get_charts 'tracks' anahtari DONDURMUYOR — sadece
    sanatcilar ve calma listesi baglantilari var. Parcalar bu yuzden
    listenin ilk calma listesinden (Trending 20) cekiliyor.
    """
    try:
        c = _ytm.get_charts(ulke)
    except Exception:
        try:
            c = _ytm_yenile().get_charts(ulke)
        except Exception as e:
            raise _catalog_error() from None

    sanatcilar = []
    for a in (c.get("artists") or [])[:12]:
        kapaklar = a.get("thumbnails") or []
        sanatcilar.append({
            "ad": a.get("title"),
            "browseId": a.get("browseId"),
            "abone": a.get("subscribers"),
            "sira": a.get("rank"),
            "trend": a.get("trend"),
            "kapak": kapaklar[-1]["url"] if kapaklar else None,
        })

    parcalar = []
    vids = c.get("videos") or []
    if vids:
        try:
            pl = _ytm.get_playlist(vids[0]["playlistId"], limit=20)
            for t in (pl.get("tracks") or []):
                p = _parca_bicimle(t)
                if p:
                    parcalar.append(p)
        except Exception:
            pass  # calma listesi cekilemezse sanatcilarla devam et

    return {"sanatcilar": sanatcilar, "parcalar": parcalar}


@app.get("/sanatci")
def sanatci(browseId: str):
    """YouTube sanatci sayfasi — trend cemberlerine tiklaninca acilir.

    Kutuphanedeki sanatci sayfasiyla ayni sekli dondurur ki arayuz tek
    bilesenle ikisini de gosterebilsin.
    """
    try:
        a = _ytm.get_artist(browseId)
    except Exception:
        try:
            a = _ytm_yenile().get_artist(browseId)
        except Exception as e:
            raise _catalog_error() from None

    parcalar = []
    for t in ((a.get("songs") or {}).get("results") or [])[:20]:
        if not t.get("artists") and not t.get("artist"):
            t = {**t, "artists": [{"name": a.get("name"), "id": browseId}]}
        p = _parca_bicimle(t)
        if p:
            parcalar.append(p)

    albumler = []
    release_ids = set()
    for section, kind in (("albums", "album"), ("singles", "single")):
        for b in ((a.get(section) or {}).get("results") or [])[:12]:
            identifier = b.get("browseId")
            if not identifier or identifier in release_ids:
                continue
            release_ids.add(identifier)
            kapaklar = b.get("thumbnails") or []
            albumler.append({
                "id": identifier, "ad": b.get("title"), "yil": b.get("year"),
                "tur": kind, "sanatci": a.get("name"), "sanatciId": browseId,
                "kapak": kapaklar[-1]["url"] if kapaklar else None,
            })

    kapaklar = (a.get("thumbnails") or [])
    return {
        "ad": a.get("name"),
        "abone": (a.get("subscribers") or None),
        "biyografi": (a.get("description") or None),
        "gorsel": kapaklar[-1]["url"] if kapaklar else None,
        "parcalar": parcalar,
        "albumler": albumler,
        "diskografiTam": all(not (a.get(section) or {}).get("params") and len((a.get(section) or {}).get("results") or []) <= 12 for section in ("albums", "singles")),
        "benzer": [{"id": item.get("browseId"), "ad": item.get("title"), "kaynak": "youtube"} for item in (a.get("related") or {}).get("results", []) if item.get("browseId") and item.get("title")][:12],
    }


@app.get("/yayimlar")
def yayimlar(browseId: str, kind: str = "album"):
    if kind not in ("album", "single"):
        raise HTTPException(status_code=400, detail="Geçersiz yayım türü.")
    slots = _catalog_slots
    if not slots.acquire(blocking=False):
        raise _catalog_error()
    def fetch_releases():
        a = _ytm.get_artist(browseId)
        section = a.get("albums" if kind == "album" else "singles") or {}
        params = section.get("params")
        items = _ytm.get_artist_albums(section.get("browseId") or browseId, params, limit=201) if params else section.get("results") or []
        return a, items
    try:
        task = _catalog_pool.submit(fetch_releases)
    except Exception:
        slots.release()
        raise _catalog_error() from None
    task.add_done_callback(lambda _: slots.release())
    try:
        a, items = task.result(timeout=6.5)
    except Exception:
        raise _catalog_error() from None
    releases, seen = [], set()
    for item in items[:200]:
        identifier = item.get("browseId")
        if not identifier or identifier in seen or not item.get("title"):
            continue
        seen.add(identifier)
        thumbs = item.get("thumbnails") or []
        releases.append({"id": identifier, "ad": item["title"], "yil": item.get("year"), "tur": kind,
                         "sanatci": a.get("name"), "sanatciId": browseId, "kapak": thumbs[-1].get("url") if thumbs else None})
    return {"items": releases, "complete": len(items) <= 200}


@app.get("/ilgili")
def ilgili(id: str = Query(pattern=r"^[A-Za-z0-9_-]{11}$"), limit: int = Query(default=24, ge=1, le=50)):
    """Catalog relationships only; never claim an acoustic similarity score."""
    def fetch_related():
        try:
            wp = _ytm.get_watch_playlist(videoId=id, limit=3)
        except Exception:
            wp = _ytm.get_watch_playlist(videoId=id, limit=3)
        tracks = list(wp.get("tracks") or [])
        if not tracks and wp.get("related"):
            for section in _ytm.get_song_related(wp["related"]):
                tracks.extend(section.get("contents") or [])
        out, seen = [], {id}
        for raw in tracks:
            p = _parca_bicimle(raw)
            if p and p["id"] not in seen:
                seen.add(p["id"])
                out.append(p)
        return {"parcalar": out[:limit], "method": "catalog", "source": "youtube"}
    if not _catalog_slots.acquire(blocking=False):
        raise _catalog_error()
    try:
        task = _catalog_pool.submit(fetch_related)
    except Exception:
        _catalog_slots.release()
        raise _catalog_error() from None
    task.add_done_callback(lambda _: _catalog_slots.release())
    try:
        return task.result(timeout=6.5)
    except Exception:
        raise _catalog_error() from None


# Integrated loudness (LKFS ≈ LUFS) from the player response, used for volume levelling.
# One small request per recording; values do not change, so they are cached for the process.
_loudness_cache: dict[str, float | None] = {}
_loudness_lock = threading.Lock()


def _player_loudness(video_id: str) -> float | None:
    body = {"playbackContext": {"contentPlaybackContext": {"signatureTimestamp": int(time.time() // 86400) - 1}}, "video_id": video_id}
    try:
        response = _ytm._send_request("player", body)
    except Exception:
        response = _ytm_yenile()._send_request("player", body)
    audio = (response.get("playerConfig") or {}).get("audioConfig") or {}
    value = audio.get("trackAbsoluteLoudnessLkfs", audio.get("perceptualLoudnessDb"))
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) and -70 < value < 10 else None


@app.get("/loudness")
def loudness(id: str = Query(pattern=r"^[A-Za-z0-9_-]{11}$")):
    with _loudness_lock:
        if id in _loudness_cache:
            return {"id": id, "lufs": _loudness_cache[id], "cached": True}
    if not _catalog_slots.acquire(blocking=False):
        raise _catalog_error()
    try:
        task = _catalog_pool.submit(_player_loudness, id)
    except Exception:
        _catalog_slots.release()
        raise _catalog_error() from None
    task.add_done_callback(lambda _: _catalog_slots.release())
    try:
        value = task.result(timeout=5)
    except Exception:
        raise _catalog_error() from None
    with _loudness_lock:
        if len(_loudness_cache) > 20000:
            _loudness_cache.clear()
        _loudness_cache[id] = value
    return {"id": id, "lufs": value, "cached": False}


@app.get("/album")
def album(browseId: str):
    try:
        data = _ytm.get_album(browseId)
    except Exception:
        raise _catalog_error() from None
    thumbs = data.get("thumbnails") or []
    tracks = []
    for raw in data.get("tracks") or []:
        raw = {**raw, "album": {"name": data.get("title"), "id": browseId},
               "thumbnails": raw.get("thumbnails") or thumbs,
               "artists": raw.get("artists") or data.get("artists") or []}
        if track := _parca_bicimle(raw):
            tracks.append(track)
    artists = data.get("artists") or []
    return {"id": browseId, "ad": data.get("title"), "yil": data.get("year"),
            "sanatciId": artists[0].get("id") if artists else None,
            "parcaSayisi": len(tracks), "toplamSure": sum(t.get("sure") or 0 for t in tracks),
            "sanatci": ", ".join(a.get("name", "") for a in data.get("artists") or []),
            "kapak": thumbs[-1]["url"] if thumbs else None, "parcalar": tracks}


@app.get("/coz")
def coz(request: Request, id: str, force: bool = False):
    started = time.monotonic()
    code = "OK"
    try:
        return _resolver.resolve(id, force=force)
    except ResolutionError as error:
        code = error.code
        raise
    finally:
        logging.getLogger("ytres").info("resolve request_id=%s code=%s elapsed_ms=%d", request.state.request_id, code, (time.monotonic() - started) * 1000)


@app.post("/onisit")
def onisit(ids: list[str]):
    """Only current and next tracks may be speculatively prepared."""
    count = 0
    for vid in list(dict.fromkeys(ids))[:2]:
        try:
            _resolver.submit(vid, prefetch=True)
            count += 1
        except ResolutionError:
            pass
    return {"kuyruga_alindi": count}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "4455")))
