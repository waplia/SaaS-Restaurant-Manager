# TableTrack

A multi-tenant SaaS restaurant management platform — POS, table management, inventory, payroll, staff shifts, and AI-assisted menu generation for restaurant owners and staff.

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

## Gotchas

- Both workflows MUST include `PORT=...` in the command — the app throws if PORT is not set
- Restaurant platform also needs `BASE_PATH=/` in its workflow command
- API server dev mode builds first (esbuild), then starts — cold start ~1s
- Run `pnpm --filter @workspace/db run push` after schema changes before starting the API

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
