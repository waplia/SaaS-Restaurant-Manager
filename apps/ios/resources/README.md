# iOS app icon & splash sources

Drop the following two files here before running `pnpm --filter @workspace/ios assets`:

- `icon.png` — 1024x1024, no rounded corners, no transparency
- `splash.png` — 2732x2732, brand mark centred on background

`@capacitor/assets` will generate every required iOS size and density and
copy them into the native Xcode project.

The existing platform logo is a fine starting point:

    cp ../../artifacts/restaurant-platform/public/logo.png apps/ios/resources/icon.png
    cp ../../artifacts/restaurant-platform/public/logo.png apps/ios/resources/splash.png
