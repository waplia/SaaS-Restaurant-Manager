# Offline + Sync — testing guide (Phase 5)

This document explains how the desktop POS behaves while disconnected from
the server, how to verify the sync engine drains the queue once the
connection returns, and how to reproduce the conflict-resolution flow.

## Architecture in one paragraph

The main process opens a SQLite database (`better-sqlite3`, WAL mode) under
the OS `userData` directory. Every renderer IPC call for menu, tables,
customers and orders goes through an offline-aware wrapper that:

1. Tries the live API when the connectivity probe (`GET /healthz` every 10s)
   reports online. On success the response is written back into SQLite.
2. Falls back to the cached rows when offline.
3. For writes (`orders:create`, `orders:add-items`, `orders:pay`,
   `customers:create`), offline calls assign a **negative local id**, write
   the optimistic record into SQLite and enqueue a pending op. The sync
   engine drains the queue FIFO once the probe flips back online and
   remaps local ids → server ids on success.

The renderer never talks to the network directly; every channel is declared
in `desktop/shared/ipc-contract.ts` and routed through the preload bridge
(`window.khanalagao.*`).

## Manual test matrix

Run the app with `pnpm --filter @workspace/desktop-pos dev`, sign in, open
a shift, then exercise each scenario below.

### 1. Healthy online round-trip

1. Confirm the topbar shows a green **Online** pill.
2. Open the **Sync status** modal (top-right menu) — `Pending` and
   `Conflicts` are both `0`, `Last check` updates every ~10s.

### 2. Cold offline (network off before any cache)

1. With the app closed, disable the network.
2. Start the app and sign in (auth still requires the network — sign in
   while online once, then disable). The Workspace should render with the
   menu pulled from the last hydrate.

### 3. Hot offline (network drops mid-shift)

1. While running, disable Wi-Fi / pull the cable.
2. Within ~10s the topbar pill flips to **Offline** (the `/healthz` probe
   fails). A `⟳ N pending` chip appears as soon as you queue work.
3. Add items to a table, take a **cash** payment — the bill prints from
   the local cache.
4. Try **UPI** or **Card** — the tender buttons are disabled with a
   tooltip and the offline banner explains why.
5. Try **Close shift** — the modal shows a warning banner with the
   pending-ops count and refuses to submit without a manager PIN. Entering
   a PIN force-closes and preserves the queue.

### 4. Drain on reconnect

1. Re-enable the network. Within ~10s the pill flips back to **Online**
   and the sync engine drains FIFO.
2. Reopen the **Sync status** panel — the queue empties row by row, and
   the locally-assigned negative order numbers are replaced by the
   server-assigned ones in the live orders rail.

### 5. Conflict capture

1. While offline, edit an order whose server-side state will be modified
   from another device (e.g. mark it as paid from the web admin).
2. Reconnect — the sync engine receives an HTTP 4xx (not 401/408/429) and
   moves the op into the **Conflicts** tray.
3. In **Sync status**, choose **Discard** (drop the local change) or
   **Retry** (re-enqueue it after the cashier reconciles by hand).

### 6. Reset local data

1. Open **Hardware → Local data**. The card shows DB size, row counts and
   the SQLite file path.
2. Click **Reset local data**, confirm. The DB file is rebuilt at next
   read; click **Re-hydrate menu + tables** to refill it.

## Where to look in the code

| Concern                  | File                                                  |
| ------------------------ | ----------------------------------------------------- |
| Schema + migrations      | `desktop/main/db/schema.ts`                           |
| Queries + ID remap       | `desktop/main/db/queries.ts`, `desktop/main/db/pending.ts` |
| Connectivity probe       | `desktop/main/sync/connectivity.ts`                   |
| FIFO drain + conflicts   | `desktop/main/sync/engine.ts`                         |
| Menu/tables hydrate      | `desktop/main/sync/hydrate.ts`                        |
| Offline-aware IPC layer  | `desktop/main/ipc/offline.ts`                         |
| Renderer sync UI         | `desktop/renderer/src/screens/order/SyncPanel.tsx`    |
| Tender + close-shift gates | `desktop/renderer/src/screens/order/PaymentModal.tsx`, `…/CloseShiftModal.tsx` |
| Reset local data UI      | `desktop/renderer/src/screens/HardwareSettings.tsx` (`LocalCacheCard`) |
