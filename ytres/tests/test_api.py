from fastapi.testclient import TestClient
import pytest

import app
from resolver import ResolutionError


@pytest.fixture
def client():
    return TestClient(app.app)


def test_resolve_contract_and_request_id(client, monkeypatch):
    monkeypatch.setattr(app._resolver, "resolve", lambda id, force=False: {"url": "https://rr.googlevideo.com/audio", "headers": {}, "mimeType": "audio/webm", "expiresAt": 123456, "format": "webm", "bitrate": 128, "force": force})
    result = client.get("/coz?id=aaaaaaaaaaa&force=true", headers={"x-request-id": "play-123"})
    assert result.status_code == 200
    assert result.json()["force"] is True
    assert result.headers["x-request-id"] == "play-123"
    assert result.headers["cache-control"] == "no-store"


def test_errors_are_typed_and_do_not_expose_private_data(client, monkeypatch):
    def unavailable(*args, **kwargs):
        raise ResolutionError("SOURCE_UNAVAILABLE", "Bu kayıt kaynakta erişilebilir değil.", 404)
    monkeypatch.setattr(app._resolver, "resolve", unavailable)
    result = client.get("/coz?id=aaaaaaaaaaa", headers={"x-request-id": "play-456"})
    assert result.status_code == 404
    assert result.json() == {"code": "SOURCE_UNAVAILABLE", "message": "Bu kayıt kaynakta erişilebilir değil.", "retryable": False, "requestId": "play-456"}


def test_prefetch_only_current_and_next(client, monkeypatch):
    calls = []
    monkeypatch.setattr(app._resolver, "submit", lambda id, **kw: calls.append(id))
    result = client.post("/onisit", json=["aaaaaaaaaaa", "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"])
    assert result.json() == {"kuyruga_alindi": 2}
    assert calls == ["aaaaaaaaaaa", "bbbbbbbbbbb"]


def test_song_metadata_and_album_navigation(client, monkeypatch):
    monkeypatch.setattr(app._ytm, "search", lambda *a, **k: [{"videoId": "aaaaaaaaaaa", "title": "Song", "album": {"name": "Album", "id": "MPRE123"}, "artists": [{"name": "Artist", "id": "UC123"}], "duration_seconds": 200}])
    song = client.get("/ara?q=Song").json()["sonuclar"][0]
    assert song["albumId"] == "MPRE123"
    assert song["sanatcilar"] == [{"ad": "Artist", "id": "UC123"}]
    monkeypatch.setattr(app._ytm, "get_album", lambda id: {"title": "Album", "artists": [{"name": "Artist", "id": "UC123"}], "tracks": [{"videoId": "aaaaaaaaaaa", "title": "Song"}]})
    album = client.get("/album?browseId=MPRE123").json()
    assert album["parcalar"][0]["albumId"] == "MPRE123"
    assert album["parcalar"][0]["sanatci"] == "Artist"


def test_catalog_error_is_not_an_empty_library(client, monkeypatch):
    def unavailable(*args, **kwargs):
        raise RuntimeError("provider https://private/?SECRET")
    monkeypatch.setattr(app._ytm, "search", unavailable)
    monkeypatch.setattr(app, "_ytm_yenile", lambda: app._ytm)
    result = client.get("/ara?q=Song")
    assert result.status_code == 502
    assert result.json()["code"] == "CATALOG_UNAVAILABLE"
    assert "SECRET" not in result.text


def test_singles_only_artist_has_navigable_releases_and_album_metadata(client, monkeypatch):
    monkeypatch.setattr(app._ytm, 'get_artist', lambda _: {
        'name': 'Example Artist', 'albums': {'results': []}, 'songs': {'results': []},
        'singles': {'results': [{'browseId': 'MPRE-single', 'title': 'First Single', 'year': '2026'}]},
    })
    artist = client.get('/sanatci?browseId=UC-selected').json()
    assert artist['parcalar'] == []
    assert artist['albumler'] == [{'id': 'MPRE-single', 'ad': 'First Single', 'yil': '2026',
                                  'tur': 'single', 'sanatci': 'Example Artist', 'sanatciId': 'UC-selected', 'kapak': None}]
    calls = []
    def album(identifier):
        calls.append(identifier)
        return {'title': 'First Single', 'artists': [{'name': 'Example Artist', 'id': 'UC-selected'}],
                'thumbnails': [{'url': 'https://example.test/art.jpg'}],
                'tracks': [{'videoId': 'aaaaaaaaaaa', 'title': 'First Single', 'duration': '3:42'}]}
    monkeypatch.setattr(app._ytm, 'get_album', album)
    result = client.get('/album', params={'browseId': artist['albumler'][0]['id']}).json()
    assert calls == ['MPRE-single']
    assert result['parcaSayisi'] == 1 and result['toplamSure'] == 222
    assert result['sanatciId'] == 'UC-selected'
    assert result['parcalar'][0] == {
        'id': 'aaaaaaaaaaa', 'baslik': 'First Single', 'sanatci': 'Example Artist',
        'sanatcilar': [{'ad': 'Example Artist', 'id': 'UC-selected'}], 'album': 'First Single',
        'albumId': 'MPRE-single', 'sure': 222, 'kapak': 'https://example.test/art.jpg',
    }


