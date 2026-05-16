# KhanaLagao — Production Readiness Audit Report

_Date: 2026-05-16_
_Scope: Task #259 — Final audit & production-readiness pass_

This document summarizes the smallest, safest changes applied to bring the platform to a shippable state without rebuilding existing features. It also lists remaining gaps and notes overlap with already-PROPOSED tasks so they are not duplicated.

---

## 1. Workflows / artifacts startup

All five artifacts start cleanly with the current workflow configuration:

| Artifact | Workflow | Status |
| --- | --- | --- |
| `artifacts/api-server` | `artifacts/api-server: API Server` | running (Server listening on 8080, schedulers booted) |
| `artifacts/marketing-site` | `artifacts/marketing-site: web` | running (Vite dev server) |
| `artifacts/restaurant-platform` | `artifacts/restaurant-platform: web` | running (Vite dev server) |
| `artifacts/tabletrack-mobile` | `artifacts/tabletrack-mobile: expo` | running (Metro bundler) |
| `artifacts/mockup-sandbox` | `artifacts/mockup-sandbox: Component Preview Server` | running (Vite dev server) |

No code-level fixes were needed for the workflows — they boot cleanly after a fresh restart. Two legacy entries (`API Server`, `Start application`) remain `NOT_STARTED` and are unused; they can be removed at any time without impact.

---

## 2. Rebrand: TableTrack → KhanaLagao

The product is already branded "Khana Lagao" in the central settings layer:

- `lib/db/src/schema/app-settings.ts` — `appName` column default updated to **`KhanaLagao`** (was `TableTrack`).
- `lib/db/drizzle/0021_khanalagao_brand_defaults.sql` — additive, reversible migration that flips the SQL `DEFAULT` clauses for `app_settings.app_name`, `app_settings.support_email`, and `blog_posts.author` so freshly-provisioned databases get the new brand. Existing rows are left untouched, so any tenant that has already customised these values keeps them.
- `artifacts/marketing-site/src/lib/appSettings.tsx` — runtime fallback already `"Khana Lagao"`.
- `artifacts/restaurant-platform/src/lib/appSettings.tsx` — runtime fallback already `"Khana Lagao"`.
- `artifacts/marketing-site/index.html` and `artifacts/restaurant-platform/index.html` — titles, OG/Twitter meta already on KhanaLagao.

Additional user-facing surfaces rebranded in this pass:

- `artifacts/marketing-site/src/lib/seo.ts` — default `ogImage` URL → `khanalagao.com`.
- `artifacts/marketing-site/src/pages/contact.tsx` — public email → `hello@khanalagao.com`.
- `artifacts/marketing-site/public/sitemap.xml` + `public/robots.txt` — domain → `khanalagao.com`.
- `artifacts/restaurant-platform/src/pages/marketplace.tsx` — subtitle copy.
- `artifacts/restaurant-platform/src/pages/display-token.tsx` — public token display footer.
- `artifacts/restaurant-platform/src/pages/customer-survey.tsx` — "Powered by" footer.
- `artifacts/restaurant-platform/src/pages/admin-leads.tsx` — default lead-reply signature.
- `artifacts/tabletrack-mobile/app/login.tsx` — login brand label.
- `artifacts/tabletrack-mobile/app/(customer)/index.tsx` — QR scanner brand label + invalid-QR copy.
- `artifacts/api-server/src/lib/managerOtp.ts` — manager-OTP SMS body fallback name.
- `artifacts/api-server/src/lib/notificationCenter.ts` — built-in trial / expired / festival templates.
- `lib/db/src/schema/marketing.ts` — blog `author` default → `KhanaLagao Team`.

### Intentionally NOT renamed (risky internal identifiers)

These were left as `tabletrack…` on purpose. Each is an internal contract, storage key, package name, env-default, or DB key whose rename would break running tenants, in-flight tokens, or auto-update mechanics. They are invisible to end users.

- pnpm package names (`@workspace/tabletrack-mobile`, artifact directory `artifacts/tabletrack-mobile`) — folder/package renames need a coordinated monorepo migration and lockfile rewrite.
- `localStorage` keys: `tabletrack-theme`, `tabletrack.activeSession.v1`, `tt_sidebar_groups_open_v2`.
- Cross-frame postMessage contract: `tabletrack:public-site:preview` / `…:ready` (paired client/server).
- JWT/HMAC secrets fallback strings in `auth.ts`, `guestToken.ts` (only used when `JWT_SECRET` is unset in dev).
- Default disk paths in `lib/maintenance.ts` (`tabletrack-backups`, `tabletrack-uploads`) and the default S3 prefix.
- Default `SMTP_FROM` (`noreply@tabletrack.app`) — overridable by env, kept for backward compatibility.
- `User-Agent` header on the menu-imports HTTP fetcher.
- Drizzle migration snapshots under `lib/db/drizzle/meta/*.json` — historical, immutable.
- Internal super-admin seed email (`admin@tabletrack.io`).

Tenants that have already customised `appName` / `logoUrl` / `faviconUrl` via the Super Admin settings page continue to be honoured at runtime — none of the rebrand edits override their values.

---

## 3. Restaurant Admin sidebar

The grouping already matches the requested layout: **Dashboard, Sell, Menu, Inventory, Customers, Growth Engine, Khana AI, Staff, Finance, Operations, Marketplace, Reports, Support, Settings** (Settings lives in the footer, Support is a top-level link, both render in the sidebar).

Fix applied in this pass:

