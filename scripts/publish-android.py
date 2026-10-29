#!/usr/bin/env python3
"""Verify a signed APK, publish immutable bytes, and switch update metadata last."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent



def publish(apk, output, sdk, java, notes, certificate):
    if not re.fullmatch(r"[a-f0-9]{64}", certificate):
        raise ValueError("Expected a lowercase 64-character signing certificate SHA-256")
    tools = sdk / 'build-tools/35.0.0'
    verified = subprocess.check_output([str(java), '-jar', str(tools / 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', str(apk)], text=True)
    certificates = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([a-f0-9]+)', verified)
    if certificates != [certificate]:
        raise ValueError('APK certificate differs from the configured Sidewave signing key')
    badging = subprocess.check_output([str(tools / 'aapt'), 'dump', 'badging', str(apk)], text=True)
    package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
    minimum = re.search(r"sdkVersion:'(\d+)'", badging)
    if not package or package[1] != 'com.sarginlabs.sidewave' or not minimum:
        raise ValueError('APK package metadata is invalid')
    size = apk.stat().st_size
    if not 0 < size <= 250 * 1024 * 1024 or len(notes) > 4000:
        raise ValueError('Invalid release size or notes')
    digest = hashlib.file_digest(apk.open('rb'), 'sha256').hexdigest()
    code = int(package[2]); output.mkdir(parents=True, exist_ok=True)
    release = {'packageName': package[1], 'versionCode': code, 'versionName': package[3], 'minSdk': int(minimum[1]),
               'sizeBytes': size, 'sha256': digest, 'certificateSha256': certificate,
               'url': f'/downloads/sidewave-{code}.apk', 'notes': notes,
               'publishedAt': datetime.now(timezone.utc).isoformat()}
    if code < 1 or code >= 2147483647 or release['minSdk'] < 29:
        raise ValueError('Invalid version or minimum Android SDK')
    pointer = output / 'android-update.json'
    if pointer.exists():
        previous = json.loads(pointer.read_text())
        if code < previous['versionCode'] or (code == previous['versionCode'] and digest != previous['sha256']):
            raise ValueError('Release version must increase; published version codes cannot be reused')
    versioned = output / f'sidewave-{code}.apk'
    if versioned.exists() and hashlib.file_digest(versioned.open('rb'), 'sha256').hexdigest() != digest:
        raise ValueError('Immutable APK already exists with different bytes')

    def atomic(destination, source=None, content=None):
        fd, temporary = tempfile.mkstemp(prefix='.publish-', dir=output)
        try:
            with os.fdopen(fd, 'wb') as target:
                if source:
                    with source.open('rb') as stream:
                        shutil.copyfileobj(stream, target)
                else:
                    target.write(content)
                target.flush(); os.fsync(target.fileno())
            os.chmod(temporary, 0o644); os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    if not versioned.exists():
        atomic(versioned, source=apk)
    atomic(output / 'sidewave.apk', source=apk)
    atomic(pointer, content=(json.dumps(release, ensure_ascii=False, indent=2) + '\n').encode())
    print(json.dumps(release, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'sidewave/data/downloads')
    parser.add_argument('--sdk', type=Path, default=os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT'))
    parser.add_argument('--java', type=Path, default=str(Path(os.environ['JAVA_HOME']) / 'bin/java') if os.environ.get('JAVA_HOME') else shutil.which('java'))
    parser.add_argument('--certificate-sha256', required=True)
    parser.add_argument('--notes-file', type=Path, required=True)
    args = parser.parse_args()
    if not args.sdk or not args.java:
        parser.error('Set ANDROID_HOME/JAVA_HOME or provide --sdk and --java')
    publish(args.apk, args.output, args.sdk, args.java, args.notes_file.read_text().strip(), args.certificate_sha256)
