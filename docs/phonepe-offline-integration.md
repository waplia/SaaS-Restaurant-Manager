# PhonePe Offline Payments — Integration Guide

KhanaLagao supports PhonePe **Offline** (in-store) payments end-to-end:

- **EDC** (PhonePe card machine) — CARD / DQR / CARD+DQR
- **Dynamic QR** — generated per transaction, shown on the POS screen
- **Collect Call** — push request to a customer's phone / VPA
- **Paylink** — shareable link sent via WhatsApp / SMS / email
- **Static QR** — printed counter QR, payments arrive via S2S
- **Refunds** — full or partial, with audit trail
- **Reconciliation** — match settlement files / API recon against in-app payments

> **Security rule we never break:** Frontend signals **never** mark anything paid.
> Every "success" comes from a server-side **Status Check API** verification.
> Salt keys are encrypted at rest, masked in the UI, and never sent to browsers.

---

## 1. Super Admin setup

1. Sign in as **Super Admin** and open **Provider Center → Payments → PhonePe Offline**.
2. Enter:
   - **Merchant ID** (`merchantId` PhonePe issued you)
   - **Salt Key** (encrypted with AES-256-GCM on save; masked thereafter)
   - **Salt Index** (usually `1`)
   - **Environment**: `UAT` for testing, `Production` once approved
   - Optional **Callback Username / Password** for X-CALLBACK basic auth
   - **Default timeout** (seconds the EDC waits for the customer)
   - Toggle which **solutions** are available to restaurants (EDC, Dynamic QR, Collect, Paylink, Static QR)
3. Click **Save**, then **Test connection**. A successful test reports `TRANSACTION_NOT_FOUND` from PhonePe — that proves the salt + merchant + URL are valid.
4. The callback URL to register with PhonePe Business is:
   ```
   https://<your-domain>/api/payments/phonepe/callback
   ```
   PhonePe must POST `{ "response": "<base64>" }` with header `X-VERIFY: SHA256(<base64>+<saltKey>)###<saltIndex>`.

All changes are written to `audit_logs` with the secrets redacted.

### Environment variables

```
# Optional: encryption key for the salt + callback password (≥ 16 chars, prod-required)
AI_PROVIDER_KEY_ENCRYPTION_KEY=
# Optional UAT/Prod overrides if PhonePe gave you a tenant-specific endpoint:
# PHONEPE_UAT_BASE_URL=https://mercury-uat.phonepe.com
# PHONEPE_PROD_BASE_URL=https://mercury-t2.phonepe.com
```

> **No** PhonePe credentials live in `.env` — they live in the Super Admin Provider Center.

---

## 2. Restaurant terminal mapping

Restaurant Owner / Manager (or Super Admin) opens **Settings → Card Terminals → PhonePe Terminals** and adds one row per physical EDC:

| Field | Required | Notes |
|------|----------|-------|
| Label | yes | Human-friendly name, e.g. "Counter 1 EDC" |
| Store ID | yes | PhonePe `storeId` from PhonePe Business |
| Terminal ID | yes for `ONE_TO_ONE`, blank for `OPEN` | Per-terminal ID |
| Binding | yes | `ONE_TO_ONE` (terminal pre-paired) or `OPEN` (cashier types short code) |
| Supported modes | yes | `CARD`, `DQR`, or both |
| Branch | optional | For multi-outlet restaurants |
| Default for counter | optional | POS picks it without prompting |
| Active | yes | Inactive terminals refuse new sales |

Validation rules enforced by the API match PhonePe's spec:

- `storeId` ≤ 64 chars, mandatory
- `terminalId` required when `binding = ONE_TO_ONE`
- `merchantTransactionId` ≤ 38 chars, `[A-Za-z0-9_-]`
- `shortOrderId` 4–8 numeric digits (OPEN mode)
- `amount` is sent in **paise** (integer), validated > 0

---

## 3. POS flows

### 3.1 EDC (card machine)
1. Cashier picks **PhonePe EDC**, selects a terminal, picks modes (CARD / DQR / CARD+DQR).
2. KhanaLagao POSTs `/restaurants/:id/phonepe/edc/sale` — we build the payload, base64 it, sign with X-VERIFY, and send to `/v3/credit/init`.
3. POS shows a waiting screen with: transaction ID, terminal, countdown, **Check Status**, **Cancel**, **Retry**.
4. **ONE_TO_ONE**: customer pays on the bound terminal.
5. **OPEN**: POS shows a 6-digit short code; cashier enters it on the EDC.
6. On verified `PAYMENT_SUCCESS`, KhanaLagao writes the payment ledger row, marks the order paid, and prints the receipt.

