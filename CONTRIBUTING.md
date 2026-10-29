# Contributing

Small, focused fixes with a clear reproduction are welcome. Discuss changes to playback, account separation, Android Auto and the API contract before large implementations.

## Before opening a pull request

1. Run `npm ci && npm test` in `sidewave/`.
2. Run `npm ci && npm test && npm run build` in `sidewave/web/`.
3. If the API contract changed, regenerate models and run `node scripts/generate-models.mjs --check` in `sidewave/`.
4. For resolver changes, run its pytest suite using the documented virtual environment.
5. For Android changes, run `./gradlew :app:testDebugUnitTest :app:assembleDebug` with JDK 17 and Android SDK 35.
6. Exercise the changed behavior on the appropriate browser or device. Distinguish mocked tests from real playback results.

Use synthetic fixtures. Keep account exports, credentials, audio libraries, logs, database files and signing keys outside Git. Describe the problem, resulting behavior and checks in the pull request.

Contributions to original project code are submitted under the repository's MIT license. Preserve third-party notices.
