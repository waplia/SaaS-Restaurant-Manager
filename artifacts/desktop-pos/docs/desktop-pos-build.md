# Khanalagao POS — desktop build & operations guide

This package (`@workspace/desktop-pos`) wraps the existing Khanalagao web POS
in an Electron shell that produces real native installers:

| Platform | Output                                  | Target  |
|----------|-----------------------------------------|---------|
| Windows  | `release/Khanalagao POS Setup x.y.z.exe`| NSIS x64 |
| macOS    | `release/Khanalagao POS x.y.z.dmg`      | DMG universal (Intel + Apple Silicon) |

## Why an Electron shell?

The web POS is the source of truth — menus, cart math, KOT routing, shifts,
payments and the receipt template all live in `artifacts/restaurant-platform`.
The desktop shell adds capabilities the browser cannot offer:

- **Silent ESC/POS printing** to thermal receipt + KOT printers (no print dialog).
- **Cash drawer kick** over the receipt printer (`ESC p 0 25 250`).
- **Per-station printer routing** (bill, KOT, kitchen, bar, parcel).
- **Local cart safety** — the cart is mirrored to disk; if the terminal
  crashes mid-bill, the next launch recalls it.
- **Backend-verified payments** — the renderer never self-marks paid; settles
  always go through the existing `/payments` API.
- **Auto-update** via electron-updater + a generic feed (`updateFeedUrl`
  setting; null = no checks, no errors).
- **Auto-launch at login**, fullscreen mode, screen-awake during the shift.
- **Hardened Electron baseline**: `contextIsolation`, no `nodeIntegration`,
  navigation lockdown, strict CSP, single-instance guard.
- **Keyboard shortcuts, sound, calculator, shift management** are already in
  the web POS shell and work unchanged when loaded via the desktop webview.

## Prerequisites

| Build target | Required host OS | Toolchain |
|--------------|------------------|-----------|
| Windows installer | Windows 10/11 x64 | Node 20+, pnpm 9+, optional code-sign cert |
| macOS DMG | macOS 13+ (Apple Silicon or Intel) | Node 20+, pnpm 9+, Xcode CLT, Apple Developer ID for signing/notarization |

> **Cross-compilation note.** electron-builder cannot produce a signed,
> notarized `.dmg` from Linux or Windows, and cannot produce a signed `.exe`
> from macOS without `wine` and a Windows code-sign cert. Always build each
> target on its own OS in CI (GitHub Actions runners `windows-latest` and
> `macos-14` are the canonical pair).
>
> The Replit Linux container used during development **cannot** produce the
> final installers; it can compile main/preload/renderer and validate the
> packaging config, but `pnpm run build:win` / `build:mac` must be run on the
> matching host.

## Build commands

```bash
# Install workspace deps (once, from repo root)
pnpm install

# Type-check everything
pnpm --filter @workspace/desktop-pos run typecheck

# Compile main, preload and renderer bundles → dist/
pnpm --filter @workspace/desktop-pos run build

# Produce installers
pnpm --filter @workspace/desktop-pos run build:win    # → release/*.exe
pnpm --filter @workspace/desktop-pos run build:mac    # → release/*.dmg
```

Before the first packaged build, replace the icon placeholders in `build/`:

- `build/icon.ico` (Windows, 256×256, multi-resolution)
- `build/icon.icns` (macOS, 1024×1024)

Drop sound files into `assets/sounds/` (see the README in that folder).

## Code signing & notarization

### Windows
Set the standard electron-builder env vars before `build:win`:

```
CSC_LINK=path-or-base64-of-pfx
CSC_KEY_PASSWORD=••••
```

### macOS
```
CSC_LINK=path-to-Developer-ID.p12
CSC_KEY_PASSWORD=••••
APPLE_ID=you@example.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=ABCDE12345
```
electron-builder picks these up automatically and notarizes the DMG.

## Automated CI builds

A GitHub Actions workflow at `.github/workflows/desktop-pos-release.yml`
produces the real installers on the matching hosts:

- Triggers on pushes of tags matching `desktop-pos-v*` (and via manual
  `workflow_dispatch`).
- `windows-latest` runner → `Khanalagao POS Setup x.y.z.exe` + `latest.yml`.
- `macos-14` runner → `Khanalagao POS x.y.z.dmg` + `latest-mac.yml`.
- Each installer is uploaded as a workflow artifact, and on tag pushes
  electron-builder publishes them straight to the matching GitHub Release
  (so the same Release also becomes the auto-update feed if you point
  `updateFeedUrl` at `https://github.com/<org>/<repo>/releases/latest/download/`).

Add these repository secrets before tagging a real release:

| Secret | Purpose |
|--------|---------|
| `CSC_LINK` | Base64 (or URL) of the code-signing certificate (`.pfx` for Windows, `.p12` for macOS Developer ID). |
| `CSC_KEY_PASSWORD` | Password for the certificate above. |
| `APPLE_ID` | Apple ID used to notarize the macOS DMG. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID. |
| `APPLE_TEAM_ID` | Apple Developer Team ID. |

Without these the workflow still builds, but the artifacts will be unsigned
(useful for smoke-testing the packaging itself).

## Auto-update feed

The packaged installer is wired up to electron-builder's **GitHub** provider
(`build.publish.provider = "github"` in `package.json`). On every
`desktop-pos-v*` tag the CI workflow creates / updates a GitHub Release and
uploads the installers together with `latest.yml` / `latest-mac.yml`, which
is exactly what electron-updater needs as a feed.

Two ways to consume the feed at runtime:

1. **Use the GitHub Release directly** — leave `updateFeedUrl` blank to let
   electron-updater fetch from the GitHub Releases of the configured repo
   (default behavior of the `github` provider).
2. **Mirror behind your own URL** — set `updateFeedUrl` from the **Settings**
   screen (or a managed config push) to any HTTPS location where you re-host
   `latest.yml`, `latest-mac.yml` and the installer artifacts (for example
   `https://github.com/<org>/<repo>/releases/latest/download/`, or a CDN
   that mirrors the release assets).

When `updateFeedUrl` is null and no GitHub release is reachable the app
still launches normally — the top bar simply shows "Auto-update not
configured".

## First-run setup (cashier)

1. Launch **Khanalagao POS**.
2. **Settings → Server URL** — point at the tenant's API/web POS host.
3. Enter the **outlet ID** and **counter ID** for this terminal.
4. **Printers** — pick the OS printer for each role and hit **Test**.
5. (Optional) toggle **Launch at login**, **Auto-print KOT/bill**,
   **Auto-open drawer on cash**.
6. Go back to **POS** — the embedded web POS loads with the outlet/counter
   pre-selected. Day-to-day operation continues exactly as on the web.

## Security notes

- The Electron BrowserWindow uses `contextIsolation: true`,
  `nodeIntegration: false`, and a custom CSP restricted to the configured API
  origin.
- The only API exposed to the renderer is `window.khanalagao.*` from
  `desktop/preload/index.ts`. No arbitrary IPC, no `require`, no `process`.
- External `http(s)` links open in the user's default browser via
  `shell.openExternal`; the BrowserWindow itself never navigates away from
  the local renderer bundle.
- The embedded `<webview>` uses its own persisted partition
  (`persist:khanalagao-pos`), so the web POS keeps its own cookies/storage
  isolated from the shell.
- Payments are settled by the existing backend `/payments` flow — the desktop
  shell has no path to mark a bill paid client-side.
