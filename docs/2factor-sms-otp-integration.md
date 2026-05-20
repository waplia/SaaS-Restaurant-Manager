# 2Factor.in SMS & OTP Integration

This document covers the integration of [2Factor.in](https://2factor.in)
as a first-class SMS/OTP provider in TableTrack. 2Factor sits alongside
Twilio, MSG91, Textlocal, Fast2SMS and Gupshup in the Super Admin Provider
Center and is selectable by both the unified OTP service (Task #531) and
Growth Engine SMS campaigns.

References:
- API docs — <https://documenter.getpostman.com/view/301893/TWDamFGh>
- Overview — <https://2factor.in/v3/sms-api>

---

## 1. Super Admin setup

1. Sign in at <https://2factor.in> and copy the **API Key** from the dashboard.
2. Get your **DLT‑approved sender ID** (e.g. `TFCTR`) and **template
   names / IDs** for OTP, transactional and promotional sends.
3. In TableTrack → **Super Admin → Provider Center → SMS / OTP**, click
   **Add provider** and choose **2Factor.in (India / DLT)**.
4. Paste the JSON config (the dialog shows a placeholder):

   ```json
   {
     "apiKey": "<the key>",
     "senderId": "TFCTR",
     "otpTemplateName": "OTP1",
     "transactionalTemplateId": "DLT_TXN_ID",
     "promotionalTemplateId":   "DLT_PROMO_ID",
     "defaultCountryCode": "+91",
     "otpLength": 6,
     "otpExpiryMinutes": 5,
     "resendCooldownSeconds": 30,
     "maxAttempts": 5,
     "maxResends": 3,
     "dailyLimit": 0,
     "monthlyLimit": 0,
     "smsOtpEnabled": true,
     "voiceOtpEnabled": false,
     "transactionalEnabled": true,
     "promotionalEnabled": true,
     "mode": "live"
   }
   ```

5. Save. The API key is encrypted at rest and **masked** in every GET
   response — restaurant admins never see it. Every save is written to
   `audit_logs` (`actor`, `action=sms.provider.created|updated`, before
   /after diff with secrets redacted).
6. Use **Test OTP** / **Test SMS** to round‑trip the real API. The
   modal shows the actual provider response.

`mode = "sandbox"` short-circuits all HTTP calls and returns deterministic
stubs — useful for local dev. OTP `000000` or `123456` is accepted by the
sandbox verifier.

---

## 2. OTP flow via 2Factor

The unified `OtpProvider` (Task #531) chooses a channel per purpose
(login / register / 2FA / password reset / staff invite / new device /
verify mobile / verify email). When the channel is `sms` and the active
SMS provider is `2factor`, the request goes through
`artifacts/api-server/src/lib/twoFactorAdapter.ts`.

Two OTP modes are supported:

| Mode | Used by | Endpoint |
| --- | --- | --- |
| **Provider-generated** (`sendOtp`) | `OtpProvider` (#531) when it lets 2Factor mint the code | `/SMS/{phone}/AUTOGEN2/{template}` — returns `sessionId` |
| **Custom-OTP** (`sendCustomOtp`) | Existing `staffOtp.ts` — caller already hashed a code | `/SMS/{phone}/{otp}/{template}` |

Verification is always session-based:
`/SMS/VERIFY/{sessionId}/{otp}`.

Voice OTP and resend are exposed as `sendVoiceOtp` / `resendOtp`. The
adapter never throws — every public function returns
`{ ok, data | errorCode, raw }` so the caller can decide on fallback.

### Fallback rules

`OtpProvider` falls back **exactly once** to the next configured channel
(email OTP → WhatsApp OTP) when 2Factor returns one of these hard codes:

- `INVALID_API_KEY`, `API_KEY_MISSING`, `LOW_BALANCE`,
  `INVALID_TEMPLATE`, `PROVIDER_TIMEOUT`, `LIMIT_REACHED`.

Soft errors that don't trigger fallback: `INVALID_OTP`, `INVALID_SESSION`,
`INVALID_MOBILE` — those are user-facing problems, not provider failures.

If every channel fails the user sees a single friendly error. There is no
retry loop.

---

## 3. SMS flow via 2Factor (Growth Engine & transactional)

Both Growth Engine campaigns and direct `sendSmsMessage(...)` calls reach
`callProvider()` in `artifacts/api-server/src/lib/smsSender.ts`, which has
a `provider.type === "2factor"` branch. The branch picks the right adapter
method based on `input.messageType` (`otp` / `transactional` /
`promotional` / `voice_otp`) and the template category. Existing audience
segmentation, opt-in / suppression, quiet hours, character count, SMS-parts
estimate, "Send test SMS", scheduling, queueing and per-recipient logs are
re-used unchanged.

Daily / monthly limits configured on the provider row are enforced in the
adapter and surface as `LIMIT_REACHED` ("SMS limit reached") — no fake
success.

---

## 4. Schema

Migration: `lib/db/drizzle/0030_twofactor_sms.sql`.

Added to `sms_logs`:

| Column | Purpose |
| --- | --- |
| `provider_session_id` | 2Factor session id for verify-by-session OTP flows |
| `purpose` | Why the message was sent (login, register, marketing, …) |
| `message_type` | Provider routing category (otp / transactional / promotional / voice_otp / test) |
| `cost_estimate` | Provider-reported cost (numeric, kept separate from legacy `cost`) |
| `error_code` | Normalized provider error (e.g. `LOW_BALANCE`) |
| `provider_response` | Raw provider JSON for audit / debugging |

Indexes were added on `provider_type`, `purpose`, `message_type` to keep
the Reports breakdown fast.

`sms_providers.provider` accepts the new value `"2factor"`. The
`otp_verifications` table (created by #531) carries the same
`provider_session_id` so verify-by-session OTPs round-trip cleanly.

---

## 5. Error mapping (spec §17)

| Normalized code | Friendly message |
| --- | --- |
| `API_KEY_MISSING` | "2Factor API key is missing — please configure it in Super Admin → Provider Center → SMS / OTP." |
| `INVALID_API_KEY` | "2Factor rejected the API key. Please verify the key in Super Admin and try again." |
| `LOW_BALANCE` | "2Factor account balance is too low to send. Please top up at 2factor.in." |
| `INVALID_MOBILE` | "That mobile number is not valid for 2Factor. Check the country code and try again." |
| `INVALID_TEMPLATE` | "The 2Factor template name / ID is missing or not approved. Update it in Super Admin." |
| `PROVIDER_TIMEOUT` | "2Factor took too long to respond. Please try again in a moment." |
| `LIMIT_REACHED` | "Daily or monthly SMS limit for 2Factor has been reached." |
| `INVALID_SESSION` | "The OTP session has expired. Please request a new code." |
| `INVALID_OTP` | "Incorrect OTP. Please try again." |
| `UNKNOWN_ERROR` | "2Factor reported an error. Please try again." |

Mapping lives in `twoFactorAdapter.ts → normalizeError()` and
`friendlyMessage()`.

---

## 6. Reports

**Super Admin → Reports → SMS / OTP Usage** (`GET /admin/sms/usage`) now
returns a `byProvider` array — one row per `provider_type` for the current
calendar month with `sent`, `failed`, `blocked`, and summed
`costEstimate`. Pair with the per-tenant rows already returned to spot
top-sending restaurants per provider.

**Per-restaurant SMS Logs** (`GET /admin/sms/logs`) accepts
`?provider=2factor`, `?purpose=login`, `?messageType=otp` filters in
addition to the existing `status`, `tenantId`, `restaurantId`, `eventKey`
ones, so 2Factor traffic / failures / rate-limit blocks can be isolated.

---

## 7. Restaurant-side surface

Restaurants never see the provider config or secrets. The existing
Provider Center status table renders one row per provider with:

- **Active** — provider exists, enabled, no recent hard failures
- **Not configured** — no row of this type exists
- **Locked by plan** — plan flag disables SMS for this tenant
- **Limit reached** — `LIMIT_REACHED` in the last 10 minutes

For 2Factor specifically, the status row uses the same renderer — no new
secrets ever cross the wire.

---

## 8. Testing & production checklist (spec §§20–21)

Before sign-off, walk through:

- [ ] **Local sandbox**: set `"mode": "sandbox"` on the provider row.
      Login OTP, verify with `123456`, run a Growth Engine test send. All
      paths return `ok: true` without touching 2Factor.
- [ ] **Live key smoke**: switch `"mode": "live"`, hit **Test OTP** with
      your own number, verify it lands and the code works.
- [ ] **Hard failure / fallback**: temporarily set an invalid API key.
      Trigger login OTP. Confirm one fallback attempt to email/WhatsApp
      OTP, single friendly error if both fail, and no retry loop.
- [ ] **Limit reached**: set `dailyLimit: 1`, send twice. Second send
      must surface "SMS limit reached" and not call the API.
- [ ] **Audit**: edit the provider, confirm `audit_logs` row with the
      diff and secrets redacted.
- [ ] **Reports**: send a handful of OTP + campaign messages, confirm
      `Super Admin → Reports → SMS / OTP Usage` shows 2Factor under
      `byProvider` with the correct counts and cost estimate.
- [ ] **Logs filter**: filter the per-restaurant logs by `provider=2factor`
      and `messageType=otp`; rows render with `provider_session_id`,
      `purpose`, `error_code`.
- [ ] **Mobile app**: walk login + signup + new-device OTP on the Expo
      app with 2Factor selected. Codes land, verification clears.
- [ ] **Opt-out**: a number on the suppression list must be skipped by
      Growth Engine — same behaviour as other providers.

---

## 9. Files

- `lib/db/src/schema/sms.ts` — provider enum + new log columns
- `lib/db/drizzle/0030_twofactor_sms.sql` — migration
- `artifacts/api-server/src/lib/twoFactorAdapter.ts` — adapter (this task)
- `artifacts/api-server/src/lib/smsSender.ts` — 2factor branch in
  `callProvider`, new log fields, `ProviderSendError`
- `artifacts/api-server/src/routes/admin-sms.ts` — accept `2factor`,
  add `provider` / `purpose` / `messageType` filters, return
  `byProvider` breakdown
- `artifacts/restaurant-platform/src/pages/admin-sms.tsx` — 2Factor in
  provider type list + placeholder JSON
- `.env.example` — `TWOFACTOR_*` placeholders
