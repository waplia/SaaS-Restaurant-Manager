# Role & Route Permission Matrix

Source of truth: server-side `requireRole(...)` calls in `artifacts/api-server/src/routes/`.
Frontend `RoleProtectedRoute` / `Sidebar` gates are advisory and should mirror this table.

Roles: **super_admin (SA)**, **owner (O)**, **manager (M)**, **cashier (Ca)**, **waiter (W)**, **kitchen (K)**, **delivery_executive (D)**, **customer (Cu)**.
Super admin always has access via `isSuperAdmin` short-circuit in `requireRole`.

## API surface (per route file)

### `restaurants.ts`
| Route | O | M | Ca | W | K | D |
|---|---|---|---|---|---|---|
| `GET    /restaurants` | ✓ | ✓ | – | – | – | – |
| `POST   /restaurants` | ✓ | – | – | – | – | – |
| `GET    /restaurants/:id` | ✓ | ✓ | – | ✓ | ✓ | – |
| `PATCH  /restaurants/:id` | ✓ | – | – | – | – | – |
| `GET    /restaurants/:rid/branches` | ✓ | ✓ | – | ✓ | ✓ | – |
| `POST   /restaurants/:rid/branches` | ✓ | ✓ | – | – | – | – |

### `inventory.ts` — parent gate: O, M, K
Writes (create/update/delete inventory, suppliers, POs, recipe-mappings): **O, M only**.
Stock adjust: **O, M, K**.

### `kitchens.ts` — parent gate: O, M, W, K
Create / update / delete kitchen + assignments: **O, M only**.

### `customers.ts` — parent gate: O, M, W, K
Create customer: O, M, W. Update / loyalty / coupons / addresses: O, M.
Send notification: **O only**. Mark notification read: O, M, W.

### `expenses.ts` — parent gate: O, M (only). All routes O, M.

### `subscriptions.ts` — parent gate: O, M, W, K (read).
Checkout / portal / mock-activate: **O only**.

### `cash-register.ts`
Open / close session, list sessions: **O, M, W**.
Z-report and admin operations: **MANAGER_ROLES (O, M)**.

### `delivery.ts` — parent gate: O, M, Ca, W, K, D
Cashier is included in the parent gate (Express middleware is additive — a parent deny cannot be relaxed by a per-route allow). Non-COD routes explicitly narrow via `DELIVERY_OPS_ROLES` to exclude cashier, so cashier only reaches the COD endpoints below:
| Route | O | M | Ca | W | K | D |
|---|---|---|---|---|---|---|
| `GET  /delivery/executives` | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| `POST /delivery/assign` | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| `PATCH /delivery/assignments/:id/status` | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| `POST /delivery/assignments/:id/cod-collected` | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| `GET  /delivery/my` (rider's own assignments) | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| `GET  /delivery/assignments` | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| `GET  /delivery/cod-summary` | ✓ | ✓ | ✓ | – | – | – |
| `GET  /delivery/handovers` | ✓ | ✓ | ✓ | – | – | – |
| `POST /delivery/handovers` | ✓ | ✓ | ✓ | – | – | – |

### `orders.ts` — parent gate: O, M, W, K, D
Kitchen ticket priority: O, M, K.

### `dashboard.ts`, `realtime.ts` — parent gate: O, M, W, K (read-only).

### `storage.ts` — O, M only.

## Frontend route gates (`artifacts/restaurant-platform/src/App.tsx`)
Already role-gated via `RoleProtectedRoute`:
- `/cash-register` → owner, manager, waiter
- `/expenses`, `/delivery/*`, `/settings/:section`, `/settings/subscription`, `/settings/kitchens` → owner, manager
- `/waiter-requests` → owner, manager, waiter

Currently `ProtectedRoute` (any signed-in user) — server enforces, but UX could be tightened (tracked as follow-up #69):
- `/staff`, `/customers`, `/inventory`, `/payments`, `/due-payments`, `/menu`, `/menu-management`, `/notifications`, `/reports/:section`, `/reservations`, `/orders`, `/kitchen`, `/tables`, `/pos`, `/dashboard`, `/settings`

## Walkthrough verification (2026-05-14)
Tested via running workflows + curl against `$REPLIT_DEV_DOMAIN` with admin@demo.com / password123:
- API health: 401 unauthenticated (expected — auth required) ✓
- Dashboard summary + orders list return data after login ✓
- All 4 workflows running (api-server, restaurant-platform, mockup-sandbox, tabletrack-mobile) ✓
- TypeScript: `pnpm -r exec tsc --noEmit` clean across all workspaces ✓
- Mobile expo bundle: webpack bundles 1627 modules with no errors after dependency upgrade ✓
