"""Bounded, deduplicated resolution. Only the proxy receives signed URLs."""
from __future__ import annotations

from concurrent.futures import Future, TimeoutError as FutureTimeout
from dataclasses import dataclass
import json
import logging
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit

LOG = logging.getLogger("ytres.resolve")
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


class ResolutionError(Exception):
    def __init__(self, code: str, message: str, status: int = 502, retryable: bool = False):
        super().__init__(message)
        self.code, self.message, self.status, self.retryable = code, message, status, retryable

    def payload(self, request_id: str) -> dict:
        return {"code": self.code, "message": self.message, "retryable": self.retryable, "requestId": request_id}


def classify_error(error: Exception | str) -> ResolutionError:
    """Classify private provider text, never return it or log it."""
    text = str(error).lower()
    if any(s in text for s in ("sign in", "login", "confirm your age", "authentication", "not a bot", "cookies")):
        return ResolutionError("SOURCE_AUTH_REQUIRED", "Bu kaynak oturum açılmasını gerektiriyor.", 403)
    # An extractor/client failure is not evidence that the recording was removed.
    if "requested format is not available" in text or "only images are available" in text:
        return ResolutionError("SOURCE_NO_AUDIO", "Bu kaydın ses akışı şu anda çözümlenemiyor. Yeniden deneyebilirsin.", 502, True)
    if any(s in text for s in ("not available on this app", "playback on other websites has been disabled", "embedding disabled")):
        return ResolutionError("SOURCE_CLIENT_UNAVAILABLE", "Kaynak oynatma bağlantısını şu anda hazırlayamıyor.", 502, True)
    if any(s in text for s in ("private video", "removed", "unavailable", "not available", "copyright", "geo-restricted", "not found")):
        return ResolutionError("SOURCE_UNAVAILABLE", "Bu kayıt kaynakta erişilebilir değil.", 404)
    if "429" in text or "too many requests" in text:
        return ResolutionError("SOURCE_RATE_LIMITED", "Kaynak geçici olarak çok fazla istek alıyor.", 429, True)
    if "403" in text or "forbidden" in text:
        return ResolutionError("SOURCE_ACCESS_DENIED", "Kaynak bu kayda erişimi reddetti.", 403)
    if "timed out" in text or "timeout" in text:
        return timeout_error()
    return ResolutionError("SOURCE_FAILED", "Müzik kaynağına şu anda ulaşılamıyor.", 502, True)


def timeout_error() -> ResolutionError:
    return ResolutionError("SOURCE_TIMEOUT", "Şarkı zamanında hazırlanamadı. Yeniden deneyebilirsin.", 504, True)


def normalize_info(info: dict, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    selected = info
    if not info.get("url"):
        choices = [f for f in info.get("formats", []) if f.get("url") and f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none")]
        if not choices:
            raise ResolutionError("SOURCE_NO_AUDIO", "Bu kayıt için ses akışı bulunamadı.")
        selected = max(choices, key=lambda f: f.get("abr") or 0)
    url = selected.get("url", "")
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or not (parts.hostname == "googlevideo.com" or parts.hostname.endswith(".googlevideo.com")):
        raise ResolutionError("SOURCE_INVALID_STREAM", "Kaynak geçerli bir ses akışı sunmadı.")
    try:
        expires = float(parse_qs(parts.query).get("expire", [now + 4 * 3600])[0]) - 300
    except (ValueError, TypeError):
        expires = now + 4 * 3600
    if expires <= now:
        raise ResolutionError("SOURCE_EXPIRED", "Kaynak bağlantısının süresi doldu.", 502, True)
    # The proxy must forward extractor headers, but hop-by-hop and credential headers
    # must never escape this internal connection.
    allowed = {"user-agent", "accept", "accept-language", "referer", "origin"}
    headers = {str(k): str(v) for k, v in {**info.get("http_headers", {}), **selected.get("http_headers", {})}.items()
               if str(k).lower() in allowed and "\r" not in str(v) and "\n" not in str(v)}
    ext = selected.get("ext") or "webm"
    mime = {"m4a": "audio/mp4", "mp4": "audio/mp4", "webm": "audio/webm", "opus": "audio/ogg", "ogg": "audio/ogg", "mp3": "audio/mpeg"}.get(ext)
    if not mime or selected.get("vcodec") not in (None, "none"):
        raise ResolutionError("SOURCE_NO_AUDIO", "Bu kayıt için desteklenen ses biçimi bulunamadı.")
    return {"url": url, "headers": headers, "mimeType": mime, "expiresAt": int(expires),
            "format": ext, "bitrate": selected.get("abr") or None}


def extract_subprocess(video_id: str, timeout: float) -> dict:
    """A killed process group also kills a stuck JS solver, unlike thread timeouts."""
    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("extract_worker.py")), video_id, str(timeout)],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        raise timeout_error() from None
    try:
        data = json.loads(output)
        if "error" in data:
            e = data["error"]
            raise ResolutionError(e["code"], e["message"], e["status"], e["retryable"])
        if process.returncode or "url" not in data:
            raise ValueError("worker failed")
        return data
    except (ValueError, KeyError, TypeError):
        raise ResolutionError("SOURCE_FAILED", "Müzik kaynağına şu anda ulaşılamıyor.", 502, True) from None


