from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
import sys
import threading
import time

import pytest

from resolver import Resolver, ResolutionError, classify_error, extract_subprocess, normalize_info


A, B, C, D = "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"


def stream(video_id=A):
    return {"url": f"https://rr1.googlevideo.com/videoplayback?id={video_id}&signature=SECRET",
            "headers": {"User-Agent": "test"}, "mimeType": "audio/webm", "format": "webm", "bitrate": 128,
            "expiresAt": time.time() + 3600}


def test_cache_hit_expiry_and_forced_refresh():
    calls = []
    resolver = Resolver(extractor=lambda vid, _: calls.append(vid) or stream(vid))
    try:
        resolver.resolve(A)
        resolver.resolve(A)
        assert calls == [A]
        resolver.resolve(A, force=True)
        assert calls == [A, A]
        resolver.cache[A]["expiresAt"] = time.time() - 1
        resolver.resolve(A)
        assert calls == [A, A, A]
    finally:
        resolver.close()


def test_many_simultaneous_requests_share_one_extraction():
    started, release = threading.Event(), threading.Event()
    calls = []
    def extractor(vid, timeout):
        calls.append(vid)
        started.set()
        assert release.wait(2)
        return stream(vid)
    resolver = Resolver(extractor=extractor)
    try:
        first = resolver.submit(A)
        assert started.wait(1)
        futures = [resolver.submit(A, force=bool(i % 2)) for i in range(25)]
        assert all(future is first for future in futures)
        release.set()
        assert all(future.result(1)["format"] == "webm" for future in futures)
        assert calls == [A]
    finally:
        release.set()
        resolver.close()


def test_playback_reserved_capacity_and_queue_priority():
    started_a, started_b, release_a, release_b = [threading.Event() for _ in range(4)]
    order = []
    def extractor(vid, timeout):
        order.append(vid)
        if vid == A:
            started_a.set()
            release_a.wait(2)
        elif vid == B:
            started_b.set()
            release_b.wait(2)
        return stream(vid)
    resolver = Resolver(extractor=extractor, workers=2)
    try:
        a = resolver.submit(A, prefetch=True)
        assert started_a.wait(1)
        c = resolver.submit(C, prefetch=True)
        b = resolver.submit(B)
        assert started_b.wait(1), "second prefetch must not occupy playback capacity"
        d = resolver.submit(D)
        release_b.set()
        d.result(1)
        assert order[:3] == [A, B, D]
        release_a.set()
        a.result(1)
        c.result(1)
    finally:
        release_a.set()
        release_b.set()
        resolver.close()


def test_timeout_includes_queue_time_and_does_not_cache_late_result():
    release = threading.Event()
    resolver = Resolver(extractor=lambda vid, timeout: release.wait(0.2) or stream(vid), timeout=0.05)
    try:
        started = time.monotonic()
        with pytest.raises(ResolutionError) as failure:
            resolver.resolve(A)
        assert failure.value.code == "SOURCE_TIMEOUT"
        assert time.monotonic() - started < 0.15
        # Worker sees late completion and never populates a stale result.
        time.sleep(0.22)
        assert A not in resolver.cache
    finally:
        release.set()
        resolver.close()


def test_hard_timeout_terminates_worker_process(monkeypatch):
    original = subprocess.Popen
    processes = []
    def sleeping_process(args, **kwargs):
        process = original([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
        processes.append(process)
        return process
    monkeypatch.setattr(subprocess, "Popen", sleeping_process)
    with pytest.raises(ResolutionError) as failure:
        extract_subprocess(A, 0.1)
    assert failure.value.code == "SOURCE_TIMEOUT"
    assert processes[0].poll() is not None


@pytest.mark.parametrize("message,code,retryable", [
    ("Sign in to confirm you're not a bot https://private/?signature=SECRET", "SOURCE_AUTH_REQUIRED", False),
    ("Video unavailable (removed)", "SOURCE_UNAVAILABLE", False),
    ("HTTP Error 429: Too Many Requests", "SOURCE_RATE_LIMITED", True),
    ("HTTP Error 403: Forbidden", "SOURCE_ACCESS_DENIED", False),
    ("request timed out", "SOURCE_TIMEOUT", True),
    ("internal upstream failure", "SOURCE_FAILED", True),
])
def test_safe_error_classification(message, code, retryable):
    error = classify_error(message)
    assert error.code == code
    assert error.retryable == retryable
    assert "SECRET" not in json.dumps(error.payload("request-1"))
    assert "https://" not in str(error)


def test_stream_metadata_headers_and_expiry():
    result = normalize_info({"url": "https://rr1.googlevideo.com/videoplayback?expire=10000&sig=SECRET",
                             "ext": "m4a", "abr": 129.2, "vcodec": "none",
                             "http_headers": {"User-Agent": "browser", "Referer": "https://music.youtube.com/",
                                              "Cookie": "SECRET", "Host": "wrong-host", "Origin": "bad\nvalue"}}, now=1000)
    assert result["mimeType"] == "audio/mp4"
    assert result["expiresAt"] == 9700
    assert result["bitrate"] == 129.2
    assert result["headers"] == {"User-Agent": "browser", "Referer": "https://music.youtube.com/"}


@pytest.mark.parametrize("url", ["file:///etc/passwd", "https://evil.example/audio", "https://googlevideo.com.evil.example/audio"])
def test_reject_non_provider_streams(url):
    with pytest.raises(ResolutionError) as failure:
        normalize_info({"url": url, "ext": "webm"})
    assert failure.value.code == "SOURCE_INVALID_STREAM"


def test_expired_link_not_accepted():
    with pytest.raises(ResolutionError) as failure:
        normalize_info({"url": "https://rr1.googlevideo.com/audio?expire=1200", "ext": "webm"}, now=1000)
    assert failure.value.code == "SOURCE_EXPIRED"


def test_id_validation_does_not_launch_extractor():
    resolver = Resolver(extractor=lambda *_: pytest.fail("must not extract"))
    try:
        with pytest.raises(ResolutionError) as failure:
            resolver.resolve("https://youtube.com/watch?v=aaaaaaaaaaa")
        assert failure.value.status == 400
    finally:
        resolver.close()


def test_bounded_queue_playback_replaces_waiting_prefetch():
    release, started_a, started_b = threading.Event(), threading.Event(), threading.Event()
    def extractor(vid, timeout):
        if vid in (A, B):
            (started_a if vid == A else started_b).set()
            release.wait(2)
        return stream(vid)
    resolver = Resolver(extractor=extractor, workers=2, max_queue=1)
    try:
        resolver.submit(A, prefetch=True)
        assert started_a.wait(1)
        resolver.submit(B)
        assert started_b.wait(1)
        prefetch = resolver.submit(C, prefetch=True)
        playback = resolver.submit(D)
        with pytest.raises(ResolutionError) as failure:
            prefetch.result(0.1)
        assert failure.value.code == "SOURCE_BUSY"
        with pytest.raises(ResolutionError):
            resolver.submit("eeeeeeeeeee")
        assert len(resolver.pending) == 1
        release.set()
        assert playback.result(1)["format"] == "webm"
    finally:
        release.set()
        resolver.close()
