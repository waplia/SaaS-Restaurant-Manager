# Build resources

Drop the platform icons here before running `pnpm run package:win` / `package:mac`:

- `build/icon.ico` — 256×256 (or multi-res) Windows icon
- `build/icon.icns` — macOS icon
- `build/icon.png` — 512×512 fallback used when the platform icon is missing

electron-builder picks them up automatically. The `entitlements.mac.plist` in
this folder is what gets stapled when you sign / notarize on macOS — see
`docs/desktop-pos-build.md` for the signing hooks.