@dataclass
class Job:
    video_id: str
    future: Future
    deadline: float
    prefetch: bool


class Resolver:
    def __init__(self, extractor=extract_subprocess, timeout: float = 12.0, workers: int = 3, max_queue: int = 32, max_cache: int = 512):
        self.extractor = extractor
        self.timeout = max(0.05, min(timeout, 13.5))
        self.max_queue, self.max_cache = max_queue, max_cache
        self.cache: dict[str, dict] = {}
        self.inflight: dict[str, Job] = {}
        self.pending: list[Job] = []
        self.condition = threading.Condition()
        self.prefetch_active = 0
        self.closed = False
        self.counters = {"resolved": 0, "failed": 0, "cacheHits": 0}
        self.threads = [threading.Thread(target=self._worker, daemon=True, name=f"resolver-{i}") for i in range(max(2, workers))]
        for worker in self.threads:
            worker.start()

    def submit(self, video_id: str, force: bool = False, prefetch: bool = False) -> Future:
        if not VIDEO_ID.fullmatch(video_id):
            raise ResolutionError("INVALID_VIDEO_ID", "Geçersiz şarkı kimliği.", 400)
        with self.condition:
            if self.closed:
                raise ResolutionError("SOURCE_BUSY", "Müzik kaynağı yeniden başlatılıyor.", 503, True)
            for expired in [j for j in self.pending if j.deadline <= time.monotonic()]:
                self.pending.remove(expired)
                self.inflight.pop(expired.video_id, None)
                expired.future.set_exception(timeout_error())
            if force:
                self.cache.pop(video_id, None)
            cached = self.cache.get(video_id)
            if cached and cached["expiresAt"] > time.time():
                future = Future()
                future.set_result(dict(cached))
                self.counters["cacheHits"] += 1
                return future
            if video_id in self.inflight:
                job = self.inflight[video_id]
                if not prefetch:
                    job.prefetch = False  # Promote a queued speculative request.
                    self.condition.notify_all()
                return job.future
            if len(self.pending) >= self.max_queue:
                # Playback may displace speculative queued work, never active work.
                speculative = next((j for j in reversed(self.pending) if j.prefetch), None)
                if not prefetch and speculative:
                    self.pending.remove(speculative)
                    self.inflight.pop(speculative.video_id, None)
                    speculative.future.set_exception(ResolutionError("SOURCE_BUSY", "Ön yükleme ertelendi.", 503, True))
                else:
                    raise ResolutionError("SOURCE_BUSY", "Kaynak meşgul. Birazdan yeniden dene.", 503, True)
            job = Job(video_id, Future(), time.monotonic() + self.timeout, prefetch)
            self.inflight[video_id] = job
            self.pending.append(job)
            self.condition.notify_all()
            return job.future

    def resolve(self, video_id: str, force: bool = False) -> dict:
        future = self.submit(video_id, force=force)
        try:
            return future.result(timeout=self.timeout)
        except FutureTimeout:
            raise timeout_error() from None

    def _worker(self):
        while True:
            with self.condition:
                job = None
                while job is None:
                    if self.closed:
                        return
                    job = next((j for j in self.pending if not j.prefetch), None)
                    if job is None and self.prefetch_active == 0:
                        job = next(iter(self.pending), None)
                    if job is None:
                        self.condition.wait()
                self.pending.remove(job)
                was_prefetch = job.prefetch
                if was_prefetch:
                    self.prefetch_active += 1
            started = time.monotonic()
            try:
                remaining = job.deadline - started
                if remaining <= 0:
                    raise timeout_error()
                result = self.extractor(job.video_id, remaining)
                if time.monotonic() > job.deadline:
                    raise timeout_error()
                with self.condition:
                    self.cache = {k: v for k, v in self.cache.items() if v["expiresAt"] > time.time()}
                    if len(self.cache) >= self.max_cache:
                        self.cache.pop(next(iter(self.cache)))
                    self.cache[job.video_id] = result
                    self.counters["resolved"] += 1
                    self.inflight.pop(job.video_id, None)
                    job.future.set_result(result)
            except Exception as error:
                safe = error if isinstance(error, ResolutionError) else classify_error(error)
                with self.condition:
                    self.counters["failed"] += 1
                    self.inflight.pop(job.video_id, None)
                    job.future.set_exception(safe)
                LOG.info("resolution_failed code=%s elapsed_ms=%d", safe.code, (time.monotonic() - started) * 1000)
            finally:
                with self.condition:
                    if was_prefetch:
                        self.prefetch_active -= 1
                    self.condition.notify_all()

    def status(self) -> dict:
        with self.condition:
            return {"cache": len(self.cache), "inflight": len(self.inflight), "queued": len(self.pending), **self.counters}

    def close(self):
        with self.condition:
            self.closed = True
            for job in self.pending:
                job.future.set_exception(ResolutionError("SOURCE_BUSY", "Kaynak durduruluyor.", 503, True))
                self.inflight.pop(job.video_id, None)
            self.pending.clear()
            self.condition.notify_all()
