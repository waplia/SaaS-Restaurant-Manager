/**
 * Hardware settings panel — Printers + Hardware tabs.
 *
 * Tabs:
 *   • Printers — pick an OS printer for each role (bill, KOT default,
 *     kitchen, bar, parcel, cash drawer). Per-row test print button.
 *   • Hardware — drawer kick before/after, drawer test, scanner enable,
 *     last 5 scans tester, failed-prints tray, reprint last KOT/bill.
 *
 * All hardware actions are IPC-only. The panel never touches `node-printer`
 * or USB devices directly.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  OsPrinter, PrinterAssignments, PrinterRole, DrawerSettings,
  FailedPrintEntry,
} from "../../../shared/ipc-contract";
import { Button, Card, Label, Spinner, colors, Banner } from "../ui/components";

type Tab = "printers" | "hardware";

const ROLES: Array<{ role: PrinterRole; label: string; desc: string }> = [
  { role: "bill",       label: "Bill",         desc: "Customer receipt / tax invoice on settle" },
  { role: "kot",        label: "KOT (default)", desc: "Fallback for any item without a kitchen mapping" },
  { role: "kitchen",    label: "Kitchen",      desc: "Hot kitchen items (when kitchen has no override)" },
  { role: "bar",        label: "Bar",          desc: "Beverages / bar station" },
  { role: "parcel",     label: "Parcel",       desc: "Takeaway & delivery KOTs" },
  { role: "cashDrawer", label: "Cash drawer",  desc: "Drawer-pulse is sent here on cash payments" },
];

interface Props {
  online: boolean;
}

export function HardwareSettings({ online }: Props) {
  const [tab, setTab] = useState<Tab>("printers");

  return (
    <div style={{ width: "100%", maxWidth: 920, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>Hardware</h2>
      <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
        Configure printers, drawer behaviour and the barcode scanner for this terminal.
      </p>
      <div style={{ display: "flex", gap: 8, margin: "16px 0", borderBottom: `1px solid ${colors.border}` }}>
        <TabBtn active={tab === "printers"} onClick={() => setTab("printers")}>Printers</TabBtn>
        <TabBtn active={tab === "hardware"} onClick={() => setTab("hardware")}>Drawer · Scanner · Tray</TabBtn>
      </div>
      {tab === "printers" ? <PrintersTab /> : <DeviceTab online={online} />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent", border: 0,
        borderBottom: `2px solid ${active ? colors.brand : "transparent"}`,
        color: active ? colors.textPrimary : colors.textDim,
        padding: "10px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer",
      }}
    >{children}</button>
  );
}

// ─── Printers tab ─────────────────────────────────────────────────────────
function PrintersTab() {
  const [printers, setPrinters] = useState<OsPrinter[] | null>(null);
  const [assignments, setAssignments] = useState<PrinterAssignments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        window.khanalagao.printers.list(),
        window.khanalagao.printers.getAssignments(),
      ]);
      setPrinters(p);
      setAssignments(a);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!printers || !assignments) return <FullSpinner />;

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const setRole = async (role: PrinterRole, name: string | null) => {
    const next = await window.khanalagao.printers.assignRole(role, name);
    setAssignments(next);
  };

  const test = async (role: string, printerName: string | null) => {
    if (!printerName) return;
    setBusyRole(role);
    try {
      await window.khanalagao.printers.test(printerName);
      flash(`Test sent to ${printerName}`);
    } catch (e) {
      flash(`Test failed: ${(e as Error).message}`);
    } finally {
      setBusyRole(null);
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {toast && <Banner kind="info">{toast}</Banner>}
      {printers.length === 0 && (
        <Banner kind="info">No printers detected by the operating system. Install the printer driver and click Refresh.</Banner>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={refresh}>Refresh list</Button>
      </div>
      {ROLES.map(({ role, label, desc }) => {
        const valueKey: keyof PrinterAssignments = ({
          bill: "billPrinter", kot: "kotPrinter", kitchen: "kitchenPrinter",
          bar: "barPrinter", parcel: "parcelPrinter", cashDrawer: "cashDrawerPrinter",
        } as const)[role];
        const value = (assignments[valueKey] as string | null) ?? "";
        return (
          <Card key={role}>
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{label}</div>
                <div style={{ color: colors.textDim, fontSize: 12 }}>{desc}</div>
              </div>
              <PrinterSelect
                value={value}
                printers={printers}
                onChange={(name) => void setRole(role, name || null)}
              />
              <Button variant="ghost" disabled={!value || busyRole === role} onClick={() => void test(role, value || null)}>
                {busyRole === role ? "Sending…" : "Test print"}
              </Button>
            </div>
          </Card>
        );
      })}
      <KitchenOverrides
        printers={printers}
        assignments={assignments}
        onChange={setAssignments}
      />
      <div style={{ color: colors.textDim, fontSize: 12, marginTop: 4 }}>
        <Label>How KOT routing works</Label>
        Items are sent to their kitchen override printer first, then to the role default
        based on the order type (parcel for takeaway/delivery), then to the KOT default.
      </div>
    </div>
  );
}

function PrinterSelect({ value, printers, onChange }: { value: string; printers: OsPrinter[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: colors.bg, color: colors.textPrimary,
        border: `1px solid ${colors.borderStrong}`, borderRadius: 6,
        padding: "8px 10px", fontSize: 14, width: "100%",
      }}
    >
      <option value="">— Not assigned —</option>
      {printers.map((p) => (
        <option key={p.name} value={p.name}>
          {p.name}{p.isDefault ? "  (system default)" : ""}
        </option>
      ))}
    </select>
  );
}

function KitchenOverrides({
  printers, assignments, onChange,
}: {
  printers: OsPrinter[];
  assignments: PrinterAssignments;
  onChange: (a: PrinterAssignments) => void;
}) {
  const entries = Object.entries(assignments.kitchenPrinters ?? {});
  const [draftId, setDraftId] = useState("");
  const [draftPrinter, setDraftPrinter] = useState("");

  const add = async () => {
    const id = Number(draftId);
    if (!Number.isFinite(id) || id <= 0 || !draftPrinter) return;
    const next = await window.khanalagao.printers.assignKitchen(id, draftPrinter);
    onChange(next);
    setDraftId(""); setDraftPrinter("");
  };

  const remove = async (id: string) => {
    const next = await window.khanalagao.printers.assignKitchen(Number(id), null);
    onChange(next);
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Per-kitchen overrides</div>
          <div style={{ color: colors.textDim, fontSize: 12 }}>
            Pin specific kitchens (by id) to a specific printer — beats the role defaults.
          </div>
        </div>
      </div>
      {entries.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
          {entries.map(([id, printer]) => (
            <div key={id} style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 8, alignItems: "center" }}>
              <div style={{ fontFamily: "monospace" }}>Kitchen #{id}</div>
              <div style={{ color: colors.textDim }}>{printer}</div>
              <Button variant="ghost" onClick={() => void remove(id)}>Remove</Button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 8, alignItems: "center", marginTop: 12 }}>
        <input
          value={draftId}
          onChange={(e) => setDraftId(e.target.value.replace(/\D/g, ""))}
          placeholder="Kitchen id"
          style={{
            background: colors.bg, color: colors.textPrimary,
            border: `1px solid ${colors.borderStrong}`, borderRadius: 6,
            padding: "8px 10px", fontSize: 14,
          }}
        />
        <PrinterSelect value={draftPrinter} printers={printers} onChange={setDraftPrinter} />
        <Button disabled={!draftId || !draftPrinter} onClick={() => void add()}>Add override</Button>
      </div>
    </Card>
  );
}

// ─── Drawer / scanner / tray tab ──────────────────────────────────────────
function DeviceTab({ online }: { online: boolean }) {
  const [drawer, setDrawer] = useState<DrawerSettings | null>(null);
  const [scanner, setScanner] = useState<{ enabled: boolean; lastScans: Array<{ at: number; value: string }> } | null>(null);
  const [failed, setFailed] = useState<FailedPrintEntry[] | null>(null);
  const [drawerTesting, setDrawerTesting] = useState(false);
  const [reprintBusy, setReprintBusy] = useState<"kot" | "bill" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [d, s, f] = await Promise.all([
      window.khanalagao.drawer.getSettings(),
      window.khanalagao.scanner.getState(),
      window.khanalagao.failedPrints.list(),
    ]);
    setDrawer(d); setScanner(s); setFailed(f);
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.khanalagao.failedPrints.onChanged(() => void refresh());
    const id = window.setInterval(() => {
      // Light polling for new scans while the tester is open
      window.khanalagao.scanner.getState().then(setScanner).catch(() => undefined);
    }, 1500);
    return () => { off(); window.clearInterval(id); };
  }, [refresh]);

  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2500); };

  if (!drawer || !scanner || !failed) return <FullSpinner />;

  const testDrawer = async () => {
    setDrawerTesting(true);
    try {
      await window.khanalagao.drawer.open();
      flash("Drawer-pulse sent.");
    } catch (e) {
      flash(`Drawer test failed: ${(e as Error).message}`);
    } finally {
      setDrawerTesting(false);
    }
  };

  const toggleDrawer = async (kickBefore: boolean) => {
    setDrawer(await window.khanalagao.drawer.setSettings({ kickBefore }));
  };

  const toggleScanner = async (enabled: boolean) => {
    await window.khanalagao.scanner.setEnabled(enabled);
    setScanner({ ...scanner, enabled });
  };

  const reprintKot = async () => {
    setReprintBusy("kot");
    try {
      const r = await window.khanalagao.printers.reprintLastKot();
      if (!r) flash("No KOT printed yet on this terminal.");
      else flash(`Reprinted ${r.printed.length} ticket${r.printed.length === 1 ? "" : "s"}`);
    } catch (e) { flash(`Reprint failed: ${(e as Error).message}`); }
    finally { setReprintBusy(null); }
  };
  const reprintBill = async () => {
    setReprintBusy("bill");
    try {
      const r = await window.khanalagao.printers.reprintLastBill();
      if (r === null) flash("No bill printed yet on this terminal.");
      else flash("Bill reprinted.");
    } catch (e) { flash(`Reprint failed: ${(e as Error).message}`); }
    finally { setReprintBusy(null); }
  };

  const retry = async (id: string) => {
    try { await window.khanalagao.failedPrints.retry(id); flash("Retried."); }
    catch (e) { flash(`Retry failed: ${(e as Error).message}`); }
  };
  const discard = async (id: string) => { await window.khanalagao.failedPrints.discard(id); };
  const clearAll = async () => { await window.khanalagao.failedPrints.clear(); };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {toast && <Banner kind="info">{toast}</Banner>}

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Cash drawer</div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: colors.textDim }}>
            <input
              type="radio" name="drawer-kick" checked={!drawer.kickBefore}
              onChange={() => void toggleDrawer(false)}
            /> Kick after print (default)
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: colors.textDim }}>
            <input
              type="radio" name="drawer-kick" checked={drawer.kickBefore}
              onChange={() => void toggleDrawer(true)}
            /> Kick before print
          </label>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" disabled={drawerTesting} onClick={() => void testDrawer()}>
            {drawerTesting ? "Sending…" : "Test kick"}
          </Button>
        </div>
        <div style={{ color: colors.textDim, fontSize: 12, marginTop: 8 }}>
          The drawer kicks on cash payments only (Phase 4 wires settle → kick). Card / UPI never opens the drawer.
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Barcode / QR scanner</div>
            <div style={{ color: colors.textDim, fontSize: 12 }}>
              USB HID-keyboard scanners are detected automatically. Scans are routed to the item grid when it has focus.
            </div>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox" checked={scanner.enabled}
              onChange={(e) => void toggleScanner(e.target.checked)}
            /> Enabled
          </label>
        </div>
        <Label>Last 5 scans</Label>
        {scanner.lastScans.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 13 }}>No scans yet. Click here and scan a barcode to test.</div>
        ) : (
          <div style={{ display: "grid", gap: 4 }}>
            {scanner.lastScans.map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 13 }}>
                <span>{s.value}</span>
                <span style={{ color: colors.textDim }}>{new Date(s.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Reprint shortcuts</div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" disabled={reprintBusy === "kot"} onClick={() => void reprintKot()}>
            {reprintBusy === "kot" ? "Sending…" : "Reprint last KOT"}
          </Button>
          <Button variant="ghost" disabled={reprintBusy === "bill"} onClick={() => void reprintBill()}>
            {reprintBusy === "bill" ? "Sending…" : "Reprint last bill"}
          </Button>
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700 }}>Failed prints</div>
            <div style={{ color: colors.textDim, fontSize: 12 }}>
              Jobs that didn't reach paper. Retry individually, or clear once the issue is fixed.
            </div>
          </div>
          {failed.length > 0 && <Button variant="ghost" onClick={() => void clearAll()}>Clear all</Button>}
        </div>
        {failed.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: 13, marginTop: 8 }}>All caught up — no failed jobs.</div>
        ) : (
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {failed.slice().reverse().map((entry) => (
              <div key={entry.id} style={{
                border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10,
                display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{entry.summary}</div>
                  <div style={{ fontSize: 11, color: colors.textDim }}>
                    {new Date(entry.at).toLocaleString()}
                    {entry.printerName ? ` · ${entry.printerName}` : ""}
                    {" · "}{entry.error}
                  </div>
                </div>
                <Button variant="ghost" disabled={!online} onClick={() => void retry(entry.id)}>Retry</Button>
                <Button variant="ghost" onClick={() => void discard(entry.id)}>Discard</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function FullSpinner() {
  return (
    <div style={{ display: "grid", placeItems: "center", padding: 32 }}>
      <Spinner size={24} />
    </div>
  );
}
