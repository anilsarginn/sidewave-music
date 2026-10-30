# Sidewave 0.1.0

**Your music, your space.** Self-hosted listening and sound discovery for the web, Android and Android Auto, by Sargın Labs.

- **Follow a sound:** Similar tracks, Instant mix and a Sound journey between two library recordings. Optional audio analysis compares short excerpts and labels audio similarity separately from catalog recommendations.
- **Make the next discovery:** Daily Mixes, Discover Weekly, Smart Shuffle, song radio and eight Sidewave Sessions.
- **Stay in the music:** Now Playing with synced lyrics, a persistent queue, listening stats, crossfade, even volume and a sleep timer.
- **Make it yours:** Four signature backgrounds, custom photos and device-local dimming/transparency controls.
- **Listen on the move:** Native Android playback, offline downloads, home-screen widgets and an Android Auto media browser.
- **Bring your collection:** Optional Navidrome library, playlist imports, Spotify data-export matching, sharing and collaborative playlists.

[Explore the updated feature tour and screenshot gallery](https://github.com/anilsarginn/sidewave-music#readme) · [Self-hosting guide](https://github.com/anilsarginn/sidewave-music/blob/main/docs/self-hosting.md)

## Downloads

The attached Android APK is a **debug/development build** with application ID `com.sarginlabs.sidewave`. Build and sign your own release for a lasting installation. The source ZIP captures the original 0.1.0 release; current documentation and screenshots are on `main`.

The default Docker setup includes the web/API and internal catalog resolver. Sound journey and library artist similarity require a configured library-analysis service; online excerpt analysis requires the optional `sonic-online` worker. Provider availability and real phone/car behavior depend on your deployment.

Original code is MIT licensed. No personal music library, account database, credentials or signing keys are included.
