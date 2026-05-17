# @workspace/desktop

Electron wrapper for the Khana Lagao Restaurant Platform. Builds a native
desktop window (Windows `.exe`, macOS `.dmg`, Linux AppImage) that loads the
production web app and persists login between launches.

## Configure

Copy `.env.example` to `.env` and edit `APP_URL` if you want the window to
point at a non-production environment.

## Develop

```bash
pnpm --filter @workspace/desktop install
pnpm --filter @workspace/desktop start
```

## Build installers

```bash
pnpm --filter @workspace/desktop build:win    # Windows NSIS .exe
pnpm --filter @workspace/desktop build:mac    # macOS .dmg
pnpm --filter @workspace/desktop build:linux  # Linux AppImage
```

Artifacts land in `apps/desktop/dist/`.

> **Note:** building Windows installers from non-Windows hosts requires Wine
> (electron-builder will warn you if it is missing). macOS code signing
> requires a real Apple Developer ID certificate. See `docs/app-builds.md` for
> the full signing checklist.

## Auto-updates

The `electron-updater` feed URL in `package.json` is a placeholder
(`updates.khanalagao.example.com/desktop`). Replace it with a real feed
before shipping signed updates.

## Local print bridge

`src/print-bridge.cjs` is a stub for a future ESC/POS print bridge — it is
not wired up.