def test_artist_releases_deduplicate_only_provider_id_and_preserve_track_artists(client, monkeypatch):
    monkeypatch.setattr(app._ytm, 'get_artist', lambda _: {
        'name': 'Main Artist',
        'songs': {'results': [
            {'videoId': 'aaaaaaaaaaa', 'title': 'Track', 'duration': '4:15'},
            {'videoId': 'bbbbbbbbbbb', 'title': 'Track (Live)', 'duration_seconds': 333,
             'artists': [{'name': 'Guest Artist', 'id': 'UC-guest'}]},
        ]},
        'albums': {'results': [{'browseId': 'release-a', 'title': 'Same Name'}]},
        'singles': {'results': [{'browseId': 'release-a', 'title': 'Same Name'},
                                {'browseId': 'release-b', 'title': 'Same Name'}, {'title': 'No ID'}]},
    })
    result = client.get('/sanatci?browseId=UC-main').json()
    assert [r['id'] for r in result['albumler']] == ['release-a', 'release-b']
    assert [r['tur'] for r in result['albumler']] == ['album', 'single']
    assert result['parcalar'][0]['sanatcilar'] == [{'ad': 'Main Artist', 'id': 'UC-main'}]
    assert result['parcalar'][0]['sure'] == 255
    assert result['parcalar'][1]['baslik'] == 'Track (Live)'
    assert result['parcalar'][1]['sanatcilar'] == [{'ad': 'Guest Artist', 'id': 'UC-guest'}]
    assert result['parcalar'][1]['sure'] == 333


def test_broad_search_adds_official_results_without_uploads_or_metadata_loss(client, monkeypatch):
    calls = []
    def search(query, *, filter, limit):
        calls.append((filter, limit))
        if filter == 'songs':
            return [{'videoId': 'aaaaaaaaaaa', 'title': 'Original', 'duration_seconds': 200,
                     'artists': [{'name': 'Recording Artist', 'id': 'UC-main'}],
                     'album': {'name': 'Album', 'id': 'release-a'}}]
        return [
            {'resultType': 'song', 'videoType': 'MUSIC_VIDEO_TYPE_ATV', 'videoId': 'aaaaaaaaaaa', 'title': 'Less detailed duplicate'},
            {'resultType': 'video', 'videoType': 'MUSIC_VIDEO_TYPE_OMV', 'videoId': 'bbbbbbbbbbb', 'title': 'Original (Live)', 'duration': '4:20'},
            {'resultType': 'song', 'videoType': 'MUSIC_VIDEO_TYPE_ATV', 'videoId': 'ccccccccccc', 'title': 'Another recording'},
            {'resultType': 'video', 'videoType': 'MUSIC_VIDEO_TYPE_UGC', 'videoId': 'ddddddddddd', 'title': 'Fan cover'},
            {'resultType': 'playlist', 'videoId': 'eeeeeeeeeee', 'title': 'A playlist'},
            {'resultType': 'episode', 'videoId': 'fffffffffff', 'title': 'A podcast'},
            {'resultType': 'artist', 'artists': [{'name': 'Recording Artist', 'id': 'UC-main'}]},
            {'resultType': 'artist', 'browseId': 'UC-main', 'artist': 'Recording Artist'},
            {'resultType': 'artist', 'browseId': 'UC-other', 'artist': 'Recording Artist'},
        ]
    monkeypatch.setattr(app._ytm, 'search', search)
    result = client.get('/ara?q=Original&broad=true&limit=20').json()
    assert len(calls) == 2 and set(calls) == {('songs', 1), (None, 1)}
    assert [p['id'] for p in result['sonuclar']] == ['bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa']
    original = result['sonuclar'][-1]
    assert original['baslik'] == 'Original' and original['albumId'] == 'release-a' and original['sure'] == 200
    assert result['sonuclar'][0]['baslik'] == 'Original (Live)' and result['sonuclar'][0]['sure'] == 260
    assert [a['id'] for a in result['sanatcilar']] == ['UC-main', 'UC-other']
    assert result['hata'] == {}


