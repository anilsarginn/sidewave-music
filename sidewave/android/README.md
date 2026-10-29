# Sidewave Android

Native Android 10+ client built with Kotlin, Compose and Media3. Application ID: `com.sarginlabs.sidewave`.

## Connect to your server

On first launch, open **Connection settings** and enter your Sidewave server origin, such as `https://music.example.com` or `http://192.168.1.10:4444`. Public servers require HTTPS. HTTP is accepted only for localhost or private numeric IPv4 addresses. Paths, credentials, query strings and fragments are not accepted. Localhost refers to the phone itself; use your server's LAN address on a physical phone.

Create an account or sign in on that server. This app installs separately from Sargın Music; accounts, downloads and signing keys are not migrated.

## Build

Requires JDK 17, Android SDK 35 and build tools 35.0.0. Set `ANDROID_HOME` or an ignored `local.properties` file containing `sdk.dir`.

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The debug build is for development. The release manifest is the phone/Android Auto configuration; the debug manifest also exposes the media browser to an Automotive emulator.

## Sign a release

Keep your keystore and signing properties outside the repository. The properties file must contain `storeFile`, `storePassword`, `keyAlias` and `keyPassword`; use an absolute keystore path.

```sh
SIDEWAVE_SIGNING_PROPERTIES=/private/path/signing.properties ./gradlew :app:assembleRelease
```

Without this environment variable the release APK is unsigned. Back up the key privately and keep it stable: Android updates require the same signing identity. Increase `versionCode` for every new APK.

## Publish an in-app update

From the repository root, verify and prepare a signed release:

```sh
python3 scripts/publish-android.py sidewave/android/app/build/outputs/apk/release/app-release.apk \
  --certificate-sha256 YOUR_CERTIFICATE_SHA256 \
  --notes-file release-notes.txt \
  --output ./artifacts/downloads
```

The script uses `ANDROID_HOME`/`ANDROID_SDK_ROOT` and `JAVA_HOME` (or Java on PATH). It verifies the signature, package and version, writes immutable versioned APKs, and updates `android-update.json` last. Set the server's `ANDROID_CERTIFICATE_SHA256` to the same 64-character digest and copy the generated files into its `/app/data/downloads` directory. The optional `--sdk` and `--java` arguments override tool locations.

The client checks updates when active and also offers a manual check in Settings. Download and installation require user action. Before installation, the client verifies the hash, package, version, minimum SDK and equality with its installed signing certificate. No production signing key or ready-to-install release is bundled in this repository.

## Playback and offline use

The Media3 service owns playback across the app, widgets, notifications and Android Auto. Completed phone downloads can play offline; provider caches and saved metadata alone do not make a recording available offline. Refresh playlists while connected to retain their metadata. Widgets and cover caches are account-scoped and cleared on sign-out.

## Android Auto and validation

Browse the library, favourites, playlists and completed downloads using the shared media session. Voice search searches metadata saved on the phone. For sideloaded media-app testing, consult [Android's testing guide](https://developer.android.com/training/cars/testing#unknown-sources).

Automated JVM tests and APK compilation do not establish real-car compatibility. Physical phone background playback, Bluetooth/call interruptions, offline playback, head-unit controls and prolonged use require separate manual validation. Settings includes diagnostics and a manual checklist. Crash reports remain local unless explicitly copied by the user.