- `artifacts/restaurant-platform/src/components/layout/Sidebar.tsx` — `loadOpenState()` now defaults the **Sell** group to expanded when no preference is stored. The user's explicit collapse/expand is still persisted in `localStorage` under `tt_sidebar_groups_open_v2`, so once they toggle it the choice is honoured across refresh, route change, and re-login. The auto-expand-on-active-route behaviour was already correct.

---

## 4. Routes, role gating, plan gating

- Every entry in `navConfig` maps to a registered route in `src/App.tsx`. Stub or premium pages already render a polished upgrade screen rather than 404.
- Role visibility is double-enforced: the sidebar filters by `roles[]` and `planGate`, and the API enforces with `requireRole` (`artifacts/api-server/src/middleware/authorize.ts`) + `planFeature` middleware. No code changes needed in this pass.
- AI credit safety path (`artifacts/api-server/src/lib/aiCredits.ts` + `/api/ai/*` routes) already follows: pre-check → call provider → deduct on success → log usage → 402-style response on insufficient credits, which the UI surfaces as a recharge prompt.
- Review QR flow (`artifacts/api-server/src/routes/reviews.ts`, `artifacts/restaurant-platform/src/pages/review-qrs.tsx`, `customer-feedback.tsx`) is end-to-end functional without a Google API key: rating → tags → optional text → optional AI draft (only when AI plan + credits) → copy → "Open Google Review" deep link. Feedback is persisted regardless of whether the user actually posts to Google.

---

## 5. Demo mode / empty states

`demoModeEnabled` is a real Super Admin toggle, surfaced through `/api/public/app-settings`. The marketing site uses it to gate the `/book-demo` page. Real-tenant dashboards render friendly empty states from live data — no hard-coded mock data leaks were found in this pass.

---

## 6. Remaining gaps / out of scope for this pass

These are real but explicitly out of scope per the task brief. Each one already has, or should have, a dedicated task — overlap is called out so we do not duplicate work.

- **Package / folder rename** (`artifacts/tabletrack-mobile` → `artifacts/khanalagao-mobile`). Needs a coordinated monorepo migration (pnpm lockfile, Expo config, store metadata).
- **Email/SMS sender domain cutover** (`@tabletrack.app` → `@khanalagao.com`). Requires DNS, SPF/DKIM, and a deliverability verification step.
- **Marketing site polish** — testimonials and FAQ sections in `home.tsx` are still placeholder blocks pending real customer content.
- **Settlement reconciliation UI** (`settlement-recon.tsx`) and **Capital & Insurance** (`capital-insurance.tsx`) — placeholder shells awaiting partner integrations.
- **Corporate approval flow** (`api-server/src/routes/corporate.ts`) — multiple `TODO` markers for advanced multi-approver logic.

### Overlap with already-PROPOSED tasks (do not duplicate)

- SMS usage per tenant, delivery receipts, owner phone OTP verification, lead bulk actions / templates / digest — covered by the existing tasks `Show each restaurant its own SMS usage…`, `Honor SMS delivery receipts…`, `Verify owners' phones with the OTP template…`, `Bulk actions and pagination for the leads list`, `Email / SMS / WhatsApp templates picker…`, `Daily digest of overdue and upcoming follow-ups…`.
- Support tickets at-risk digest, post-close rating, attachment virus scan — covered by `Send a daily 'tickets at risk' digest…`, `Let customers rate the help…`, `Make support attachments safer…`.
- Webhook/API log retention + health dashboard + write-capable integrations — covered by `Automatically clean up old API and webhook logs`, `Show webhook health and API usage at a glance`, `Let integrations write data, not just read it`.
- Coupon UX (receipts, trial extension, automated tests) — covered by the three coupon-related tasks already in the queue.
- Super-admin tenant bulk actions and CSV export — covered by `Bulk actions on selected tenants…` and `Export the filtered tenant list to CSV`.
- AI credits — Cashfree/Stripe top-up, live usage breakdown, plan dropdown — covered by `Let tenants top up AI credits with Cashfree and Stripe too`, `Show owners a live AI usage breakdown…`, `Pick AI features from a dropdown…`.

---

## 7. Recommended follow-up tasks

These are net-new and do not overlap with any of the items above:

1. **Monorepo rename: `artifacts/tabletrack-mobile` → `artifacts/khanalagao-mobile`** — package, dir, Expo slug, store metadata, lockfile, CI references. Single coordinated migration.
2. **Sender domain cutover to `khanalagao.com`** — DNS, SPF/DKIM/DMARC, `SMTP_FROM`, default support email, deliverability test plan.
3. **Marketing site: real testimonials + FAQ** — replace placeholder sections in `home.tsx` with CMS-driven content blocks.

---

## 8. Files touched in this pass (summary)

- `artifacts/restaurant-platform/src/components/layout/Sidebar.tsx`
- `artifacts/restaurant-platform/src/pages/{marketplace,display-token,customer-survey,admin-leads}.tsx`
- `artifacts/marketing-site/src/lib/seo.ts`
- `artifacts/marketing-site/src/pages/contact.tsx`
- `artifacts/marketing-site/public/{sitemap.xml,robots.txt}`
- `artifacts/tabletrack-mobile/app/login.tsx`
- `artifacts/tabletrack-mobile/app/(customer)/index.tsx`
- `artifacts/api-server/src/lib/{managerOtp,notificationCenter}.ts`
- `lib/db/src/schema/{app-settings,marketing}.ts`
- `AUDIT_REPORT.md` (this file)
