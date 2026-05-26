# KhanaLagao Restaurant (Desktop)

Electron desktop terminal that re-uses the existing KhanaLagao web POS and
adds desktop-only capabilities (system printers, ESC/POS, cash-drawer kick,
OS shortcuts, auto-launch, auto-update, local cart safety, offline banner).

- `desktop/main/` — Electron main process (TypeScript)
- `desktop/preload/` — typed `contextBridge` API exposed as `window.khanalagao`
- `desktop/renderer/` — launcher + settings panel + sandboxed `<webview>` shell
- `build/` — installer resources (icons, mac entitlements)
- `docs/desktop-pos-build.md` — full build, signing, printer, and update guide

## Quick commands

```bash
pnpm run dev          # launches renderer + Electron in dev mode
pnpm run package:win  # build KhanaLagao Restaurant Setup <version>.exe (NSIS)
pnpm run package:mac  # build KhanaLagao Restaurant <version>.dmg (universal)
```

> **Note:** Replit's hosted environment is Linux, so installer artifacts
> (.exe / .dmg) must be produced from a Windows / macOS dev machine or CI
> runner — electron-builder cannot cross-build signed installers from
> Linux. See the docs for the full matrix.

> **Note:** This package is **not** a Replit artifact preview — Electron
> apps don't run in the browser preview pane. It lives in `artifacts/`
> because it's a workspace package, but it is a desktop build target.
