# Android app icon & splash sources

Drop the following two files here before running `pnpm --filter @workspace/android assets`:

- `icon.png` — 1024x1024, full-bleed brand mark
- `splash.png` — 2732x2732, brand mark centred on background

`@capacitor/assets` will generate every required Android density from these
two source files into the native project.

A reasonable starting point is the existing platform logo:

    cp ../../artifacts/restaurant-platform/public/logo.png apps/android/resources/icon.png
    cp ../../artifacts/restaurant-platform/public/logo.png apps/android/resources/splash.png
