# Khanalagao Desktop POS — Hardware testing guide

This document covers end-to-end manual testing for **Phase 3 hardware** —
ESC/POS thermal printers, the cash drawer, and a USB barcode/QR scanner.

All hardware I/O runs **only** in the Electron main process. The renderer
exclusively goes through `window.khanalagao.printers / drawer / scanner`,
which are typed against `desktop/shared/ipc-contract.ts`.

## 1. Prerequisites

Before testing on a real terminal:

- Install the printer's vendor driver on the host OS so it shows up in
  `Settings → Printers & Scanners` (Windows) or `lpstat -p` (macOS / Linux).
- Plug the cash drawer into the printer's `RJ11/RJ12` drawer port (not the
  computer). The drawer-kick pulse rides on the print cable.
- Connect the barcode scanner over USB and verify it presents as a keyboard
  (most do — they "type" the scanned value plus a trailing Enter).

Then build & launch the dev shell:

```bash
pnpm --filter @workspace/desktop-pos run dev
```

The window opens straight into the Khanalagao POS shell. Sign in, pick an
outlet + counter, open a shift, then click **Hardware** in the left nav.

## 2. Printers tab

### 2.1 Detection

1. Open **Hardware → Printers**.
2. Confirm every OS-installed printer appears in the dropdowns. If a printer
   is missing, click **Refresh list** — the panel re-runs `getPrintersAsync`
   in the main process.
3. The system-default printer is suffixed with `(system default)`.

### 2.2 Role assignment

For each role (Bill, KOT default, Kitchen, Bar, Parcel, Cash drawer):

1. Pick a printer from the dropdown.
2. Click **Test print** on the same row.
3. Verify the printer prints the test header (printer name + timestamp) and
   then cuts.

Roles are persisted to `electron-store` (namespace `khanalagao-pos`, key
`settings`) so they survive app restarts.

### 2.3 Per-kitchen overrides

If the outlet has more than one kitchen station mapped on the server (for
example "Tandoor" = kitchen id 12 and "Cold Bar" = kitchen id 13):

1. In **Per-kitchen overrides**, type the kitchen id, pick a printer, click
   **Add override**.
2. Repeat for each kitchen that should have its own printer.
3. Send a multi-station test order (see §2.4). Each kitchen's items must
   land on its assigned printer with the kitchen label in the header.

Routing priority (highest to lowest):

1. Per-kitchen override (`kitchenPrinters[id]`)
2. Parcel printer when `orderType ∈ {takeaway, delivery}`
3. Bar printer when the kitchen name matches `/bar/i`
4. Kitchen role printer when the item has a kitchen name but no override
5. KOT default printer

### 2.4 KOT dispatch end-to-end

Run from the Electron DevTools console (View → Toggle DevTools in dev):

```js
await window.khanalagao.printers.printOrderKots({
  orderNumber: "TEST-100",
  outletName: "Khanalagao Demo",
  tableLabel: "Table T3",
  orderType: "dine_in",
  createdAt: new Date().toISOString(),
  items: [
    { name: "Paneer Tikka", quantity: 2, kitchenId: 12, kitchenName: "Tandoor",
      modifiers: [{ name: "Extra spicy" }], notes: "No onions" },
    { name: "Cold Coffee",  quantity: 1, kitchenId: 13, kitchenName: "Bar" },
    { name: "Naan",         quantity: 4, kitchenId: 12, kitchenName: "Tandoor" },
  ],
});
```

Expected: two ESC/POS jobs fire — one to the Tandoor printer with the
Paneer Tikka + Naan rows, one to the Bar printer with the Cold Coffee row.
Each ticket has the order number, table, timestamp, and a print-time footer.

### 2.5 Bill print + drawer-kick

