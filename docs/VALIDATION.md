# Release preparation checks

Checked locally on 2026-10-29 for the first Sidewave source release.

| Check | Result |
| --- | --- |
| API tests | 140 passed |
| Web unit tests | 51 passed |
| Resolver tests | 66 passed |
| Android JVM tests | 49 passed |
| Browser tests, desktop and mobile | 89 passed, 1 platform-specific skip |
| TypeScript and Vite production build | Passed |
| Generated API models | No drift |
| Android debug APK | Built; package `com.sarginlabs.sidewave`, version `0.1.0`, code `1` |
| APK update preparation | Signature/package verified; matching certificate accepted, mismatched certificate rejected |
| Docker Compose default setup | Both services built and started in a separate test project; API/database health passed |
| Fresh installation flows | Signup, first-account ownership, login/logout, isolated playlists, authenticated and owner-only routes passed |
| Secret scan | Gitleaks 8.30.1: no findings in exported source |
| Private deployment references | No original host address, local home path, original application identifier or signing fingerprint in exported source |

Browser checks passed with one worker. Earlier concurrent runs showed intermittent mobile timing/focus failures; CI uses one worker. A reproducible 320 px navigation-label overflow was corrected and passed the final suite.

Screenshots and the silent demo use synthetic metadata and bundled artwork. Browser tests mock providers; they do not establish real provider access. The default Docker setup was checked without a music collection or optional Navidrome/audio-analysis services. The development APK is not a production-signed release. Physical phone, long background playback, Bluetooth and car/head-unit acceptance remain manual checks.

Secret scanning is a point-in-time automated check, not a guarantee of security. Personal installation data and previous Git history are excluded from this repository.

## Presentation refresh — 30 October 2026

The refreshed web gallery was captured with the Anıl demo profile and Midnight Coast background. The capture script verified the selected appearance, expected screens, loaded artwork, no browser page errors, no external API requests and no document overflow. Car images were captured from the actual shared Media3 browser in a fresh Automotive OS 13 emulator using synthetic catalog data and silent sample audio; see [gallery provenance](screenshots/README.md).

The mobile track-menu focus now uses `preventScroll`, so focusing a menu item does not scroll the page. Queued scroll events from revealing the trigger are ignored unless the scroll position changes after opening. The existing mobile queue/menu test passed eight consecutive runs; all 89 applicable desktop/mobile browser tests and 51 web unit tests passed, and the production build passed. CI explicitly requests `platform-tools` during Android setup to avoid the retired `tools` package.