### 3.2 Dynamic QR
`POST /restaurants/:id/phonepe/dqr/init` returns `qrData` — POS renders the QR with a countdown. POS polls status every 3s.

### 3.3 Collect Call
`POST /restaurants/:id/phonepe/collect/request` with `customerPhone` or `customerVpa`. POS shows "Waiting for customer to approve…"; status polled until `PAYMENT_SUCCESS` / `PAYMENT_CANCELLED` / timeout.

### 3.4 Paylink
`POST /restaurants/:id/phonepe/paylink/create` returns `paylinkUrl`. POS surfaces copy + WhatsApp / SMS / email send buttons (using the existing notification channels).

### 3.5 Static QR (S2S)
The PhonePe-side static QR causes PhonePe to POST our `/api/payments/phonepe/callback`. Without an in-app order match, we record the txn in the **Unmatched PhonePe Payments** queue. Manager opens it, picks the order, and maps it.

---

## 4. Status, Cancel, Refund

| Action | Endpoint | Method | Notes |
|--------|----------|--------|-------|
| Re-query status | `/restaurants/:id/phonepe/status/:txnRowId` | GET | Re-signs + re-queries `/v3/transaction/{mid}/{txnId}/status` |
| Cancel | `/restaurants/:id/phonepe/cancel/:txnRowId` | POST | Best-effort PhonePe cancel + local `cancelled` |
| Refund | `/restaurants/:id/phonepe/refund/:txnRowId` | POST | Full or partial. Permission-gated. |
| Refund list | `/restaurants/:id/phonepe/refunds` | GET | For the refund report |

If the merchant does **not** have the refund API enabled, the refund endpoint responds with code `REFUND_NOT_ENABLED` and a clear message telling the operator to refund manually in PhonePe Business and mark the transaction refunded in KhanaLagao.

---

## 5. S2S callback handling

`POST /api/payments/phonepe/callback` is **public** but secure:

1. Read raw `{ "response": "<base64>" }` and `X-VERIFY` header.
2. Recompute `SHA256(<base64> + saltKey) + "###<saltIndex>"` and timing-safe compare.
3. Persist the raw headers + body to `phonepe_callbacks` regardless.
4. If signature valid + merchantTransactionId known, re-query `/v3/transaction/.../status` for the authoritative state, then update the txn / order / ledger.
5. Always reply `200 OK` so PhonePe stops retrying — replays are safe because the status check is idempotent.

---

## 6. Reconciliation

**Finance → Payments → PhonePe Reconciliation** lets a manager:

- Upload a CSV / paste rows pulled from PhonePe Business (or PhonePe's Comprehensive Transaction Recon API).
- POST to `/restaurants/:id/phonepe/reconciliation/upload`. The matching engine looks up by `merchantTransactionId` then `phonepeTransactionId` and assigns each row a status:

| Status | Meaning |
|--------|---------|
| `matched` | Found, amount agrees, KL marked success |
| `amount_mismatch` | Found, amount differs |
| `pending` | Found, KL still pending |
| `failed` | Found, KL marked failed |
| `refund_mismatch` | Found, refund state differs |
| `missing_in_khanalagao` | PhonePe has it, we don't |
| `settled` | Settlement amount captured |

Each run has its own `runId` so historical recon can be filtered and exported.

---

## 7. Reports

The closing summary endpoint (`/phonepe/closing-summary`) returns per-solution rows that the cashier-closing Z-report and daily sales / payment / settlement / refund / terminal-wise / store-wise reports include alongside Cash, Manual UPI, Manual Card, etc.:

- PhonePe EDC CARD
- PhonePe EDC DQR
- PhonePe Dynamic QR
- PhonePe Collect
- PhonePe Paylink

---

## 8. Error code mapping

User-facing strings come from `PHONEPE_ERROR_MAP` in `phonepeConfig.ts`. Highlights:

| Code | Message |
|------|---------|
| `SOLUTION_NOT_ENABLED` | This payment solution is not enabled on your MID. |
| `UNAUTHORIZED` | Salt key or merchant ID is wrong. |
| `INVALID_TRANSACTION_ID` | transactionId must be ≤ 38 chars, alphanumeric / _ / -. |
| `DUPLICATE_TRANSACTION_ID` | Each transaction must be unique. |
| `INTEGRATEDMODE_NOT_ENABLED_ON_TERMINAL` | Ask PhonePe to enable Integrated Mode on this terminal. |
| `SHORT_CODE_NOT_GENERATED` / `SHORT_CODE_EXPIRED` / `SHORT_CODE_ALREADY_USED` | OPEN-mode short code issue. |
| `TRANSACTION_NOT_FOUND` | Hasn't reached PhonePe yet — usually mid-flight. |
| `PAYMENT_PENDING` | Customer hasn't approved yet. |
| `PAYMENT_DECLINED` / `PAYMENT_ERROR` | Bank or PhonePe declined. |
| `PAYMENT_CANCELLED` | Customer cancelled on the EDC. |
| `REFUND_NOT_ENABLED` | Refund API not on your MID — refund manually. |

Network failures, timeouts, "still pending after N polls", amount mismatch on callback, inactive terminals, missing PhonePe config and plan-locked tenants are all surfaced with descriptive messages instead of letting the UI spin forever.

---

## 9. Permissions

| Permission | Cashier | Manager | Owner | Super Admin |
|------------|:-------:|:-------:|:-----:|:-----------:|
| View PhonePe transactions | ✓ | ✓ | ✓ | ✓ |
| Take EDC / DQR payment | ✓ | ✓ | ✓ | ✓ |
| Generate Paylink | ✓ | ✓ | ✓ | ✓ |
| Send Collect Call | ✓ | ✓ | ✓ | ✓ |
| Cancel PhonePe request | ✓ | ✓ | ✓ | ✓ |
| Refund PhonePe payment | | ✓ | ✓ | ✓ |
| Manage PhonePe terminals | | ✓ | ✓ | ✓ |
| Reconcile PhonePe settlements | | ✓ | ✓ | ✓ |
| Configure PhonePe provider | | | | ✓ |

Enforced by `requireRole(...)` and `requireSuperAdmin` middleware on the routes.

---

## 10. UAT checklist

- [ ] Save UAT credentials in Super Admin → Provider Center → PhonePe Offline.
- [ ] Click **Test connection** → expect `TRANSACTION_NOT_FOUND`.
- [ ] Add a UAT terminal (`storeId`, `terminalId`, `ONE_TO_ONE`, modes = CARD+DQR).
- [ ] EDC sale: tap the test card → `PAYMENT_SUCCESS`, order marked paid, receipt prints.
- [ ] EDC OPEN mode: short code shown, enter on UAT EDC simulator → success.
- [ ] Re-fire callback for the same `merchantTransactionId` → no duplicate ledger row.
- [ ] Cancel an `initiated` txn → status flips to `cancelled`, no payment row.
- [ ] Full refund + partial refund → status `refunded` / `partially_refunded`, ledger row inserted.
- [ ] Reconciliation upload with one matching + one amount-mismatch row → correct statuses.
- [ ] Cashier closing summary shows PhonePe EDC CARD / DQR rows.
- [ ] Switch `env` to `prod` and re-run **Test connection** with prod salt → expect `TRANSACTION_NOT_FOUND`.

## 11. Production checklist

- [ ] Real merchant ID + production salt key entered in Super Admin.
- [ ] Callback URL registered with PhonePe Business and reachable over HTTPS.
- [ ] Optional `X-CALLBACK-USERNAME` + `X-CALLBACK-PASSWORD` configured if PhonePe enabled basic auth on your tenant.
- [ ] `AI_PROVIDER_KEY_ENCRYPTION_KEY` set (≥ 16 chars) in the production environment.
- [ ] Plan feature `phonepe_offline_enabled` toggled on for the customer's plan.
- [ ] At least one terminal mapped per outlet.
- [ ] Closing report verified against a small first-day sample.
- [ ] Reconciliation run scheduled (daily) once PhonePe MIS becomes available.
- [ ] On-call alert wired to any `phonepe_callbacks.processing_error != null` rows.
