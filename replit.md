# KhanaLagao

A multi-tenant SaaS restaurant management platform — POS, table management, inventory, payroll, staff shifts, and AI-assisted menu generation for restaurant owners and staff.

(Internal package and directory names retain the `tabletrack` identifier; the user-facing brand is KhanaLagao.)

## Run & Operate

- **API Server workflow** — runs `PORT=8080 pnpm --filter @workspace/api-server run dev` on port 8080
- **Start application workflow** — runs `PORT=22508 BASE_PATH=/ pnpm --filter @workspace/restaurant-platform run dev` on port 22508 (external port 3001)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Socket.io (real-time)
- DB: PostgreSQL + Drizzle ORM (Replit managed)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle)
- Frontend: React 19 + Vite 7 + TailwindCSS 4 + shadcn/ui

## Where things live

- `artifacts/api-server/src/` — Express API server
- `artifacts/restaurant-platform/src/` — React web admin/POS frontend
- `artifacts/tabletrack-mobile/` — Expo mobile app (not yet wired up)
- `lib/db/src/schema/` — Drizzle schema (source of truth for DB)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API)
- `lib/api-client-react/` — Generated React Query hooks (don't edit)
- `lib/api-zod/` — Generated Zod schemas (don't edit)

## Architecture decisions

- Multi-tenant: all DB queries are scoped by `tenantId` via middleware
- JWT auth: access + refresh token pair; `JWT_SECRET` and `JWT_RESET_SECRET` set as shared env vars
- API is served at `/api` path prefix; frontend routes everything else through `/`
- Real-time order/kitchen updates via Socket.io on the same HTTP server
- Dev fallbacks exist for JWT secrets (dev-only; production enforces real secrets)

## Product

- Restaurant owners: dashboard, menu management, inventory, staff payroll/shifts, subscription management
- Waiters/kitchen staff: order taking, kitchen ticket display, table management
- Customers: QR-code menu browsing and order tracking
- AI features: menu drafting from images/text via Gemini and Anthropic

## User preferences

- User wants the full project running live with database

## Plan feature catalogue

- `lib/db/src/planFeatures.ts` is the single source of truth for per-plan
  boolean toggles, numeric tunables and quantity columns. Adding a key to
  `PLAN_BOOLEAN_FEATURES` automatically wires it into:
  - the super-admin plan editor (`/admin`, grouped by category)
  - the marketing pricing page (`/pricing`) and the full comparison matrix
    at `/compare`
  - the seed defaults (`defaultFeatureFlagsForPlan(tier)`) used by
    `artifacts/api-server/src/seed.ts` and by `routes/tenants.ts` when an
    admin creates a brand-new plan
- New advanced-pack features may set `sidebarHref` on their catalogue
  entry; this registers an automatic placeholder route in
  `artifacts/restaurant-platform/src/App.tsx` that renders
  `pages/upgrade-required.tsx` until a domain task ships the real screen.
- `Sidebar.tsx` accepts any feature-flag key as `planGate`; the flag is
  resolved against the live subscription's `plan.featureFlags`. The legacy
  `ai` / `ai_insights` / `cloud_kitchen` gates remain supported.
- New audit-log entity and action strings introduced by the advanced packs
  live in `lib/db/src/auditEntities.ts`. The audit table uses free-form
  strings (no Postgres enum), so domain tasks should import
  `NEW_AUDIT_ENTITIES` / `AUDIT_ACTIONS` instead of inlining literals.

## Subscription upgrade drawer

- `pages/subscription.tsx` `CheckoutModal` is a right-anchored shadcn `Sheet`
  drawer (full width on mobile, ~440 px on `sm+`). No gateway is privileged
  — every method the super-admin enables is rendered in the canonical order
  Cashfree → Razorpay → Stripe → UPI → Bank with identical styling.
- `methods.online.default` from `GET /restaurants/:id/billing/methods` is used
  only to pre-select the initial radio button; tenants can switch freely.
- When a gateway's credentials are missing the API now returns `503` with
  `{ code: "GATEWAY_DISABLED", provider }` (see
  `routes/subscriptions.ts` create-checkout / create-cashfree-order and
  `routes/billing.ts` create-razorpay-order). The drawer shows a
  "method temporarily unavailable" toast and the tenant picks another option.
- When zero methods are enabled the drawer hides the Pay button and shows a
  muted "Online payments aren't set up yet" message.

## Gotchas

- Both workflows MUST include `PORT=...` in the command — the app throws if PORT is not set
- Restaurant platform also needs `BASE_PATH=/` in its workflow command
- API server dev mode builds first (esbuild), then starts — cold start ~1s
- Run `pnpm --filter @workspace/db run push` after schema changes before starting the API

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
