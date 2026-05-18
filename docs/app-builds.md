# Installable app builds

The Khana Lagao Restaurant Platform ships as four installable surfaces, all
pointing at the same `restaurant-platform` web app:

| Target           | Where it lives           | What it produces                          |
| ---------------- | ------------------------ | ----------------------------------------- |
| PWA              | `artifacts/restaurant-platform/public/` | Browser-installable web app, offline shell |
| Desktop (Win/Mac/Linux) | `apps/desktop/`   | NSIS `.exe`, `.dmg`, AppImage             |
| Android          | `apps/android/`          | Debug `.apk`, release `.aab`              |
| iOS (scaffold)   | `apps/ios/`              | Xcode project ready for archive on macOS  |

No build target forks the web app — they all load the production web app
URL (`APP_URL`) inside a native shell, so a single deploy of
`restaurant-platform` updates every surface at once.

---

## 1. PWA

Implemented directly inside `artifacts/restaurant-platform`:

- `public/manifest.webmanifest` — name, theme color (`#e25a0f`), icons,
  `display: standalone`.
- `public/sw.js` — pre-caches the app shell + branded offline page,
  passes API and websocket traffic straight through to the network.
- `public/offline.html` — branded fallback shown when navigation fails.
- `src/lib/pwa.ts` — registers the service worker (production only).
- `src/components/install-prompt.tsx` — captures `beforeinstallprompt` and
  shows an in-app install card; dismissals are remembered for 14 days.

### Test installability

```bash
pnpm --filter @workspace/restaurant-platform build
pnpm --filter @workspace/restaurant-platform serve   # serves the built bundle
```

Open the URL in Chrome/Edge → DevTools → **Application** → **Manifest** and
**Service Worker** should both report no errors. The install icon should
appear in the omnibox on desktop, or via the browser menu on Android.

> **Offline scope:** only the app shell and a branded offline page work
> without a network. Live orders, tables, payments, etc. still require
> connectivity — we have **not** built offline POS.

### Regenerate icons

The manifest references `public/logo.png`, `public/favicon.png`, and
`public/favicon-32.png`. Replace those files in place to refresh icons; no
build step required.

---

## 2. Desktop (Electron)

Workspace: `apps/desktop/` (`@workspace/desktop`).

### Setup

```bash
pnpm --filter @workspace/desktop install
cp artifacts/restaurant-platform/public/logo.png apps/desktop/build/icon.png
```

### Configure

`apps/desktop/.env.example` lists the supported env vars:

| Var       | Default                          | Purpose                                  |
| --------- | -------------------------------- | ---------------------------------------- |
| `APP_URL` | `https://khanalagao.com/app/`    | URL loaded in the main window            |
| `API_URL` | _(empty)_                        | Optional API base override               |

Cookies and `localStorage` persist between launches automatically (Electron
default), so login survives restart. The main process loads
`apps/desktop/.env` automatically via `dotenv`, so you can either export
env vars in your shell or drop them into that file.

### Build installers

```bash
pnpm --filter @workspace/desktop build:win    # Windows NSIS .exe
pnpm --filter @workspace/desktop build:mac    # macOS .dmg (Intel + Apple Silicon)
pnpm --filter @workspace/desktop build:linux  # Linux AppImage
```

Artifacts land in `apps/desktop/dist/`.

### Signing

- **Windows:** acquire an EV or OV code-signing certificate, then set
  `CSC_LINK` (path or base64 of the `.pfx`) and `CSC_KEY_PASSWORD` before
  running `build:win`. electron-builder picks them up automatically.
- **macOS:** signing + notarisation requires an Apple Developer ID
  certificate, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
  `APPLE_TEAM_ID` env vars. Run `build:mac` on a Mac for best results.
- **Linux:** AppImages do not require signing.

### Auto-updates

