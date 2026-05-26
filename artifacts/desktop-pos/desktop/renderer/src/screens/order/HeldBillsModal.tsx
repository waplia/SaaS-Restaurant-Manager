/**
 * Hold / recall modal — F5 from the POS workspace.
 *
 * Local-only park-a-cart helper. Lets the cashier save the in-progress
 * cart (items + chosen customer / table) and pick another one up later.
 */
import { Button, colors } from "../../ui/components";
import { type HeldBill } from "../../hooks/useHeldBills";
import { Modal } from "./Modals";
import { fmtINR } from "./types";

interface Props {
  bills: HeldBill[];
  onClose: () => void;
  onRecall: (bill: HeldBill) => void;
  onDelete: (id: string) => void;
}

export function HeldBillsModal({ bills, onClose, onRecall, onDelete }: Props) {
  return (
    <Modal title={`Held bills · ${bills.length}`} onClose={onClose} width={600}>
      {bills.length === 0 && (
        <div style={{ color: colors.textDim, padding: 30, textAlign: "center" }}>
          No bills are currently parked.
          <div style={{ fontSize: 11, marginTop: 8 }}>
            Press F5 with a cart in progress to hold it for later.
          </div>
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {bills.map(b => {
          const itemCount = b.lines.reduce((n, l) => n + l.quantity, 0);
          const total = b.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
          return (
            <div key={b.id} style={{
              background: colors.panelAlt, border: `1px solid ${colors.border}`,
              borderRadius: 8, padding: 12,
              display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center",
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{b.label}</div>
                <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                  {new Date(b.createdAt).toLocaleString()}
                  {b.tableLabel ? ` · ${b.tableLabel}` : ""}
                  {b.customerName ? ` · ${b.customerName}` : ""}
                  {b.cashier ? ` · ${b.cashier}` : ""}
                </div>
                <div style={{ fontSize: 12, color: colors.textDim, marginTop: 4 }}>
                  {itemCount} item{itemCount === 1 ? "" : "s"} · {fmtINR(total)}
                  {b.note ? ` · "${b.note}"` : ""}
                </div>
              </div>
              <Button onClick={() => onRecall(b)} style={{ padding: "6px 12px", fontSize: 12 }}>Recall</Button>
              <Button
                variant="danger"
                onClick={() => { if (window.confirm("Discard this held bill?")) onDelete(b.id); }}
                style={{ padding: "6px 10px", fontSize: 12 }}
              >Delete</Button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