```js
await window.khanalagao.printers.printOrderBill({
  orderNumber: "TEST-100",
  createdAt: new Date().toISOString(),
  tableLabel: "Table T3",
  items: [
    { name: "Paneer Tikka", quantity: 2, unitPrice: 220, lineTotal: 440 },
    { name: "Cold Coffee",  quantity: 1, unitPrice: 180, lineTotal: 180 },
  ],
  subtotal: 620, taxAmount: 31, serviceCharge: 0, discountAmount: 0,
  totalAmount: 651,
  payment: { method: "cash", tendered: 1000, change: 349 },
  restaurant: { name: "Khanalagao Demo", address: "Indiranagar, Bengaluru", phone: "+91 80 0000 0000" },
  openDrawer: true,
});
```

Expected: bill prints on the Bill role printer, and the cash drawer
attached to that printer pops open.

## 3. Drawer tab (Hardware → Drawer · Scanner · Tray)

### 3.1 Test kick

1. Click **Test kick**. The drawer connected to the **Cash drawer** role
   printer (or the bill printer when no dedicated drawer printer is set)
   should pop open.
2. If nothing happens, check:
   - The RJ-cable runs printer → drawer (not host → drawer).
   - The role printer is reachable (Test print on the Printers tab works).
   - On Windows, the user account has access to the spooler for that
     printer.

### 3.2 Kick before / after print

Toggle "Kick before print" vs "Kick after print" and rerun the bill print
in §2.5. Some printers buffer the cut so kicking after-print delays the
pop until the receipt is on the counter; kicking before gives the cashier
faster access at the cost of mixing the drawer noise with the print head.

## 4. Scanner tester (Hardware → Drawer · Scanner · Tray)

1. Confirm **Enabled** is checked.
2. Click anywhere outside an input field, then scan a barcode.
3. The decoded value appears within ~200ms in the **Last 5 scans** list,
   and a chip flashes in the top bar of the workspace.
4. Toggle **Enabled** off, scan again — the scan must NOT be detected
   (the global hook returns immediately when disabled).

The hook lives at `desktop/renderer/src/hooks/useScanner.ts` and:
- Buffers fast keystrokes that arrive within ~50ms of each other.
- Skips capture while a text input / textarea has focus so cashier typing
  is never mis-classified.
- Requires the burst to terminate with Enter and be ≥5 chars.
- Dispatches a `tt:scan` `CustomEvent` on `window` for Phase 2's cart to
  subscribe to.

## 5. Reprint shortcuts

After at least one KOT and one bill have been printed in this session:

1. Open **Hardware → Drawer · Scanner · Tray → Reprint shortcuts**.
2. Click **Reprint last KOT** — the most recent multi-kitchen KOT dispatch
   should re-run with `reprint` in the summary.
3. Click **Reprint last bill** — the most recent bill payload reprints to
   the Bill role printer.

Both buttons return a `null` result if no print has happened yet on this
process — the panel surfaces this as a friendly toast.

## 6. Failed-prints tray

Force a failure to test the queue:

1. In **Printers**, set the Bill role to a real printer.
2. Power the printer off (or unplug the USB).
3. Run the bill print snippet from §2.5.
4. A red `⚠ 1 failed print` badge appears in the workspace top bar.
5. Open **Hardware → Drawer · Scanner · Tray → Failed prints**.
6. The job is listed with the printer name, timestamp, and OS error.
7. Power the printer back on, click **Retry** — the bill should print and
   the row should disappear.
8. Click **Discard** on a row to drop it without retrying.
9. Click **Clear all** to drop the queue.

The queue is persisted to `electron-store` under
`khanalagao-pos.failedPrints` and capped at 50 entries (oldest first).

## 7. Known limitations

- **Drawer-kick on non-printer drawers** is not supported. The drawer must
  be cabled to a printer that accepts the ESC/POS `ESC p` pulse.
- **PDF printers** are listed in dropdowns. Selecting one is harmless but
  ESC/POS bytes will render as garbled binary in the PDF — use only for
  driver-routing diagnostics, never for real cashier work.
- **Bluetooth scanners** that pair as HID work; ones that present as a
  custom serial device do not — those need a dedicated Phase 3.1 driver.
- The bill QR (UPI) is rendered as a text line, not a graphical QR. The
  web bill keeps the graphical QR; bringing it to thermal output needs an
  ESC/POS QR raster command and lives in a follow-up task.
