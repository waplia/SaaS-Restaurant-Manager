/**
 * Cash in / out / expense movement modal.
 *
 * Logs movements to local storage — the backend's `shifts:close` flow
 * already reconciles the till by counted denominations, so the cashier
 * uses these entries as a paper trail for the shift summary. They are
 * surfaced on the Reports screen and persist until the shift is closed.
 */
import { useState, useEffect } from "react";
import { Banner, Button, Input, Label, colors } from "../../ui/components";
import { Modal } from "./Modals";
import { fmtINR } from "./types";

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

function write(m: CashMovement[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m.slice(-200))); } catch { /* ignore */ }
}

export function addCashMovement(m: Omit<CashMovement, "id" | "at">): CashMovement {
  const next: CashMovement = {
    ...m, id: `cm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, at: Date.now(),
  };
  write([...readCashMovements(), next]);
  return next;
}

export function clearCashMovements() { write([]); }

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
  const [recent, setRecent] = useState<CashMovement[]>([]);

  useEffect(() => {
    setRecent(readCashMovements().filter(m => m.kind === kind).slice(-5).reverse());
  }, [kind]);

  function save() {
    const n = Number(amount);
    if (!isFinite(n) || n <= 0) { setErr("Enter a positive amount."); return; }
    if (!reason.trim()) { setErr("Reason is required."); return; }
    const m = addCashMovement({ kind, amount: n, reason: reason.trim(), cashier });
    if (onSaved) onSaved(m);
    onClose();
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
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>{cta}</Button>
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
