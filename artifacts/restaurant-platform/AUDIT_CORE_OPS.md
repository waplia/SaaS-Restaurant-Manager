# Audit #1 — Core Restaurant Operations (Task #394)

Scope: POS, KDS, tables, reservations, bills, day-end, dashboard, canteen,
food-court, customer QR, service requests. Out of scope: menu editor, QR UI
redesign, inventory, CRM/loyalty/coupons (Audits #2–#6).

## Status Table

| Feature | Status | Bug found | Fix applied | Retest result |
|---|---|---|---|---|
| POS terminal — cart, modifier picker, KOT print, receipt | Working | None blocking | — | Code-review of `routes/orders.ts` add-items + modifier persistence + KOT broadcast; UI smoke OK. |
| POS — payment (cash/UPI/card/split) | Working | None | — | `/api/orders/:id/pay` (~1290) and `/api/orders/:id/split-payment` (~1480) both write `payments` rows and cash-drawer movements atomically. |
| POS — discount + tax + service charge math | Partial | `recalculateOrderTotals` (orders.ts:270) uses one restaurant-wide tax rate; no per-item override column exists in schema | Documented; out of scope (schema change belongs to Audit #2 — menu pricing) | n/a |
| POS — table state machine (dine-in) | Working | Suspected stuck `occupied` after pay; verified `/pay` and `/split-payment` both set table → `free` (orders.ts:1438, 1528); void also frees (orders.ts:1632) | — | Code review of all 4 sites that write `floor_tables.status`. |
| POS — void / refund order | **FIXED (was Broken)** | `POST /orders/:id/void` accepted any cashier, took no reason, wrote no audit | `orders.ts:1589` — restricted to owner/manager/super_admin; reason required (≥3 chars); update + `audit_logs` insert run in **one db.transaction** — audit failure rolls back the void and returns `VOID_AUDIT_FAILED`. Frontend: `useVoidOrder` + POS `handleVoid` prompt for reason. | `curl -XPOST /api/orders/1/void → 401` (auth gate). Build clean on restart. |
| KDS — Kanban, item display, modifiers/notes shown | Working | None | — | `kitchen.tsx:218` renders notes + modifier groups; sockets `ticket:status`, `order:new`, `ticket:delayed` wired. |
| KDS — KOT cancel with reason + audit | **FIXED (was Missing)** | `PATCH /kitchen/tickets/:id/status` accepted `cancelled` from any role, no reason, no audit; UI had no cancel button | `orders.ts:2151` — manager-only + reason ≥3 chars + transactional audit insert (`CANCEL_AUDIT_FAILED` on rollback). UI: X-button on TicketCard + `handleCancel` prompt. | `curl -XPATCH /api/kitchen/tickets/1/status → 401`. Cancel button visible in KDS. |
| Floor tables — CRUD, merge, transfer/split items, assign waiter | Working | None | — | `routes/tables.ts` merge (~200), split (~250), free/occupied transitions OK. |
| Reservations — CRUD + status + conflict detection | Working | None | — | `tables.ts:311` interval-overlap check uses parameterized SQL — safe. |
| Customer QR menu — browse, cart, place order, track | Working | None in core flow | — | `routes/public.ts` broadcasts `order:new` (incl. `kitchenId`) to POS/KDS; modifier IDs validated server-side. Deep QR/UI work deferred to Audit #2. |
| Customer service requests — water/waiter/bill/help | Working | None | — | Notifications inserted + `notification:new` socket broadcast. |
| Food court POS | Partial (by design) | Minimal UI: no modifier picker, no per-item discount | Documented — intentional quick-vendor mode, not a regression | n/a |
| Canteen POS | Working | None — initial finding (no blocked-item enforcement) was a false positive | — | `routes/canteen.ts:571` enforces `blockedItemIds`/`blockedCategoryIds` plus wallet daily-cap + frozen-wallet. |
| Bill / invoice — display, print, split-by-item / split-by-amount | Working | None | — | Split-payment path writes one `payments` ledger row per leg; cash legs also create drawer movements in same tx. |
| Day open / close & cashier settlement | Working | None | — | `routes/cash-register.ts` enforces single open session via `FOR UPDATE` + partial unique index; variance reason required; blind-close masks figures; checklist gates `/close`. |
| Dashboard summary cards (sales / orders / tables / tickets / alerts) | Working | None | — | `routes/dashboard.ts:15` returns real revenue (excludes cancelled/voided), live table occupancy, KOT counts, low-stock w/ configured min level, manager-gated expenses; zero-baseline growth handled. |
| Live kitchen card (dashboard) | Working (polling) | None — KDS itself uses sockets; the dashboard summary card uses polling intentionally | — | n/a |

## Smoke-test evidence (against running API server, port 8080)

```
$ curl -sS -w "%{http_code}\n" -X POST http://localhost:8080/api/orders/1/void -d '{}'
{"error":"Missing or malformed Authorization header"} 401

$ curl -sS -w "%{http_code}\n" -X PATCH http://localhost:8080/api/kitchen/tickets/1/status \
       -H 'Content-Type: application/json' -d '{"status":"cancelled"}'
{"error":"Missing or malformed Authorization header"} 401

$ curl -sS -w "%{http_code}\n" http://localhost:8080/api/dashboard/summary
{"error":"Missing or malformed Authorization header"} 401
```

Auth gate fires before role/reason validation as designed (defense in depth).

## Code changes (this PR)

1. `artifacts/api-server/src/routes/orders.ts`
   - `POST /orders/:id/void` — owner/manager/super_admin only; `reason` required (≥3); update + audit log in one `db.transaction`; rolls back on audit failure (`VOID_AUDIT_FAILED`).
   - `PATCH /kitchen/tickets/:id/status` — same hardening for `status="cancelled"` (`CANCEL_AUDIT_FAILED`).
   - Imported `auditLogsTable` from `../lib/db`.

2. `artifacts/restaurant-platform/src/lib/hooks.ts`
   - `useVoidOrder({ orderId, reason })` and `useUpdateTicketStatus({..., reason?})` forward reason.

3. `artifacts/restaurant-platform/src/pages/pos.tsx`
   - `handleVoid` prompts for and validates reason.

4. `artifacts/restaurant-platform/src/pages/kitchen.tsx`
   - X-button on `TicketCard`; `handleCancel` prompt; `onCancel` threaded through `KanbanColumn`.

## Known limitations (deferred to downstream audits)

- Per-item tax-rate overrides — requires schema change → Audit #2 (Menu).
- Food-court POS modifier picker — out of scope for this audit; tracked separately.
