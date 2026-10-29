# Optional online sound analysis

Sidewave first returns novel YouTube Music catalog neighbors. A bounded
background job compares the seed and at most eight candidates. Neither catalog
relations nor a recommendation is a claim that a recording is currently playable.

The worker uses the MusiCNN model bundled with the immutable AudioMuse image.
It accepts only bounded 16 kHz mono PCM, never URLs, credentials, or filesystem
paths. The application decodes at most 45 seconds (starting at 30 seconds for
recordings longer than 75 seconds). Bytes stay in memory and are discarded.
There is no permanent archive, Navidrome import, or full-track cache write.

Excerpt vectors have their own model/hash/pipeline key and are NOT mixed with
AudioMuse's full-track index. Scores are cosine similarity of actual excerpts,
not liking probabilities or whole-recording assessments. Catalog-only matches
have null scores. Sonic Path and artist analysis retain their archive semantics.

SQLite migration 11 holds sessions and embeddings. Repeated discovery uses a
24-hour session; sessions expire after seven days and vectors are bounded to
2,000 recordings. One analysis runs at a time per app, with six queued sessions,
max eight candidates per seed, a 65-second per-attempt bound, and at most one
automatic retry for transient failures. Existing playback failures or active
cache fills defer new analyses. The worker is single-threaded with one ONNX thread. When deploying it, use a private network, no published host port, and resource limits suitable for your host.

Results exclude the seed, favorites, playlist entries, last 20 heard recordings,
and dismissed tracks; each artist contributes at most two. Completed analysis
from prior sessions can contribute additional new discoveries. No active queue
is changed until the user chooses to play or append results.

GET /api/v1/discovery/sessions/:id polls without scheduling downloads.
POST /api/v1/discovery/sessions/:id/retry retries failed excerpts only, with a
one-minute cooldown. Web and Android display catalog/excerpt provenance and
progress. Closing a view cancels polling; shared bounded analysis remains durable.

This optional worker is not started by the default Compose file. Build this directory as a separate service on the app's private Docker network, then set `ONLINE_SONIC_URL` to its internal URL (port 4460). Health is available at `GET /health`. Without this setting, catalog discovery remains available and reports audio analysis unavailable. See the image's own license and dependency notices before redistribution.
