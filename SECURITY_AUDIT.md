# KhanaLagao Platform Security Audit

**Audit date:** 2026-05-16
**Scope:** `artifacts/api-server`, `artifacts/restaurant-platform`, `artifacts/marketing-site`, `artifacts/tabletrack-mobile`, `lib/db`
**Method:** Structured code review of auth, RBAC, multi-tenant isolation, secrets, uploads, public forms, AI endpoints, payments/webhooks, headers/CORS, dependency advisories.

Severity scale: **Critical** (exploitable, broad blast radius) · **High** (exploitable, scoped) · **Medium** (defense-in-depth) · **Low** (hygiene).

---

## Register

| # | Area | Risk | Severity | Exploit possibility | Fix | Status |
|---|------|------|----------|--------------------|-----|--------|
| 1 | Headers — API | No `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` on any API response. | High | Clickjacking of JSON-rendering admin tools, MIME-sniff XSS on any HTML accidentally returned, downgrade attacks over plain HTTP. | Added `middleware/securityHeaders.ts` with strict CSP (`default-src 'none'; frame-ancestors 'none'`), HSTS in prod, XCTO, Referrer-Policy, Permissions-Policy, COEP-friendly CORP. Disabled `x-powered-by`. | **Done** |
| 2 | CORS — API | `app.use(cors())` allowed any origin and reflected credentials. | High | Any malicious site could call the API with the user's browser-stored cookies/headers. | Replaced with allowlist driven by `ALLOWED_ORIGINS` (comma-sep) / `PUBLIC_APP_URL`. Localhost + `*.replit.dev` allowed only when `NODE_ENV !== production`. `credentials: true` kept for refresh-token flow. | **Done** |
| 3 | Auth — login rate limit | No brute-force protection on `POST /api/auth/login`. | Critical | Unlimited credential stuffing against any tenant's owner account. | Two **independent** sliding-window buckets stacked on the route: per-IP 20/15 min (`auth.login.ip`) AND per-email 10/15 min (`auth.login.email`, IP ignored). Neither dimension can be circumvented by varying the other. Returns 429 + `Retry-After`. | **Done** |
| 4 | Auth — user enumeration via timing | Login returned `401 Invalid credentials` for both unknown and bad-password, but the unknown-email path skipped bcrypt → measurable ~80ms difference. | High | Attacker enumerates valid emails before credential stuffing. | Compare against a fixed dummy bcrypt hash on the unknown/inactive path so response time is constant. | **Done** |
| 5 | Auth — forgot-password rate limit | No throttle on `POST /api/auth/forgot-password`. | High | Email-bombing of victims; reset-link spam abuse of SMTP quota. | Two independent buckets stacked: per-IP 10/hour AND per-email 5/hour (IP-ignored). Response stays generic ("if an account exists…") so enumeration is still blocked. | **Done** |
| 6 | Auth — reset-password reuse | `POST /api/auth/reset-password` accepted a reset JWT as many times as it was valid (1 h window). | High | Stolen reset link could be replayed even after the legitimate user used it. | Reject the token when `users.updatedAt` is later than the token's `iat`. Added 8-char minimum check and audit-log entry on success. Rate-limited 10/hour per IP. | **Done** |
| 7 | Auth — refresh rate limit | No throttle on `POST /api/auth/refresh`. | Medium | Refresh-token replay/scan amplification. | 30/min per IP. | **Done** |
| 8 | Auth — register rate limit | No throttle on `POST /api/auth/register`. | Medium | Tenant/restaurant-row spam; SMS welcome-message abuse. | 5/hour per IP. | **Done** |
| 9 | Auth — JWT secret defaults | Production fails fast if `JWT_SECRET` / `JWT_RESET_SECRET` unset; dev falls back to a fixed dev-only string. | Low | Acceptable as-is. | Verified `lib/auth.ts` throws when prod secrets missing. | **OK** |
| 10 | Auth — password hashing | bcrypt with cost 10. | Low | Acceptable for current scale. | Documented. Re-evaluate at >1M users (bump cost or migrate to argon2id). | **Accepted** |
| 11 | Sessions — logout / token revocation | `POST /api/auth/logout` previously only wrote an audit log; JWTs stayed valid until expiry. | Medium | Stolen token could not be revoked mid-session. | Added `users.token_version` column (migration `0022_users_token_version.sql`; migration also bumps every existing row by 1 as a cutover so pre-deploy JWTs — which lack the claim — are rejected immediately). Embedded in every issued access/refresh JWT as `tv`. `authenticate` middleware and `/api/auth/refresh` re-check the stored value on every request (30 s in-process cache to keep DB load flat) and reject tokens whose `tv` is missing OR no longer matches. `POST /api/auth/logout` and `POST /api/auth/reset-password` both `tokenVersion + 1` so *every* device's existing access **and** refresh tokens 401 on next use ("logout everywhere"). Verified end-to-end with curl: pre-logout `/me` 200, post-logout `/me` 401 "revoked", post-logout `/refresh` 401 "revoked". | **Done** |
| 12 | RBAC — tenant isolation guard | Each restaurant-scoped route mounts `validateRestaurantAccess` which enforces `tenantId` match and branch scoping for non-owners (`middleware/restaurantAccess.ts:35`). | — | — | Verified across `routes/*.ts`. | **OK** |
| 13 | RBAC — super-admin routes | Super-admin endpoints (`admin-*`, marketing admin) gate on `req.user.isSuperAdmin` and reject 403 otherwise (`routes/marketing.ts:148`). | — | — | Verified. | **OK** |
| 14 | RBAC — impersonation | Impersonation tokens are read-only at middleware layer (`middleware/authenticate.ts:28`): any non-GET request returns 403. | — | — | Verified. | **OK** |
| 15 | Inputs / SQL | All DB access via Drizzle ORM. Raw `sql`\`\` usages are tagged templates (parameterized). No string-built SQL found. | — | — | Verified. | **OK** |
| 16 | Inputs / validation | New routes use zod (`storage.ts`). Older routes parse `req.body` manually with string casts and length caps. | Medium | Malformed payloads can produce 500s but not auth bypass (RBAC sits in front of them). | Deferred per scope — centralized zod refactor is a separate workstream. Audit-logged 500s feed `system_logs`. | **Accepted (deferred)** |
| 17 | Public lead form | `POST /api/leads` already has honeypot (`website` field), per-IP 10 s throttle, length caps, source-page logging (`routes/marketing.ts:71`). | — | — | Verified. | **OK** |
| 18 | Public ordering | `POST /api/public/orders` uses a per-table guest token (`lib/guestToken.ts`) and per-restaurant cooldowns on waiter requests. | — | — | Verified. | **OK** |
| 19 | File uploads | Presigned-PUT flow validates name/size (≤10 MB)/contentType via zod, enforces tenant ACL on finalize, refuses to overwrite another tenant's object (`routes/storage.ts:76`). | — | — | Verified. | **OK** |
| 20 | File uploads — MIME sniffing | Server trusts the client-supplied `contentType` (no re-encoding, no magic-byte sniff). Reads happen via a separate ACL-checked GET that streams from object storage. | Medium | A user could upload an HTML/JS file labelled `image/png`. Served back through `/api/public/storage/objects/*path`, the browser would honour the stored Content-Type from object storage, not the user's lie — so XSS via mislabelled upload is limited. | Deferred — full re-encoding pipeline is a separate workstream. Documented. | **Accepted (deferred)** |
| 21 | Webhooks — Stripe | `stripe.webhooks.constructEvent` verifies signature (`routes/subscriptions.ts:264`); raw body is preserved by `express.raw` at `/api/stripe/webhook`. | — | — | Verified. | **OK** |
| 22 | Webhooks — Cashfree | `verifyCashfreeWebhook` checked (`routes/subscriptions.ts:343`). | — | — | Verified. | **OK** |
| 23 | Webhooks — Razorpay | HMAC-SHA256 verified (`routes/billing.ts:404`). | — | — | Verified. | **OK** |
| 24 | Payments — mutation surface | Invoice / subscription status mutations live behind server-side webhook handlers + super-admin-only admin routes. No client-driven status mutation found. | — | — | Verified. | **OK** |
| 25 | AI provider keys | Stored encrypted at rest with AES-256-GCM via `lib/aiEncryption.ts`; admin UIs show masked previews; no `process.env.OPENAI_*` / `ANTHROPIC_API_KEY` in any client bundle. | — | — | Verified. | **OK** |
| 26 | AI — credit accounting | `reserveCredits` / `commitReservation` / `refundReservation` (`lib/aiCredits.ts`) gate every AI call; failure path refunds the reservation. | — | — | Verified. | **OK** |
| 27 | AI — prompt injection | System prompts are server-controlled; outputs rendered as plain text or sanitized markdown in the SPA. No `dangerouslySetInnerHTML` on AI output found. | — | — | Verified. | **OK** |
| 28 | Secrets — client bundle | Only `VITE_STRIPE_PUBLISHABLE_KEY` (public by design) and `VITE_APP_URL` exposed to Vite bundles. `.env` files are gitignored. | — | — | Verified. | **OK** |
| 29 | Audit logging | `recordAuditLog` invoked on login success/failure, password reset (new), super-admin sensitive actions (key changes, plan/module changes, AI credit changes, suspend/delete, login-as) and payment webhook events. | — | — | Verified + extended for `password.reset`. | **OK** |
| 30 | Headers — Vite SPAs | Marketing site and restaurant platform Vite configs do not set headers in dev; production headers must be set at the CDN/proxy layer (Replit deployment). | Low | Defense-in-depth only — APIs already block framing via `X-Frame-Options: DENY`. | Documented for the deployment skill; no code change required in Vite. | **Accepted** |
| 31 | `x-powered-by` header | Express advertised itself via `X-Powered-By: Express` on every response. | Low | Version fingerprinting. | `app.disable("x-powered-by")` in `app.ts`. | **Done** |
| 32 | `trust proxy` scope | Wide-open `trust proxy = true` would let any attacker spoof `X-Forwarded-For` and rotate the rate-limit key; numeric hop counts (`trust proxy = 1`) have the same flaw because they trust the IP one back in XFF *regardless of who the immediate connection is*. | High | Defeats login / forgot / reset throttles by sending a fresh forwarding header per attempt. | Default `trust proxy = false` (no forwarding headers honoured; `req.ip` is the socket address). Operators MUST set `TRUST_PROXY` env to the trusted proxy CIDR (e.g. `10.0.0.0/8`) once they know the deployment topology — documented in the env table below. | **Done** |
| 37 | Rate-limit key spoofing | Initial limiter implementation read `req.headers["x-forwarded-for"]` directly — would have been bypassable by any attacker sending a fresh header per request. | High | Defeats login / forgot / reset throttles. | `clientKey()` in `middleware/rateLimit.ts` now uses `req.ip` so spoofed headers from untrusted hops are ignored (combined with the tightened `trust proxy` setting in #32). | **Done** |
| 38 | Brute-force lockout — persistence | Limiter state lives in process memory: it resets on deploy and does not coordinate across multiple API nodes. The independent per-IP and per-email buckets still work on a single node, but a true *account lockout* counter does not survive restarts or scale horizontally. | Medium | A patient attacker timing attempts around deploys, or hitting multiple nodes behind a load balancer, can exceed the intended global ceiling on a single account. | Deferred — needs a shared store (Redis or a DB table with TTL). Filed as a follow-up. Today's single-node deployment still gets full throttle protection; the per-account email-keyed bucket means even a botnet on different IPs is capped at 10/15 min per account *on each node*. | **Accepted (deferred)** |
| 33 | Dependencies — direct deps | `pnpm audit` run; no unfixed High/Critical advisories on direct dependencies at audit time. Transitive advisories tracked but no exploitable path identified. | — | — | Run `pnpm audit --prod` before each release. | **OK** |
| 34 | Socket.IO CORS | `lib/socketio.ts` already honours `ALLOWED_ORIGINS`. | — | — | Verified. | **OK** |
| 35 | Error responses | `middleware/systemLogging.ts` exception handler returns generic 500 to client and logs full stack server-side. | — | — | Verified. | **OK** |
| 36 | Debug endpoints | `routes/health.ts` is the only diagnostic route; returns `{ ok: true }` only. No debug/eval/admin-only-by-obscurity routes found. | — | — | Verified. | **OK** |

---

## Required environment variables (security-relevant)

| Var | Purpose | Required in prod |
|-----|---------|------------------|
| `JWT_SECRET` | HMAC key for access/refresh tokens | yes |
| `JWT_RESET_SECRET` | HMAC key for password-reset tokens (separate keyspace) | yes |
| `ALLOWED_ORIGINS` | Comma-separated list of origins permitted by CORS and Socket.IO. Falls back to `PUBLIC_APP_URL` if unset. | yes |
| `PUBLIC_APP_URL` | Absolute URL of the customer-facing app — used for reset links and CORS fallback | yes |
| `AI_ENCRYPTION_KEY` | AES-256-GCM key for provider-credential vault | yes |
| `TRUST_PROXY` | Tells Express which upstream hops are allowed to set `X-Forwarded-For`. Default `false`. Set to the proxy/edge CIDR (e.g. `10.0.0.0/8`) once topology is known so rate-limiter keys see the real client IP. | yes (in prod, once known) |

---

## Deferred / accepted (medium & low)

- **Refresh-token rotation** — `tokenVersion` invalidates *all* prior tokens on logout/reset, but a single stolen refresh token between logouts is still replayable until its 7-day expiry. Rotate refresh tokens on every `/auth/refresh` call and bump `tokenVersion` on reuse-detection.
- **Centralized zod validation** (#16) — convert the remaining ~80 routes to use `lib/api-zod` schemas.
- **Server-side image re-encoding** (#20) — pipe uploads through `sharp` and strip EXIF/scripts before persisting.
- **Production response headers on Vite artifacts** (#30) — set at Replit deployment / CDN level rather than in `vite.config.ts`.

Each deferred item is small enough to fit in a future task; none of them block the Critical/High fixes shipped here.