def test_broad_search_has_bounded_supplement_and_output(client, monkeypatch):
    def search(query, *, filter, limit):
        if filter == 'songs':
            return [{'videoId': f'base-{i:06}', 'title': f'Base {i}'} for i in range(50)]
        return [{'resultType': 'song', 'videoType': 'MUSIC_VIDEO_TYPE_ATV', 'videoId': f'extra{i:06}', 'title': f'Extra {i}'} for i in range(50)]
    monkeypatch.setattr(app._ytm, 'search', search)
    result = client.get('/ara?q=Track&broad=true&limit=12').json()
    assert len(result['sonuclar']) == 12
    assert sum(p['id'].startswith('extra') for p in result['sonuclar']) == 8
    assert any(p['id'].startswith('base-') for p in result['sonuclar'])


@pytest.mark.parametrize('failed', ['songs', None])
def test_broad_search_preserves_partial_success_and_sanitizes_errors(client, monkeypatch, failed):
    def search(query, *, filter, limit):
        if filter == failed:
            raise RuntimeError('private provider https://private/?SECRET')
        return [{'resultType': 'song', 'videoType': 'MUSIC_VIDEO_TYPE_ATV', 'videoId': 'aaaaaaaaaaa', 'title': 'Track'}]
    monkeypatch.setattr(app._ytm, 'search', search)
    result = client.get('/ara?q=Track&broad=true')
    assert result.status_code == 200
    assert result.json()['sonuclar'][0]['id'] == 'aaaaaaaaaaa'
    assert list(result.json()['hata']) == ['songs' if failed == 'songs' else 'general']
    assert 'SECRET' not in result.text


def test_broad_search_all_failed_is_typed_error(client, monkeypatch):
    def search(*args, **kwargs):
        raise RuntimeError('private secret')
    monkeypatch.setattr(app._ytm, 'search', search)
    result = client.get('/ara?q=Track&broad=true')
    assert result.status_code == 502 and result.json()['code'] == 'CATALOG_UNAVAILABLE'
    assert 'private' not in result.text


def test_broad_search_deadline_keeps_completed_results(client, monkeypatch):
    import threading
    import time
    release, entered, finished = threading.Event(), threading.Event(), threading.Event()
    def search(query, *, filter, limit):
        if filter is None:
            entered.set()
            release.wait(1)
            finished.set()
            return []
        return [{'videoId': 'aaaaaaaaaaa', 'title': 'Track'}]
    monkeypatch.setattr(app._ytm, 'search', search)
    monkeypatch.setattr(app, '_BROAD_SEARCH_SECONDS', 0.03)
    try:
        start = time.monotonic()
        result = client.get('/ara?q=Track&broad=true')
        assert entered.is_set()
        assert time.monotonic() - start < 0.3
        assert result.status_code == 200 and result.json()['sonuclar'][0]['id'] == 'aaaaaaaaaaa'
        assert 'general' in result.json()['hata']
    finally:
        release.set()
        assert finished.wait(1)


def test_default_song_search_does_not_expand(client, monkeypatch):
    calls = []
    monkeypatch.setattr(app._ytm, 'search', lambda query, **kwargs: calls.append(kwargs) or [])
    result = client.get('/ara?q=Track&limit=5')
    assert result.json() == {'sonuclar': []}
    assert calls == [{'filter': 'songs', 'limit': 5}]


def test_broad_search_rejects_saturation_without_starting_more_provider_work(client, monkeypatch):
    import threading
    monkeypatch.setattr(app, '_catalog_slots', threading.BoundedSemaphore(0))
    monkeypatch.setattr(app._ytm, 'search', lambda *args, **kwargs: pytest.fail('saturated search must not launch provider work'))
    result = client.get('/ara?q=Track&broad=true')
    assert result.status_code == 502
    assert result.json()['code'] == 'CATALOG_UNAVAILABLE'


