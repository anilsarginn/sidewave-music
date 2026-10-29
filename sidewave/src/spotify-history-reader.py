"""Read Spotify listening history from an export ZIP into normalized plays, without extracting to disk.

Supported, newest first:
- Extended streaming history: Streaming_History_Audio_*.json (names, URI, ms_played, skipped)
- Account data: StreamingHistory_music_*.json / StreamingHistory*.json (names, ms_played)
- Technical log information: RawCoreStream.json (URI, ms_played, reason_end),
  OnRepeatContents.json (URIs) and DaylistGenerated.json (taste terms)
Only these members are opened; ad, cache and device logs are ignored.
"""
import io
import json
import re
import sys
import zipfile

MAX_UPLOAD = 64 * 1024 * 1024
MAX_MEMBER = 40 * 1024 * 1024
MAX_TOTAL = 160 * 1024 * 1024
MAX_PLAYS = 300000


def kind(name):
    base = re.sub(r'[ _-]', '', name.replace('\\', '/').rsplit('/', 1)[-1].lower())
    if re.fullmatch(r'streaminghistoryaudio[\d]*(\d{4}(\d{4})?)?\.json', base) or base.startswith('streaminghistoryaudio'):
        return 'extended'
    if re.fullmatch(r'streaminghistory(music)?\d*\.json', base):
        return 'account'
    return {'rawcorestream.json': 'core', 'onrepeatcontents.json': 'onrepeat', 'daylistgenerated.json': 'daylist'}.get(base)


def text(value, limit=300):
    return value.strip()[:limit] if isinstance(value, str) else ''


def ms(value):
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def read(data):
    if len(data) > MAX_UPLOAD:
        raise ValueError('UPLOAD_TOO_LARGE')
    plays, on_repeat, terms, kinds = [], [], {}, set()
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        if len(members) > 20000:
            raise ValueError('TOO_MANY_FILES')
        for item in members:
            found = None if item.is_dir() else kind(item.filename)
            if not found:
                continue
            if item.flag_bits & 1:
                raise ValueError('ENCRYPTED_ZIP')
            total += item.file_size
            if item.file_size > MAX_MEMBER or total > MAX_TOTAL:
                raise ValueError('JSON_TOO_LARGE')
            with archive.open(item) as stream:
                content = stream.read(MAX_MEMBER + 1)
            if len(content) != item.file_size:
                raise ValueError('JSON_TOO_LARGE')
            rows = json.loads(content.decode('utf-8-sig'))
            if not isinstance(rows, list):
                continue
            kinds.add(found)
            for row in rows:
                if not isinstance(row, dict):
                    continue
                if found == 'extended':
                    uri = text(row.get('spotify_track_uri'))
                    title, artist = text(row.get('master_metadata_track_name')), text(row.get('master_metadata_album_artist_name'))
                    if not (uri or (title and artist)):
                        continue  # podcasts and audiobooks
                    plays.append({'at': text(row.get('ts'), 40), 'ms': ms(row.get('ms_played')), 'uri': uri, 'title': title, 'artist': artist,
                                  'album': text(row.get('master_metadata_album_album_name')), 'end': text(row.get('reason_end'), 40),
                                  'skipped': bool(row.get('skipped'))})
                elif found == 'account':
                    title, artist = text(row.get('trackName')), text(row.get('artistName'))
                    if title and artist and artist != 'Unknown Artist':
                        plays.append({'at': text(row.get('endTime'), 40), 'ms': ms(row.get('msPlayed')), 'uri': '', 'title': title, 'artist': artist, 'album': '', 'end': '', 'skipped': False})
                elif found == 'core':
                    uri = text(row.get('message_content_uri'))
                    if row.get('message_media_type') not in (None, 'audio') or not uri.startswith('spotify:track:'):
                        continue
                    end = text(row.get('message_reason_end'), 40)
                    plays.append({'at': text(row.get('timestamp_utc'), 40), 'ms': ms(row.get('message_ms_played')), 'uri': uri, 'title': '', 'artist': '', 'album': '',
                                  'end': end, 'skipped': end in ('fwdbtn', 'backbtn')})
                elif found == 'onrepeat':
                    on_repeat.extend(text(u) for u in (row.get('message_contents') or []) if text(u).startswith('spotify:track:'))
                elif found == 'daylist':
                    for term in (row.get('message_title_terms') or []) + (row.get('message_description_terms') or []):
                        term = text(term, 60).lower()
                        if term:
                            terms[term] = terms.get(term, 0) + 1
                if len(plays) > MAX_PLAYS:
                    raise ValueError('TOO_MANY_PLAYS')
    if not plays and not on_repeat:
        raise ValueError('NO_LISTENING_HISTORY')
    return {'plays': plays, 'onRepeat': list(dict.fromkeys(on_repeat)), 'terms': terms, 'kinds': sorted(kinds)}


if __name__ == '__main__':
    try:
        sys.stdout.write(json.dumps(read(sys.stdin.buffer.read(MAX_UPLOAD + 1)), ensure_ascii=False))
    except Exception:
        # Never echo account contents, filesystem paths, or untrusted error messages.
        sys.stderr.write('INVALID_SPOTIFY_HISTORY')
        sys.exit(1)
