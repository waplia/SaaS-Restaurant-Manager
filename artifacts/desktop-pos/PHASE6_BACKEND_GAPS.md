# Phase 6 specialist workspaces — backend endpoint gaps

This document tracks the screens that ship as visible "endpoint pending"
panes in the desktop specialist workspaces (Inventory, Accountant,
Marketing, Delivery) because no matching REST endpoint exists on the
API server yet. Each entry lists the screen, the proposed endpoint
shape, and where the placeholder UI lives so a follow-up backend task
can flip them on without UI changes.

Task #688 intentionally adds no new backend endpoints — the desktop
client only consumes existing routes. The placeholders are deliberate
"no dead buttons" markers so the role surface stays complete.

## Inventory workspace

| Nav key              | Proposed endpoint                                       | Placeholder file              |
|----------------------|---------------------------------------------------------|-------------------------------|
| `warehouse`          | `GET/POST /restaurants/:r/inventory/warehouses`         | `specialist/inventory.tsx`    |
| `warehouse-type`     | `GET/POST /restaurants/:r/inventory/warehouse-types`    | `specialist/inventory.tsx`    |
| `stock-transfer`     | `POST /restaurants/:r/inventory/transfers`              | `specialist/inventory.tsx`    |
| `vendor-ocr`         | `POST /restaurants/:r/purchase-orders/ocr` (file upload)| `specialist/inventory.tsx`    |

## Accountant workspace

| Nav key            | Proposed endpoint                                       | Placeholder file            |
|--------------------|---------------------------------------------------------|-----------------------------|
| `voucher`          | `GET/POST /restaurants/:r/accounting/vouchers`          | `specialist/accounts.tsx`   |
| `cards`            | `GET /restaurants/:r/accounting/cards`                  | `specialist/accounts.tsx`   |
| `wallet`           | `GET /restaurants/:r/accounting/wallet`                 | `specialist/accounts.tsx`   |
| `bank-recon`       | `GET/POST /restaurants/:r/accounting/bank-reconciliation`| `specialist/accounts.tsx`  |
| `refunds`          | `GET/POST /restaurants/:r/accounting/refunds`           | `specialist/accounts.tsx`   |
| `settlements`      | `GET /restaurants/:r/accounting/settlements`            | `specialist/accounts.tsx`   |

## Marketing workspace

| Nav key       | Proposed endpoint                                       | Placeholder file             |
|---------------|---------------------------------------------------------|------------------------------|
| `segments`    | `POST /restaurants/:r/segments` (save side)             | `specialist/marketing.tsx`   |

Note: `/segments/preview` already exists; the save endpoint is missing.

## Delivery workspace

| Surface                       | Proposed endpoint / data                                  | Placeholder location         |
|-------------------------------|-----------------------------------------------------------|------------------------------|
| Per-assignment distance / ETA | Either Google Distance Matrix proxy at `/restaurants/:r/delivery/assignments/:id/eta` or schema columns `distanceMeters`, `etaMinutes` populated at assign time | `specialist/delivery.tsx` table + drawer |
| COD summary date filtering    | Extend `GET /delivery/cod-summary` to accept `?from=&to=` | `specialist/delivery.tsx` `CodCollectionScreen` |

## Conventions

When a placeholder screen ships, it renders the shared `PendingBackend`
component from `specialist/shared.tsx` with the proposed endpoint path
in its hint text. That keeps the wire-up trivial later: implement the
route, swap the `PendingBackend` for a real `useAsync` + `DataTable`,
remove the row from this document.
