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

`electron-updater` ships updates via **GitHub Releases** (see
`build.publish` in `package.json`, provider `github`, repo
`khanalagao/khanalagao`, `releaseType: "draft"`). CI runs
`electron-builder --publish always` via the `release:win` /
`release:mac` / `release:linux` scripts on every tag push, uploading
installers + `latest*.yml` into a shared draft release; a final job
promotes the draft live once all three OSes succeed so installed apps
only ever see complete releases. Manual `workflow_dispatch` runs use
the `build:*` scripts (`--publish never`) and never touch the live
feed. See `docs/app-builds.md` for how to retarget a different repo or
swap in an S3/generic feed.

## Local print bridge

`src/print-bridge.cjs` talks to USB and network ESC/POS thermal printers via
[`node-thermal-printer`](https://www.npmjs.com/package/node-thermal-printer)
and exposes a small RPC surface to the renderer through `preload.cjs`:

```js
await window.khanalagao.printer.list();
await window.khanalagao.printer.save({ kind: "network", name: "Counter",
                                       host: "192.168.1.50", port: 9100 });
await window.khanalagao.printer.test(printerId);
await window.khanalagao.print({ template: "receipt", payload: orderArgs });
```

Configured printers persist in `<userData>/printer-config.json`. The web app
detects the bridge via `window.khanalagao.isDesktop` and routes its existing
print buttons (receipts, kitchen tickets) through it, falling back to the
browser print dialog when running in a regular tab.

Cashiers manage printers from **Settings → Devices & Hardware** — a
"Local thermal printers (this computer)" panel appears at the top of that
page only when the app is opened in the desktop wrapper.
