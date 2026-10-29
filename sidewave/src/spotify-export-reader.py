"""Read selected Spotify account JSON files, without extracting an archive to disk."""
import io
import csv
import json
import re
import sys
import zipfile

MAX_UPLOAD = 64 * 1024 * 1024
MAX_JSON = 16 * 1024 * 1024


def selected(name):
    base = name.replace('\\', '/').rsplit('/', 1)[-1].lower()
    return base.endswith('.csv') or re.fullmatch(r'(playlists?\d*|yourlibrary\d*|likedsongs\d*)\.json', re.sub(r'[ _-]', '', base)) is not None


def document(name, content, allow_csv=False):
    decoded = content.decode('utf-8-sig')
    if not allow_csv:
        return {'name': name, 'data': json.loads(decoded)}
    csv.field_size_limit(16384)
    reader = csv.DictReader(io.StringIO(decoded, newline=''), strict=True)
    columns = {s.strip().casefold(): s for s in (reader.fieldnames or [])}
    # Explicit English/Turkish Exportify labels; unrelated personal CSV stays excluded.
    aliases = {'track uri': ['parça uri'], 'track name': ['parça adı'],
               'artist name(s)': ['sanatçı adı', 'artist name'], 'album name': ['albüm adı'],
               'track duration (ms)': ['parça süresi (ms)']}
    for key, alternatives in aliases.items():
        if key not in columns:
            for alternative in alternatives:
                if alternative in columns:
                    columns[key] = columns[alternative]
                    break
    required = ['track uri', 'track name', 'artist name(s)']
    if not all(k in columns for k in required):
        return None
    tracks = []
    for row in reader:
        if len(tracks) >= 100000:
            raise ValueError('TOO_MANY_ROWS')
        def cell(key):
            return row.get(columns.get(key, ''), '') or ''
        duration = cell('track duration (ms)')
        tracks.append({'trackName': cell('track name'), 'artistName': cell('artist name(s)').replace('\\,', ','),
                       'albumName': cell('album name'), 'trackUri': cell('track uri'),
                       'duration_ms': float(duration) if duration else None})
    return {'name': name, 'format': 'csv', 'data': {'tracks': tracks}}


def read(data, file_name='Spotify.json'):
    if len(data) > MAX_UPLOAD:
        raise ValueError('UPLOAD_TOO_LARGE')
    if not data.startswith(b'PK'):
        if len(data) > MAX_JSON:
            raise ValueError('JSON_TOO_LARGE')
        result = document(file_name, data, file_name.lower().endswith('.csv'))
        if result is None:
            raise ValueError('INVALID_CSV_COLUMNS')
        return [result]
    documents = []
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        if len(members) > 20000:
            raise ValueError('TOO_MANY_FILES')
        for item in members:
            if item.is_dir() or not selected(item.filename):
                continue
            if item.flag_bits & 1:
                raise ValueError('ENCRYPTED_ZIP')
            total += item.file_size
            if total > MAX_JSON:
                raise ValueError('JSON_TOO_LARGE')
            # read() verifies CRC. No paths from the archive are opened on the filesystem.
            with archive.open(item) as stream:
                content = stream.read(MAX_JSON + 1)
            if len(content) != item.file_size or len(content) > MAX_JSON:
                raise ValueError('JSON_TOO_LARGE')
            name = item.filename.replace('\\', '/')
            result = document(name, content, name.lower().endswith('.csv'))
            if result is not None:
                documents.append(result)
    if not documents:
        raise ValueError('NO_SPOTIFY_LIBRARY')
    return documents


if __name__ == '__main__':
    try:
        result = read(sys.stdin.buffer.read(MAX_UPLOAD + 1), sys.argv[1] if len(sys.argv) > 1 else 'Spotify.json')
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
    except Exception:
        # Never echo account contents, filesystem paths, or untrusted error messages.
        sys.stderr.write('INVALID_SPOTIFY_EXPORT')
        sys.exit(1)
