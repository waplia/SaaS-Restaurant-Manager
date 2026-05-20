# Android builds for KhanaLagao Restaurant (Expo EAS)

This doc covers building and submitting the **KhanaLagao Restaurant** mobile
app (artifact: `@workspace/tabletrack-mobile`) for Android using
[Expo Application Services (EAS)](https://docs.expo.dev/eas/).

There are three build flavors, all driven from `artifacts/tabletrack-mobile/eas.json`:

| Profile       | Output  | Use case                                                              |
| ------------- | ------- | --------------------------------------------------------------------- |
| `development` | `.apk`  | Custom dev client with Metro / Hermes debug. Side-load on test devices. |
| `preview`     | `.apk`  | Release-mode side-loadable build for QA / internal testers.            |
| `production`  | `.aab`  | Signed Android App Bundle for Google Play (Internal / Closed / Open testing → Production). |

## Prerequisites

Run these on your own machine — Replit does not ship the Android SDK and the
EAS CLI needs interactive login the first time.

1. **Node 20+** and **pnpm** (already required by the monorepo).
2. **EAS CLI**:
   ```bash
   npm i -g eas-cli
   eas login
   ```
3. **Expo account** that owns (or is a member of) the project. The first
   build will prompt you to create or link an Expo project — accept the
   default and EAS will write the resulting `projectId` back to `app.json`
   under `extra.eas.projectId` (or you can paste it manually).
4. (Production / submit only) A **Google Play Console** account with the
   app registered under the package id **`com.khanalagao.restaurant`**, and
   a **service account JSON key** with "Release manager" access. Save it as
   `artifacts/tabletrack-mobile/google-play-service-account.json` (path is
   referenced by `eas.json` → `submit.production.android.serviceAccountKeyPath`).
   Do **not** commit that file.

## Environment variables

The mobile bundle reads its API host from `EXPO_PUBLIC_API_BASE_URL`. Set it
per profile by exporting it in your shell before running the build, or by
adding an `env` block to the matching profile in `eas.json`. Example:

```bash
# Staging APK
EXPO_PUBLIC_API_BASE_URL=https://staging.khanalagao.com \
  pnpm --filter @workspace/tabletrack-mobile run android:preview

# Production AAB
EXPO_PUBLIC_API_BASE_URL=https://app.khanalagao.com \
  pnpm --filter @workspace/tabletrack-mobile run android:production
```

If `EXPO_PUBLIC_API_BASE_URL` is unset, the bundle falls back to
`EXPO_PUBLIC_DOMAIN` / `REPLIT_DEV_DOMAIN` — that is what keeps the
existing Expo Go dev flow on Replit working (`pnpm --filter
@workspace/tabletrack-mobile run dev`). The resolution lives in
[`artifacts/tabletrack-mobile/lib/apiBaseUrl.ts`](../artifacts/tabletrack-mobile/lib/apiBaseUrl.ts).

## Commands

All commands run from the repo root:

```bash
# Internal dev-client APK (developer machines only)
pnpm --filter @workspace/tabletrack-mobile run android:dev

# Side-loadable APK for QA / internal testers
pnpm --filter @workspace/tabletrack-mobile run android:preview

# Signed AAB for the Play Store
pnpm --filter @workspace/tabletrack-mobile run android:production

# Upload the latest production AAB to the Play Console "internal" track
pnpm --filter @workspace/tabletrack-mobile run android:submit
```

EAS runs the build in the cloud, streams logs to your terminal, and prints
a **build URL** when it finishes. Open that URL to download the resulting
`.apk` / `.aab` (also accessible from <https://expo.dev/accounts/&lt;you&gt;/projects/tabletrack-mobile/builds>).

## App identity

Configured in `artifacts/tabletrack-mobile/app.json` — keep these in sync
with the Play Console listing:

| Field                  | Value                          |
| ---------------------- | ------------------------------ |
| Display name           | `KhanaLagao Restaurant`        |
| Android package id     | `com.khanalagao.restaurant`    |
| Version (user-visible) | `1.0.0`                        |
| Android `versionCode`  | `1`                            |
| Permissions            | `INTERNET`, `CAMERA`, `POST_NOTIFICATIONS`, `VIBRATE` |

Bump `expo.version` (semver) and `expo.android.versionCode` (monotonic
integer) before each Play Store release. The `production` profile in
`eas.json` has `autoIncrement: true` so `versionCode` is bumped for you
when building via EAS — only edit it manually if you need to skip ahead.

## Signing

EAS manages the upload keystore for you the first time you run
`android:production` — accept the prompt and it stores the keystore
server-side. Recover it later with `eas credentials -p android`. Use
**Play App Signing** in the Play Console so Google holds the final
signing key.

## Troubleshooting

- **"Project not configured"** on the first run — let EAS create / link
  the Expo project, then commit the updated `app.json`.
- **APK installs but white-screens** — usually a missing
  `EXPO_PUBLIC_API_BASE_URL`. Rebuild with the correct value or set it in
  the `eas.json` profile's `env` block.
- **Push notifications don't arrive on Android 13+** — the app already
  requests `POST_NOTIFICATIONS` at runtime from
  `context/AuthContext.tsx`; make sure the user accepted the prompt
  (Settings → Apps → KhanaLagao Restaurant → Notifications).
- **Camera permission denied** — handled in
  `app/(customer)/index.tsx` via `useCameraPermissions()`; the screen
  shows a manual-entry fallback when permission is denied.
