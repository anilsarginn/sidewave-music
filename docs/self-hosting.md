# Self-hosting Sidewave

## Storage

The default Compose project uses named volumes `app-data`, `jobs` and, with the library profile, `navidrome-data`. Your music directory is mounted read-only. Do not use `docker compose down -v` when you want to retain data.

For a consistent offline backup, stop the app, archive its data volume, and then start it again. Back up the Navidrome data volume separately if enabled. Restore into an installation running the same release before upgrading.

## HTTPS

Point your existing HTTPS reverse proxy at port 4444. Set `MUSIC_PUBLIC_ORIGIN` to the exact browser origin, such as `https://music.example.com`, then recreate the app with `docker compose up -d sidewave`. This controls secure cookies, origin checks and shared links. No specific tunnel provider is required.

Use `BIND_ADDRESS=127.0.0.1` if a reverse proxy on the same machine is the only intended entry point. On a LAN, the default `0.0.0.0` binding allows phones to use the server's LAN IP. Firewall and router configuration remain specific to your installation.

## Navidrome

The optional `library` profile provides Navidrome. The API and Navidrome must see the same music files. A separate existing Navidrome instance can also be used; configure `NAVIDROME_URL`, `NAVIDROME_USER` and `NAVIDROME_PASS` in `.env`.

When Docker runs on a remote host, Navidrome's localhost-only setup interface can be reached with an SSH tunnel: `ssh -L 4533:127.0.0.1:4533 your-server`.

## Optional integrations

- `ONLINE_SONIC_URL`: an optional `sonic-online` worker. It uses a pinned AudioMuse image and is intentionally absent from the default Compose stack.
- `AUDIOMUSE_URL`, `AUDIOMUSE_TOKEN`, `SONIC_NAVIDROME_URL`: optional full-library audio analysis.
- Archive ingestion is disabled by default. Enabling it requires a separately configured slskd service, credentials, a matching filesystem layout and an ingestion helper. The `beets/` helper is included for advanced setups; the default installation does not configure this pipeline.
- `ANDROID_CERTIFICATE_SHA256`: the fingerprint of your own Android signing certificate. Set it before using a hosted Android update manifest. See the Android README.

No example setting contains a working credential. Telegram notifications are not configured by the default stack.

## Diagnostics and limits

- `/api/health` checks the API/database; `/api/status` reports dependencies.
- Missing optional services can yield unavailable features while the rest of the app remains usable.
- Metadata, playback and lyrics depend on third-party services and may vary by network, region and provider changes. Tests with mock providers do not establish live catalog availability.
- Native car behavior, battery use and long-running playback need physical-device checks for your deployment.
