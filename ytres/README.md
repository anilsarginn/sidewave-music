# Sidewave resolver

Private service for YouTube Music catalog metadata and expiring audio resolution. The public backend proxies audio; browser clients must never receive or persist the signed `url` or provider `headers`.

## Contract

- `GET /coz?id=<YouTube ID>&force=false`: returns `url`, `headers`, `mimeType`, `expiresAt` (Unix epoch **seconds**, with a five-minute safety margin), `format` (container extension), `bitrate` (kb/s or null).
- `force=true` invalidates the cached URL; simultaneous callers still share one extraction. Use this once after a transient stream failure, within the backend's overall 15-second start deadline. Authentication and unavailable-content errors must not be retried automatically.
- `POST /onisit`, body `[currentVideoId,nextVideoId]`: accepts at most two unique IDs. At most one speculative extraction runs, leaving capacity for playback. Playback promotes queued prefetch work.
- `GET /ara?q=...&type=songs|albums|artists&limit=20`: default song response remains `{sonuclar: [...]}`; songs now include `albumId` and `sanatcilar: [{ad,id}]`.
- Optional `broad=true` on song search combines one song shelf and one general-result page within a 6.5-second budget. It accepts official song/video metadata only, preserves IDs and versions, and returns partial-source errors without discarding the successful side. It does not resolve or download audio.
- Artist responses include both albums and single/EP shelves (up to 24 unique release IDs), with `tur: album|single`. Durations accept provider seconds or m:ss/h:mm:ss.
- `GET /album?browseId=...`: `{id,ad,yil,sanatci,kapak,parcalar}`. Existing `/charts`, `/sanatci`, `/ilgili`, `/oneri` remain available.
- Resolution retains yt-dlp’s default player profiles first. A technical format/client/transport failure permits one fallback to the public `web_embedded` profile for the exact same video ID, within the existing subprocess deadline. Auth, removed/private content, access denial and rate limits stop immediately. Default-profile sockets are capped at 1.5 seconds; the embedded fallback allows 2 seconds, each limited by the remaining total budget. yt-dlp allows one transport retry per extractor request; 403/429 provider API errors and actual access restrictions remain terminal. HLS/DASH manifests and initial-data metadata requests are skipped; only progressive HTTPS audio is selected. Before a URL enters the cache, a bounded 32-byte Range probe checks HTTP status, MIME and actual container signature. A rejected audio CDN URL permits the one existing exact-recording fallback; it is not cached as ready. Extraction explicitly uses IPv4 on this Docker deployment. No alternate recording is searched or substituted.
- Missing formats and unsupported client responses return typed 502 errors rather than a false removed-recording 404. Extractor warnings retain only a timeout boolean, so a masked API timeout preserves its real failure class without storing raw text.
- Failures: HTTP 400/403/404/429/502/503/504 and `{code,message,retryable,requestId}`. Forward `x-request-id` to correlate requests. Provider errors are classified privately; responses and logs omit their raw text.
- `GET /saglik` reports process health and queue/cache counts. A healthy process does **not** prove any particular song is accessible. `GET /metrics` provides Prometheus counters and gauges for outcomes, hits and pending work.

## Operation

The root Compose configuration builds this internal service as `sidewave-resolver:local`. See [self-hosting](../docs/self-hosting.md) for deployment.

`RESOLVE_TIMEOUT_SECONDS` defaults to 12 seconds and is clamped to 13.5 seconds. Queue time is included. A hung extraction runs in its own process group, which is killed on deadline (including Deno children). Cache entries expire automatically; cache size is bounded to 512, pending queue to 32, extraction workers to 3. No startup package upgrades or runtime EJS downloads occur.

Pinned runtime: Python 3.12.13, yt-dlp 2026.8.19, companion yt-dlp-ejs 0.8.0, Deno 2.9.7, ytmusicapi 1.12.3. `requirements.in` describes direct dependencies; `requirements.txt` pins the complete runtime resolution. Update these together, run tests and an isolated source smoke check, then release a new image with rollback available. Reference: [yt-dlp EJS setup](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
docker build -t sidewave-ytres:validated .
```

Tests use fake providers, deterministic synchronization and an actual killed subprocess. They do not modify the music archive or contact YouTube. A successful container build establishes runtime compatibility, not live-provider playback success; catalog access, resolution and reading audio bytes must be checked separately.
