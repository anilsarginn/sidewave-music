# Sidewave interface gallery

Updated 30 October 2026. The web gallery uses the **Anıl** demo account and the bundled **Midnight Coast** background, with 10% dimming and 85% panel transparency.

The images show the actual interfaces. Track and artist names, playlist contents, lyrics, listening data, discovery scores and analysis progress are synthetic presentation fixtures. Cover images and signature backgrounds are bundled Sidewave artwork. The video and emulator player use generated silent PCM audio. No personal listening account or external catalog is used for capture.

## Web gallery

| File | View |
| --- | --- |
| `web.png` | Home, recent music and Daily Mixes |
| `login.png`, `signup.png` | Sign-in and account creation |
| `sound-discovery.png` | Similar tracks with illustrative audio/catalog provenance |
| `sound-journey.png` | Two endpoints and an illustrative route through library tracks |
| `sessions.png` | Eight Sidewave Sessions |
| `mix.png` | Daily Mix track list |
| `now-playing.png`, `lyrics.png` | Player, queue and expanded lyrics |
| `appearance.png` | Background selection, dimming and transparency |
| `mobile-login.png`, `mobile-web.png`, `mobile-player.png` | Responsive mobile web, not the native Android app |
| `demo.mp4` | Silent tour through the web interface |

### Reproduce the web capture

From the repository root, install the optional capture tools in an ignored environment:

```sh
mkdir -p artifacts
python3 -m venv artifacts/capture-env
artifacts/capture-env/bin/pip install playwright
artifacts/capture-env/bin/python -m playwright install chromium
```

Build and start the real web client in another terminal:

```sh
cd sidewave/web
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 14445 --strictPort
```

Capture from the repository root:

```sh
artifacts/capture-env/bin/python scripts/capture-presentation.py
```

The script mocks API responses in the browser, selects the actual appearance settings and navigates the real UI. It checks the Anıl greeting, selected background, image loading, page errors, unexpected external requests and horizontal overflow. It writes screenshots here and intermediate video/report files to `artifacts/presentation/`. Override the preview address with `SIDEWAVE_PREVIEW_URL` or intermediate directory with `SIDEWAVE_CAPTURE_DIR`.

`capture-report.json` identifies the recorded WebM. Convert it with FFmpeg to update `demo.mp4`:

```sh
ffmpeg -i PATH_FROM_CAPTURE_REPORT -c:v libx264 -crf 25 -pix_fmt yuv420p \
  -movflags +faststart -an docs/screenshots/demo.mp4
```

## Car media browser

`car-home.png`, `car-discover.png`, `car-library.png`, `car-tracks.png` and `car-player.png` are unretouched screenshots from a fresh **Android Automotive OS 13 emulator**, 1280 × 720, running the Sidewave 0.1.0 debug preview harness (`com.sarginlabs.sidewave`). The host renders the actual Media3 media library and player with a synthetic local server and silent sample stream.

The debug manifest exposes the shared browser to this host. The phone release retains its Android Auto configuration. This gallery demonstrates the shared media-browser interface; projected Android Auto, vehicle hardware and OEM layouts can differ. Audible output and real-driving acceptance were not measured.