`electron-updater` is wired to **GitHub Releases** as the update feed
(`apps/desktop/package.json` → `build.publish[]`, provider `github`,
owner `khanalagao`, repo `khanalagao`, `releaseType: "draft"`). On every
tag push, the desktop CI workflow runs `electron-builder --publish always`
(`release:win` / `release:mac` / `release:linux` scripts) so each matrix
job uploads its installer, blockmap, and `latest*.yml` metadata into a
shared **draft** release. A final job promotes the draft live once all
three OSes succeed, so partial releases never reach users. Already-
installed desktop apps poll the latest published release on next launch
and self-update — no manual download required.

To point the feed at a different repo (e.g. a private mirror), edit
`build.publish[0].owner` and `repo` in `apps/desktop/package.json` and
re-tag. For a non-GitHub feed (S3 bucket, generic HTTPS), swap the
provider block per the
[electron-builder publish docs](https://www.electron.build/configuration/publish)
and adjust the CI credentials accordingly (`AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` for S3, etc.). `GH_TOKEN` (the default
`secrets.GITHUB_TOKEN`) is enough for the GitHub provider; no extra
secret to configure.

### Local print bridge

`apps/desktop/src/print-bridge.cjs` is a deliberate stub for a future
ESC/POS printer bridge — it is not registered with the main process and
does not currently expose any native functionality.

---

## 3. Android (Capacitor)

Workspace: `apps/android/` (`@workspace/android`).

### First-time setup

The native Android project at `apps/android/android/` is **committed** to
the repo (generated by `npx cap add android`). A fresh clone only needs:

```bash
pnpm --filter @workspace/android install
cp artifacts/restaurant-platform/public/logo.png apps/android/resources/icon.png
cp artifacts/restaurant-platform/public/logo.png apps/android/resources/splash.png
pnpm --filter @workspace/android assets   # optional, regenerates icon/splash densities
pnpm --filter @workspace/android sync
```

Building the APK/AAB itself requires a local Android SDK and JDK 17
(Android Studio's bundled SDK works). The Replit sandbox does not ship
the full Android toolchain — run the build commands on a developer
machine or a CI runner with the SDK preinstalled.

### Build

```bash
pnpm --filter @workspace/android build:apk   # debug .apk for sideload
pnpm --filter @workspace/android build:aab   # release .aab (unsigned by default)
```

Outputs:

- `.apk` → `apps/android/android/app/build/outputs/apk/debug/app-debug.apk`
- `.aab` → `apps/android/android/app/build/outputs/bundle/release/app-release.aab`

### Signing for the Play Store

Read `apps/android/keystore.example` end-to-end. Summary:

1. Generate a release keystore once with `keytool`.
2. Set `KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` in
   a local `.env` (never committed).
3. Wire `signingConfigs.release` into
   `apps/android/android/app/build.gradle` to read those env vars.
4. Re-run `build:aab` — the bundle is signed and ready for upload to
   Play Console → **Internal testing** → **Production**.

### Changing the URL the Android app loads

`APP_URL` in `apps/android/.env.example` is informational only — the WebView
URL is read from `capacitor.config.json`'s `server.url` at build time. To
point the Android build at a different environment (staging, branch
preview, etc.):

1. Edit `apps/android/capacitor.config.json` and change `server.url`.
2. Also update `APP_URL` in `apps/android/www/index.html` (the fallback
   bootstrap page) so it matches.
3. Run `pnpm --filter @workspace/android sync` to push the new config into
   the native project.

(There is no automated env-substitution step yet — a future improvement
could pre-process the Capacitor config from `APP_URL`.)

### Updating the web app

Because `capacitor.config.json` sets `server.url` to the live URL, you do
**not** need to ship a new APK every time you deploy the web app — the
WebView reloads the new content on next launch.

---

## 4. iOS (scaffold only)

Workspace: `apps/ios/` (`@workspace/ios`).

> **You cannot build a signed `.ipa` from Replit.** Apple's tooling
> (Xcode, codesign, altool) only runs on macOS, and submission requires a
> paid Apple Developer account. This package gives a Mac-equipped developer
> a one-command path to a working Xcode project; they are still responsible
> for signing and uploading.

### On macOS

The native Xcode project at `apps/ios/ios/` is **committed** to the repo
(generated by `npx cap add ios` — bundle id `com.khanalagao.app`, display
name "Khana Lagao", Info.plist baseline in place). A Mac developer only
needs:

```bash
pnpm --filter @workspace/ios install
cp artifacts/restaurant-platform/public/logo.png apps/ios/resources/icon.png
cp artifacts/restaurant-platform/public/logo.png apps/ios/resources/splash.png
pnpm --filter @workspace/ios assets    # optional, regenerates icon/splash sizes
pnpm --filter @workspace/ios sync
cd apps/ios/ios/App && pod install     # CocoaPods only available on macOS
pnpm --filter @workspace/ios open      # opens Xcode
```

In Xcode:

1. **Signing & Capabilities** → enable automatic signing, select your team.
2. Verify bundle id is `com.khanalagao.app` (or whichever id is registered
   in App Store Connect).
3. **Product → Archive** → upload to **App Store Connect** → distribute to
   **TestFlight** for internal testing, then submit for review.

### Changing the URL the iOS app loads

Same model as Android — `APP_URL` in `apps/ios/.env.example` is
informational. To retarget the iOS WebView:

1. Edit `apps/ios/capacitor.config.json` → `server.url`.
2. Edit `apps/ios/www/index.html` → `APP_URL`.
3. Run `pnpm --filter @workspace/ios sync`.

### Info.plist

See `apps/ios/info-plist-notes.md` for the permission usage strings you
must add the moment a sensitive iOS API (camera, photos, location) is
called from the WebView. Apple will reject the binary without them.

---

## First-time setup checklist

- [ ] Pick a final app icon and copy it into all four resource folders.
- [ ] Decide on the final bundle/app id (`com.khanalagao.app` today).
- [ ] Register the app id in:
  - [ ] Apple Developer → Certificates, Identifiers & Profiles.
  - [ ] Google Play Console → Create app.
  - [ ] Microsoft Partner Center (only if shipping to the Microsoft Store).
- [ ] Acquire signing material:
  - [ ] Windows code-signing certificate (`.pfx`).
  - [ ] Apple Developer ID + App Store Connect API key.
  - [ ] Android release keystore (`.jks`) — store off-repo.
- [ ] Confirm the `electron-updater` feed (GitHub Releases on
  `khanalagao/khanalagao` by default — change `build.publish` in
  `apps/desktop/package.json` if you ship from a different repo).
- [ ] Wire signing env vars into your CI secrets, **not** the repo.

---

## What stays in Replit vs. what doesn't

Replit can build:

- PWA (just `restaurant-platform build`).
- Linux AppImage (Electron, with the right toolchain installed via Nix).

Replit cannot reliably build:

- Windows `.exe` (needs Wine or a Windows runner — works on a dev box).
- macOS `.dmg` (Apple signing + notarisation needs a Mac).
- Android `.apk`/`.aab` (needs Android SDK + JDK 17).
- iOS `.ipa` (needs macOS + Xcode + Apple Developer account).

Run those on a developer workstation or a dedicated CI runner.

---

## 5. CI release pipelines (GitHub Actions)

Two workflows live in `.github/workflows/` and turn a tag push into a
one-click release. Both attach their outputs to the matching GitHub
Release so the team can download installers without a developer in the
loop.

### Desktop — `.github/workflows/desktop-release.yml`

- **Triggered by:** pushing a tag matching `v*` or `desktop-v*`, or a
  manual `workflow_dispatch`.
- **Runners:** `windows-latest`, `macos-latest`, and `ubuntu-latest` in a
  matrix.
- **Build commands** (the workflow auto-selects per trigger):
  - **Tag push** → `release:win` / `release:mac` / `release:linux`
    (`electron-builder --publish always`, uploads installers +
    `latest*.yml` to a GitHub Release **draft** on each matrix job)
  - **Manual `workflow_dispatch`** → `build:win` / `build:mac` /
    `build:linux` (`--publish never`, dry-run that exercises the build
    pipeline without touching the live update feed)
- **Outputs:** installers from `apps/desktop/dist/` uploaded as workflow
  artifacts on every run. On tag pushes, electron-builder also publishes
  to the GitHub Release draft (NSIS `.exe`, `.dmg`, AppImage, blockmaps,
  plus electron-updater `latest*.yml` metadata). A final `release` job
  then flips the draft live and appends auto-generated release notes —
  the release is published atomically once all three matrix jobs
  succeed, so a partial build never reaches installed desktop apps.

Required CI secrets (Repo → Settings → Secrets and variables → Actions):

| Secret name                   | Used by  | Purpose                                                 |
| ----------------------------- | -------- | ------------------------------------------------------- |
| `CSC_LINK`                    | Windows  | Base64 or HTTPS URL of the Windows code-signing `.pfx`  |
| `CSC_KEY_PASSWORD`            | Windows  | Password for the Windows `.pfx`                         |
| `MAC_CSC_LINK`                | macOS    | Base64 or HTTPS URL of the macOS Developer ID `.p12`    |
| `MAC_CSC_KEY_PASSWORD`        | macOS    | Password for the macOS `.p12`                           |
| `APPLE_ID`                    | macOS    | Apple ID used for notarisation                          |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS    | App-specific password for the Apple ID                  |
| `APPLE_TEAM_ID`               | macOS    | Apple Developer team ID for notarisation                |
| `GITHUB_TOKEN`                | release  | Provided automatically; uploads assets to the release   |

The macOS job uses `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` (mapped onto
`CSC_LINK` / `CSC_KEY_PASSWORD` for electron-builder at run-time) so the
Windows and macOS certificates never collide in one secret.

### Android — `.github/workflows/android-release.yml`

- **Triggered by:** pushing a tag matching `v*` or `android-v*`, or a
  manual `workflow_dispatch`.
- **Runner:** `ubuntu-latest` with JDK 17 (`actions/setup-java`) and the
  Android SDK (`android-actions/setup-android`).
- **Build commands:**
  - `pnpm --filter @workspace/android build:aab` (signed release bundle)
  - `pnpm --filter @workspace/android build:apk` (debug `.apk` for QA)
- **Outputs:** `app-release.aab` and `app-debug.apk` uploaded as workflow
  artifacts and attached to the GitHub Release, ready to drag into the
  Play Console.

The keystore is delivered to CI as a base64-encoded secret, decoded into
`$RUNNER_TEMP` for the build, and deleted in an `always()` cleanup step.
The build fails fast if `ANDROID_KEYSTORE_BASE64` is missing — we never
ship an unsigned release bundle.

Required CI secrets:

| Secret name                | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `ANDROID_KEYSTORE_BASE64`  | Base64-encoded contents of the release `.jks` keystore |
| `KEYSTORE_PASSWORD`        | Password for the keystore                              |
| `KEY_ALIAS`                | Alias of the signing key inside the keystore           |
| `KEY_PASSWORD`             | Password for the signing key alias                     |
| `GITHUB_TOKEN`             | Provided automatically; uploads assets to the release  |

To encode the keystore for the secret:

```bash
base64 -w0 khanalagao-release.jks   # Linux
base64 -i khanalagao-release.jks    # macOS
```

Paste the result into the `ANDROID_KEYSTORE_BASE64` secret. The
workflow writes it back out to `release.jks` and exports
`KEYSTORE_PATH`. `apps/android/android/app/build.gradle` reads
`KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, and `KEY_PASSWORD`
from the environment and applies them as `signingConfigs.release`,
bound to `buildTypes.release.signingConfig`. A guard in the same file
aborts any `bundleRelease` / `assembleRelease` task graph when those
env vars are missing, so an unsigned `.aab` cannot accidentally ship.

### Cutting a release

```bash
git tag v1.4.0
git push origin v1.4.0
```

Both workflows run in parallel. Once they finish, the release at
`https://github.com/<org>/<repo>/releases/tag/v1.4.0` will have the
Windows, macOS, Linux installers plus the Android `.aab` and debug
`.apk` attached. Use `desktop-v*` or `android-v*` prefixes if you want
to ship only one platform.
