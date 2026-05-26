# Sound assets

Drop the following WAV/MP3 files in this folder before packaging. The web POS
shell (artifacts/restaurant-platform) already plays these by name when running
inside the desktop shell:

- `order-saved.wav` — short positive chime when an order is sent to KOT
- `payment-success.wav` — register-style ding on settle
- `error.wav` — soft buzz on validation or printer failure
- `scan.wav` — barcode/QR scan acknowledgement

Files in this folder are bundled into the installer via electron-builder's
`extraResources` mapping and exposed at `process.resourcesPath/sounds/*` at
runtime.
