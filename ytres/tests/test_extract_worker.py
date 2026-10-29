import pytest

from functools import partial
from extract_worker import extract_audio as real_extract_audio, verify_audio

extract_audio = partial(real_extract_audio, probe=lambda *_: None)
from resolver import ResolutionError, classify_error

VIDEO = "mGCIh-Ln-DQ"


def audio():
    return {"id": VIDEO, "url": "https://rr1.googlevideo.com/audio?expire=9999999999&signature=SECRET",
            "ext": "webm", "acodec": "opus", "vcodec": "none", "abr": 128,
            "http_headers": {"User-Agent": "test", "Authorization": "SECRET"}}


class Factory:
    def __init__(self, results):
        self.results, self.options, self.urls = iter(results), [], []

    def __call__(self, options):
        self.options.append(options)
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def extract_info(self, url, download):
        assert download is False
        self.urls.append(url)
        result = next(self.results)
        if isinstance(result, Exception):
            raise result
        return result() if callable(result) else result


def test_preferred_profile_resolves_without_additional_requests():
    factory = Factory([audio()])
    result = extract_audio(VIDEO, factory=factory)
    assert "player_client" not in factory.options[0]["extractor_args"]["youtube"]
    assert factory.options[0]["extractor_args"]["youtube"]["skip"] == ["hls", "dash", "translated_subs"]
    assert factory.options[0]["format"] == "bestaudio[protocol=https]"
    assert factory.options[0]["extractor_retries"] == 1
    assert len(factory.urls) == 1
    assert result["mimeType"] == "audio/webm"
    assert "Authorization" not in result["headers"]
    assert factory.options[0]["socket_timeout"] == 1.5
    assert factory.options[0]["no_warnings"] is False
    assert factory.options[0]["source_address"] == "0.0.0.0"


def test_missing_formats_falls_back_once_for_exact_same_recording():
    factory = Factory([RuntimeError("Requested format is not available https://private/?signature=SECRET"), audio()])
    assert extract_audio(VIDEO, factory=factory)["format"] == "webm"
    assert len(factory.options) == 2
    assert factory.options[1]["extractor_args"]["youtube"]["player_client"] == ["web_embedded"]
    assert factory.options[1]["source_address"] == "0.0.0.0"
    assert factory.urls == [f"https://music.youtube.com/watch?v={VIDEO}"] * 2


@pytest.mark.parametrize("message,code", [
    ("Sign in to confirm you are not a bot", "SOURCE_AUTH_REQUIRED"),
    ("Video unavailable (removed)", "SOURCE_UNAVAILABLE"),
    ("Private video", "SOURCE_UNAVAILABLE"),
    ("HTTP Error 403: Forbidden", "SOURCE_ACCESS_DENIED"),
    ("HTTP Error 429: Too Many Requests", "SOURCE_RATE_LIMITED"),
    ("geo-restricted", "SOURCE_UNAVAILABLE"),
])
def test_real_access_restrictions_are_not_retried(message, code):
    factory = Factory([RuntimeError(message), audio()])
    with pytest.raises(ResolutionError) as error:
        extract_audio(VIDEO, factory=factory)
    assert error.value.code == code
    assert len(factory.urls) == 1


def test_total_budget_includes_first_attempt_and_prevents_late_fallback():
    clock = [0.0]
    def late_failure():
        clock[0] = 12.1
        raise RuntimeError("Requested format is not available")
    factory = Factory([late_failure, audio()])
    with pytest.raises(ResolutionError) as error:
        extract_audio(VIDEO, timeout=12, factory=factory, now=lambda: clock[0])
    assert error.value.code == "SOURCE_TIMEOUT"
    assert len(factory.urls) == 1


def test_two_technical_failures_stop_without_looping_or_private_error_text():
    factory = Factory([RuntimeError("Requested format is not available"), RuntimeError("request timed out SECRET")])
    with pytest.raises(ResolutionError) as error:
        extract_audio(VIDEO, factory=factory)
    assert error.value.code == "SOURCE_TIMEOUT"
    assert len(factory.urls) == 2
    assert "SECRET" not in str(error.value)


