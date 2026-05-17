# @workspace/android

Capacitor Android wrapper for the Khana Lagao Restaurant Platform.

The WebView is pointed straight at the production web app
(`https://khanalagao.com/app/`) via `capacitor.config.json`'s `server.url`,
so we don't ship a copy of the SPA inside the APK — it stays in sync with
the live deployment automatically.

## First-time setup

The native Android project at `apps/android/android/` is **already
committed** — a fresh clone is ready to build. You only need:

```bash
pnpm --filter @workspace/android install
pnpm --filter @workspace/android assets   # regenerates icons + splash from resources/ (optional)
pnpm --filter @workspace/android sync     # copies www/ + plugins into the native project
```

Requires a local Android SDK and JDK 17 — see `docs/app-builds.md`.

> Only re-run `npx cap add android` if you have deleted `apps/android/android/`
> and need to regenerate it from scratch.

## Build

```bash
pnpm --filter @workspace/android build:apk   # debug .apk for sideload testing
pnpm --filter @workspace/android build:aab   # release .aab (unsigned by default)
```

Outputs land in `apps/android/android/app/build/outputs/`.

## Signing

See `keystore.example` for the release-signing wiring. Never commit a real
keystore. Full Play Console upload steps are in `docs/app-builds.md`.
