# Rental Review mobile apps

Native Android (Kotlin, Jetpack Compose) and iOS (Swift, SwiftUI) apps with the
same features as the web app in `fronend/webUI`:

- **Browse:**
  - map with rating pins and bubbles
  - search: your own buildings first, then Ola Maps or Photon, plus typed coordinates
  - nearest-first list of places
  - a place's flats, with Tenant Reviews and Interactions tabs
- **Account:**
  - Google sign-in, including reactivation of a deactivated account
  - share and edit tenant reviews, share interactions
  - add a place or a flat
  - the notebook: your places, reviews, interactions and deletion requests, plus the admin queue
  - change your name, sign out, deactivate your account
- **Legal:** Privacy Policy and Delete your data open the site's pages.

**Supported versions:** Android 6.0+ (minSdk 23, the oldest Compose and AndroidX
support; `java.time` is desugared for 6.0–7.1) and iOS 15+ (iPhone 6s and newer). The
iOS app avoids iOS 16/17-only SwiftUI: state is an `ObservableObject`, and
`UI/Compat.swift` falls back to NavigationView, full-height sheets and TextEditor on
iOS 15. Raising either minimum needs nothing beyond the version setting.

Both apps use the same `/api/v1` backend as the web app and the same map
setting: `GET /map/config` chooses Ola Maps or OpenStreetMap. MapLibre's native
SDK draws the map. Rating pins and bubbles are drawn as native views on top of
it, so they look the same on either provider.

```text
android/  Gradle project (app module). Packages: data (API client, models),
          maps (provider, clustering), search, auth (Google), ui (screens)
ios/      Xcode project. Folders: Data, Maps, Search, Auth, UI; Config holds
          Info.plist and Google.xcconfig. MapLibre and GoogleSignIn come from
          Swift Package Manager.
```

## Running against the local stack

Start the stack (`make up` in the repo root). Debug builds call the web
container on port 8088, which forwards `/api` to the backend.

- **Android:** open `android/` in Android Studio and run the `app` configuration
  on an emulator. The emulator reaches the host at `10.0.2.2:8088`. Plain HTTP
  is allowed only in debug builds.
  - Command line: `./gradlew :app:assembleDebug`, with `JAVA_HOME` set to a
    JDK 17 or newer, e.g. Android Studio's bundled one.
- **iOS:** open `ios/RentalReview.xcodeproj` in Xcode and run on a simulator.
  The simulator reaches `localhost:8088`.

Release builds use `https://rentalreview.boringman.in`.

## Google sign-in setup

The backend accepts ID tokens for every client id in `GOOGLE_CLIENT_IDS`.
`/auth/providers` returns the first one, so **keep the web client id first**.

- **Android:** in Google Cloud Console, create an **Android** OAuth client with
  package `com.boringman.rentalreview` and your signing certificate's SHA-1
  (`./gradlew signingReport`). Nothing goes in the app itself: it asks the
  backend for the web client id, and its tokens are issued for that id.
- **iOS:** create an **iOS** OAuth client with bundle id
  `com.boringman.rentalreview`.
  1. Put its client id and reversed client id in `ios/Config/Google.xcconfig`.
  2. Add the client id to the backend's `GOOGLE_CLIENT_IDS`, after the web one:
     `GOOGLE_CLIENT_IDS=<web id>,<ios id>`.

Until this is done, signing in shows an error and browsing still works.

## CI/CD

The Android and iOS pipelines are separate, the same way as in meal-manager:
`ci/android.sh` and `ci/ios.sh` hold the steps, and the GitHub workflows
(`.github/workflows/android.yml`, `ios.yml`) and GitLab includes
(`.gitlab/android.yml`, `ios.yml`) call them. The apps have no test suite, so
checks only lint and build.

| | Android | iOS |
|---|---|---|
| **Check** (PRs and pushes that touch the app) | `lintDebug` + `assembleDebug`, debug APK kept 7 days | simulator build |
| **Release trigger** | push to `main` touching Android files, or a manual run | `ios-vX.Y.Z` tag, or a manual run |
| **Output** | signed `.aab` + `.apk` in `dist/android/` (kept 30 days) | signed `.ipa` in `dist/ios/` (kept 30 days) |
| **Upload** | Google Play, when `PLAY_PUBLISH_ENABLED=true` | TestFlight, when `IOS_PUBLISH_ENABLED=true` |
| **GitHub environment / GitLab** | `play` | `app-store`; GitLab needs a macOS runner tagged `macos` |

Version codes and build numbers are minutes since 2026-01-01 UTC, so they always
increase without stored state. `APP_BASE_URL` (optional variable) overrides the
site release builds use; it defaults to `https://rentalreview.boringman.in`.

**Android secrets** (`play` environment): `ANDROID_KEYSTORE_BASE64` (`base64 -i upload.jks`),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and for uploads
`PLAY_SERVICE_ACCOUNT_JSON`. Variables: `PLAY_PUBLISH_ENABLED`, `PLAY_TRACK` (default
`internal`), `PLAY_RELEASE_STATUS` (`draft` until the app's first release is published
in Play Console, then `completed`). Create the app in Play Console and upload the
first bundle by hand; the API can only add later releases. Add the Play upload key's
SHA-1 (and Play App Signing's) to the Android OAuth client so Google sign-in works.

**iOS secrets** (`app-store` environment): `IOS_DIST_P12_BASE64` and `IOS_DIST_P12_PASSWORD`
(Apple Distribution certificate), `IOS_PROFILE_BASE64` (App Store provisioning profile
for `com.boringman.rentalreview`), and for uploads `ASC_KEY_ID` and `ASC_KEY_BASE64`
(an individual App Store Connect API key). Variable: `IOS_PUBLISH_ENABLED`. The team
is `DEVELOPMENT_TEAM` in `ios/Config/Base.xcconfig`. Releases refuse to build until
`ios/Config/Google.xcconfig` has the iOS client ids.