@pytest.mark.parametrize("message,code", [
    ("Requested format is not available", "SOURCE_NO_AUDIO"),
    ("Only images are available for download", "SOURCE_NO_AUDIO"),
    ("This content is not available on this app", "SOURCE_CLIENT_UNAVAILABLE"),
    ("Playback on other websites has been disabled by the video owner", "SOURCE_CLIENT_UNAVAILABLE"),
])
def test_client_format_errors_do_not_masquerade_as_removed_recordings(message, code):
    error = classify_error(message)
    assert error.code == code
    assert error.status == 502
    assert error.retryable is True


def test_invalid_stream_host_and_wrong_provider_id_never_trigger_fallback():
    for info, code in [(dict(audio(), url="https://untrusted.test/audio"), "SOURCE_INVALID_STREAM"),
                       (dict(audio(), id="aaaaaaaaaaa"), "SOURCE_ID_MISMATCH")]:
        factory = Factory([info, audio()])
        with pytest.raises(ResolutionError) as error:
            extract_audio(VIDEO, factory=factory)
        assert error.value.code == code
        assert len(factory.urls) == 1


def test_masked_api_timeout_keeps_its_real_error_classification():
    class TimedOutFactory(Factory):
        def extract_info(self, url, download):
            self.options[-1]["logger"].warning("Unable to download API page: Read timed out SECRET")
            raise RuntimeError("Requested format is not available")
    factory = TimedOutFactory([])
    with pytest.raises(ResolutionError) as error:
        extract_audio(VIDEO, factory=factory)
    assert error.value.code == "SOURCE_TIMEOUT"
    assert error.value.retryable is True
    assert "SECRET" not in str(error.value)
    assert len(factory.options) == 2


def test_rejected_audio_url_falls_back_for_exact_recording_before_caching():
    calls = []
    def probe(stream, timeout):
        calls.append(timeout)
        if len(calls) == 1:
            raise ResolutionError("SOURCE_STREAM_REJECTED", "Ses bağlantısı reddedildi", 502, True)
    factory = Factory([audio(), audio()])
    assert real_extract_audio(VIDEO, factory=factory, probe=probe)["format"] == "webm"
    assert len(calls) == 2
    assert factory.urls == [f"https://music.youtube.com/watch?v={VIDEO}"] * 2


@pytest.mark.parametrize("status,mime,prefix,valid", [
    (206, "audio/webm", b"\x1a\x45\xdf\xa3" + b"x" * 40, True),
    (200, "application/octet-stream", b"\x1a\x45\xdf\xa3" + b"x" * 40, True),
    (206, "text/html", b"<html>Error</html>", False),
    (206, "audio/webm", b"<html>Error</html>", False),
    (206, "audio/webm", b"", False),
    (403, "audio/webm", b"", False),
])
def test_probe_checks_actual_audio_and_closes_after_bounded_prefix(status, mime, prefix, valid):
    class Response:
        closed = False
        def __enter__(self): return self
        def __exit__(self, *_): self.closed = True
        def read(self, size):
            assert size == 32
            return prefix[:size]
    response = Response()
    response.status = status
    response.headers = {"Content-Type": mime}
    def opener(request, timeout):
        assert request.get_header("Range") == "bytes=0-31"
        assert timeout == 0.5
        return response
    stream = {"url": "https://rr.googlevideo.com/audio", "headers": {}, "format": "webm"}
    if valid: verify_audio(stream, 0.5, opener=opener)
    else:
        with pytest.raises(ResolutionError): verify_audio(stream, 0.5, opener=opener)
    assert response.closed


def test_probe_is_inside_total_deadline():
    clock = [0.0]
    def slow_probe(*_): clock[0] = 13
    factory = Factory([audio()])
    with pytest.raises(ResolutionError) as error:
        real_extract_audio(VIDEO, factory=factory, now=lambda: clock[0], probe=slow_probe)
    assert error.value.code == "SOURCE_TIMEOUT"
    assert len(factory.urls) == 1
