/**
 * Cash in / out / expense movement modal.
 *
 * Phase 5+ — every entry is written to SQLite via the main process so it
 * survives a crash and lands in the Sync Center queue. The renderer keeps
 * a tiny localStorage mirror for the "recent" rail and for the in-browser
 * dev shell (where the IPC bridge isn't present).
 *
 * The backend's `shifts:close` flow reconciles the till by counted
 * denominations; these entries are the paper trail the cashier sees on
 * the Reports screen until the shift is closed.
 */
import { useState, useEffect } from "react";
import { Banner, Button, Input, Label, colors } from "../../ui/components";
import { Modal } from "./Modals";
import { fmtINR } from "./types";
import type {
  CashMovementRecord, ExpenseRecord,
} from "../../../../shared/ipc-contract";

export type CashMovementKind = "in" | "out" | "expense";

export interface CashMovement {
  id: string;
  kind: CashMovementKind;
  amount: number;
  reason: string;
  at: number;
  cashier?: string | null;
}

const STORAGE_KEY = "kp:cashMovements";

export function readCashMovements(): CashMovement[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CashMovement[];
  } catch { return []; }
}

function writeLocal(m: CashMovement[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m.slice(-200))); } catch { /* ignore */ }
}

function pushLocal(m: CashMovement) {
  writeLocal([...readCashMovements(), m]);
}

export function clearCashMovements() { writeLocal([]); }

function bridge() {
  return (window as unknown as { khanalagao?: {
    shift?: {
      cashMovement(req: { kind: "in" | "out"; amount: number; reason?: string | null }): Promise<CashMovementRecord>;
      expense(req: { amount: number; reason?: string | null; category?: string | null }): Promise<ExpenseRecord>;
    };
  } }).khanalagao?.shift;
}

interface Props {
  kind: CashMovementKind;
  cashier?: string | null;
  onClose: () => void;
  onSaved?: (m: CashMovement) => void;
}

export function CashMovementModal({ kind, cashier, onClose, onSaved }: Props) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<CashMovement[]>([]);

  useEffect(() => {
    setRecent(readCashMovements().filter(m => m.kind === kind).slice(-5).reverse());
  }, [kind]);

  async function save() {
    const n = Number(amount);
    if (!isFinite(n) || n <= 0) { setErr("Enter a positive amount."); return; }
    if (!reason.trim()) { setErr("Reason is required."); return; }
    setBusy(true); setErr(null);
    const reasonText = reason.trim();
    try {
      const b = bridge();
      let saved: CashMovement;
      if (b) {
        if (kind === "expense") {
          const row = await b.expense({ amount: n, reason: reasonText });
          saved = { id: row.id, kind: "expense", amount: row.amount, reason: row.reason ?? reasonText, at: row.at, cashier: row.cashier };
        } else {
          const row = await b.cashMovement({ kind, amount: n, reason: reasonText });
          saved = { id: row.id, kind, amount: row.amount, reason: row.reason ?? reasonText, at: row.at, cashier: row.cashier };
        }
      } else {
        // Browser dev shell — keep the legacy localStorage path so the page
        // still works without an Electron bridge.
        saved = {
          id: `cm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind, amount: n, reason: reasonText, at: Date.now(), cashier: cashier ?? null,
        };
      }
      pushLocal(saved);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = kind === "in" ? "Cash in" : kind === "out" ? "Cash out (payout)" : "Record expense";
  const cta = kind === "in" ? "Record cash-in" : kind === "out" ? "Record payout" : "Record expense";
  const helper = kind === "in" ? "Float top-up, change supplied by manager, etc."
    : kind === "out" ? "Vendor settled in cash, change picked up, etc."
    : "Petty cash spent (milk, snacks, parking, etc.)";

  return (
    <Modal title={title} onClose={onClose} width={460}>
      <p style={{ color: colors.textDim, fontSize: 12, marginTop: 0 }}>{helper}</p>
      {err && <div style={{ marginBottom: 10 }}><Banner kind="error">{err}</Banner></div>}
      <Label>Amount (₹)</Label>
      <Input
        inputMode="decimal" autoFocus
        value={amount}
        onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, "")); setErr(null); }}
        placeholder="0.00"
      />
      <div style={{ height: 10 }} />
      <Label>Reason / note</Label>
      <Input
        value={reason}
        onChange={(e) => { setReason(e.target.value); setErr(null); }}
        placeholder={kind === "expense" ? "e.g. Milk for kitchen" : "e.g. Owner float"}
      />
      <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : cta}</Button>
      </div>

      {recent.length > 0 && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 6 }}>RECENT</div>
          <div style={{ display: "grid", gap: 4 }}>
            {recent.map(m => (
              <div key={m.id} style={{
                display: "flex", justifyContent: "space-between", fontSize: 12, color: colors.textDim,
              }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {new Date(m.at).toLocaleTimeString()} · {m.reason}
                </span>
                <b style={{ marginLeft: 8, color: colors.textPrimary }}>{fmtINR(m.amount)}</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