@pytest.mark.parametrize('raw,expected', [
    ({'duration': '1:02:03'}, 3723), ({'duration': '3:99'}, None),
    ({'duration': 'Live'}, None), ({'duration_seconds': float('nan')}, None),
])
def test_duration_metadata_does_not_invent_lengths(raw, expected):
    assert app._parca_bicimle({'videoId': 'aaaaaaaaaaa', **raw})['sure'] == expected


def test_full_discography_preserves_channel_and_release_identity(client, monkeypatch):
    monkeypatch.setattr(app._ytm, 'get_artist', lambda _: {'name': 'People Around', 'albums': {'browseId': 'UC-catalog', 'params': 'albums-token'}, 'singles': {'results': []}})
    calls = []
    def albums(channel, params, limit):
        calls.append((channel, params, limit))
        return [{'browseId': 'album-1', 'title': 'Same Name', 'year': '2024'}, {'browseId': 'album-2', 'title': 'Same Name (Live)'}]
    monkeypatch.setattr(app._ytm, 'get_artist_albums', albums)
    result = client.get('/yayimlar?browseId=UC-selected&kind=album')
    assert result.status_code == 200
    assert calls == [('UC-catalog', 'albums-token', 201)]
    assert [a['id'] for a in result.json()['items']] == ['album-1', 'album-2']
    assert all(a['sanatciId'] == 'UC-selected' for a in result.json()['items'])
    assert result.json()['complete'] is True
    assert client.get('/yayimlar?browseId=UC-selected&kind=bogus').status_code == 400


def test_discography_bound_is_explicit_and_failures_are_not_empty_success(client, monkeypatch):
    monkeypatch.setattr(app._ytm, 'get_artist', lambda _: {'name': 'Artist', 'albums': {'params': 'token'}})
    monkeypatch.setattr(app._ytm, 'get_artist_albums', lambda *args, **kwargs: [{'browseId': str(i), 'title': str(i)} for i in range(201)])
    data = client.get('/yayimlar?browseId=UC-main').json()
    assert len(data['items']) == 200 and data['complete'] is False
    def fail(*args, **kwargs): raise RuntimeError('private provider failure')
    monkeypatch.setattr(app._ytm, 'get_artist_albums', fail)
    result = client.get('/yayimlar?browseId=UC-main')
    assert result.status_code == 502
    assert 'private provider' not in result.text


def test_related_uses_watch_queue_without_failing_optional_related(client, monkeypatch):
    monkeypatch.setattr(app._ytm, 'get_watch_playlist', lambda **kw: {'tracks': [
        {'videoId': 'aaaaaaaaaaa','title':'Seed','artists':[{'name':'Artist'}]},
        {'videoId': 'bbbbbbbbbbb','title':'New song','artists':[{'name':'New artist'}]},
        {'videoId': 'bbbbbbbbbbb','title':'Duplicate','artists':[{'name':'New artist'}]}], 'related':'broken'})
    def broken(*args): raise AssertionError('optional related must not discard queue')
    monkeypatch.setattr(app._ytm,'get_song_related',broken)
    result=client.get('/ilgili?id=aaaaaaaaaaa&limit=24')
    assert result.status_code==200
    assert [p['id'] for p in result.json()['parcalar']]==['bbbbbbbbbbb']
    assert result.json()['method']=='catalog'
    assert client.get('/ilgili?id=invalid!').status_code==400
    assert client.get('/ilgili?id=aaaaaaaaaaa&limit=10000').status_code==400


def test_loudness_reads_player_audio_config_and_caches(client, monkeypatch):
    calls = []
    def player(endpoint, body):
        calls.append(body["video_id"])
        return {"playerConfig": {"audioConfig": {"loudnessDb": -1.29, "trackAbsoluteLoudnessLkfs": -8.29}}}
    monkeypatch.setattr(app._ytm, "_send_request", player)
    app._loudness_cache.clear()
    first = client.get("/loudness?id=kJQP7kiw5Fk").json()
    second = client.get("/loudness?id=kJQP7kiw5Fk").json()
    assert first == {"id": "kJQP7kiw5Fk", "lufs": -8.29, "cached": False}
    assert second["cached"] is True and calls == ["kJQP7kiw5Fk"]


def test_loudness_without_audio_config_is_unknown(client, monkeypatch):
    monkeypatch.setattr(app._ytm, "_send_request", lambda endpoint, body: {"playabilityStatus": {}})
    app._loudness_cache.clear()
    assert client.get("/loudness?id=aaaaaaaaaaa").json()["lufs"] is None
    assert client.get("/loudness?id=bad").status_code == 400
