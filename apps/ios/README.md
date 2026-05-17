# @workspace/ios

Capacitor iOS **scaffold** for the Khana Lagao Restaurant Platform.

> ⚠️ **This package cannot produce a signed `.ipa` from Replit.** Building,
> archiving, and uploading an iOS app to TestFlight or the App Store
> requires **macOS + Xcode + an Apple Developer account**. This package
> exists so that a developer with that setup can generate the native iOS
> project and ship it without re-doing the configuration.

## What's here

- `capacitor.config.json` — bundle id, display name, WebView server URL.
- `www/index.html` — fallback page (Capacitor `server.url` normally points
  the WebView directly at the production web app).
- `resources/` — drop `icon.png` and `splash.png` here, then run
  `pnpm --filter @workspace/ios assets`.
- `info-plist-notes.md` — required `Info.plist` keys, especially permission
  usage descriptions.

## Open the native project (on macOS)

The native Xcode project at `apps/ios/ios/` is **already committed** with
bundle id `com.khanalagao.app`, display name "Khana Lagao", and the
WebView pointed at the production web app. On macOS:

```bash
pnpm --filter @workspace/ios install
pnpm --filter @workspace/ios assets    # regenerates icons + splash from resources/ (optional)
pnpm --filter @workspace/ios sync      # copies www/ + plugins into the Xcode project
cd ios/App && pod install              # CocoaPods only available on macOS
pnpm --filter @workspace/ios open      # opens Xcode
```

In Xcode:

1. Select the **App** target → Signing & Capabilities → set your team.
2. Confirm bundle id is `com.khanalagao.app` (or whatever you registered in
   App Store Connect).
3. Product → Archive → distribute via App Store Connect / TestFlight.

See `docs/app-builds.md` for the full signing, capability, and submission
checklist.
