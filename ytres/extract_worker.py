"""Private short-lived extraction worker; stdout is an internal JSON channel."""
import json
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from yt_dlp import YoutubeDL
from resolver import ResolutionError, classify_error, normalize_info, timeout_error


class QuietLogger:
    def __init__(self):
        self.transport_timed_out = False

    def debug(self, *_): pass
    def warning(self, message, *_):
        # Keep a safe signal only; yt-dlp can mask an API timeout as "no formats".
        text = str(message).lower()
        self.transport_timed_out |= "timed out" in text or "timeout" in text
    def error(self, *_): pass


def verify_audio(stream, timeout, opener=urlopen):
    """Verify a tiny prefix before caching; never persist audio or signed URLs."""
    request = Request(stream["url"], headers={**stream["headers"], "Range": "bytes=0-31"})
    try:
        with opener(request, timeout=min(2.0, timeout)) as response:
            if response.status not in (200, 206):
                raise ResolutionError("SOURCE_STREAM_REJECTED", "Kaynak ses bağlantısını şu anda kabul etmiyor.", 502, True)
            media_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
            if not (media_type.startswith("audio/") or media_type in ("video/webm", "video/mp4", "application/octet-stream")):
                raise ResolutionError("SOURCE_INVALID_STREAM", "Kaynak geçerli ses verisi sunmadı.", 502, True)
            prefix = response.read(32)
            valid = {
                "webm": prefix.startswith(b"\x1a\x45\xdf\xa3"),
                "m4a": prefix[4:8] == b"ftyp",
                "mp4": prefix[4:8] == b"ftyp",
                "ogg": prefix.startswith(b"OggS"),
                "opus": prefix.startswith(b"OggS"),
                "mp3": prefix.startswith(b"ID3") or (len(prefix) > 1 and prefix[0] == 255 and prefix[1] & 224 == 224),
            }.get(stream["format"], False)
            if not valid:
                raise ResolutionError("SOURCE_INVALID_STREAM", "Kaynak geçerli ses verisi sunmadı.", 502, True)
    except HTTPError as error:
        error.close()
        raise ResolutionError("SOURCE_STREAM_REJECTED", "Kaynak ses bağlantısını şu anda kabul etmiyor.", 502, True) from None
    except (URLError, TimeoutError, OSError):
        raise timeout_error() from None


# Both profiles operate on the exact same provider recording. No search/ID substitution.
_RECOVERABLE = {"SOURCE_NO_AUDIO", "SOURCE_CLIENT_UNAVAILABLE", "SOURCE_TIMEOUT", "SOURCE_FAILED", "SOURCE_STREAM_REJECTED"}


def extract_audio(video_id, timeout=12.0, factory=YoutubeDL, now=time.monotonic, probe=verify_audio):
    deadline = now() + timeout
    for profile in ("default", "web_embedded"):
        remaining = deadline - now()
        if remaining <= 0:
            raise timeout_error()
        logger = QuietLogger()
        options = {
            "format": "bestaudio[protocol=https]",
            "quiet": True, "no_warnings": False, "logger": logger,
            "skip_download": True, "noplaylist": True, "cachedir": False,
            "source_address": "0.0.0.0",
            # A single transport retry can recover a dropped API response without
            # throwing away the webpage and starting the whole extractor again.
            "socket_timeout": min(2.0 if profile == "web_embedded" else 1.5, remaining), "retries": 0, "extractor_retries": 1,
            "js_runtimes": {"deno": {}}, "remote_components": [],
        }
        # The proxy handles progressive audio, not HLS/DASH manifests. Catalog
        # metadata is already known, so related/initial-data requests add no value.
        options["extractor_args"] = {"youtube": {"skip": ["hls", "dash", "translated_subs"], "player_skip": ["initial_data"]}}
        if profile != "default":
            options["extractor_args"]["youtube"]["player_client"] = [profile]
        try:
            with factory(options) as ydl:
                info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False) or {}
            if now() >= deadline:
                raise timeout_error()
            if info.get("id") not in (None, video_id):
                raise ResolutionError("SOURCE_ID_MISMATCH", "Kaynak farklı bir kayıt döndürdü.", 502)
            stream = normalize_info(info)
            probe(stream, deadline - now())
            if now() >= deadline:
                raise timeout_error()
            return stream
        except Exception as error:
            safe = error if isinstance(error, ResolutionError) else classify_error(error)
            if safe.code == "SOURCE_NO_AUDIO" and logger.transport_timed_out:
                safe = timeout_error()
            if profile == "web_embedded" or safe.code not in _RECOVERABLE:
                raise safe from None
    raise timeout_error()


def main():
    try:
        timeout = float(sys.argv[2]) if len(sys.argv) > 2 else 12.0
        print(json.dumps(extract_audio(sys.argv[1], timeout=timeout)))
    except Exception as error:
        safe = error if isinstance(error, ResolutionError) else classify_error(error)
        print(json.dumps({"error": {"code": safe.code, "message": safe.message, "status": safe.status, "retryable": safe.retryable}}))


if __name__ == "__main__":
    main()
