/**
 * Calculator overlay — F8 from the POS workspace.
 *
 * Tap-friendly POS calculator with memory and recent history. The "Use as
 * cash tendered" callback lets the parent forward the rounded result into
 * the payment modal without the cashier retyping it.
 */
import { useEffect } from "react";
import { Button, colors } from "../../ui/components";
import { useCalculator } from "../../hooks/useCalculator";
import { Modal } from "./Modals";
import { fmtINR } from "./types";

interface Props {
  onClose: () => void;
  /** Sends the computed amount back to the caller (e.g. payment modal's cash
   *  tendered field) and closes the calculator. When provided the quick-mode
   *  row is shown so the cashier can derive change, splits, and discounts
   *  off the amount due without retyping. */
  onSendToCash?: (value: number) => void;
  /** Amount due — when set, quick-mode buttons can compute change /
   *  split ways / discount %. */
  target?: number;
}

const KEYPAD: Array<Array<{ label: string; type: "n" | "op" | "fn"; value: string }>> = [
  [
    { label: "C",  type: "fn", value: "C" },
    { label: "⌫",  type: "fn", value: "BS" },
    { label: "(",  type: "n",  value: "(" },
    { label: ")",  type: "n",  value: ")" },
  ],
  [
    { label: "7", type: "n", value: "7" }, { label: "8", type: "n", value: "8" },
    { label: "9", type: "n", value: "9" }, { label: "÷", type: "op", value: "/" },
  ],
  [
    { label: "4", type: "n", value: "4" }, { label: "5", type: "n", value: "5" },
    { label: "6", type: "n", value: "6" }, { label: "×", type: "op", value: "*" },
  ],
  [
    { label: "1", type: "n", value: "1" }, { label: "2", type: "n", value: "2" },
    { label: "3", type: "n", value: "3" }, { label: "−", type: "op", value: "-" },
  ],
  [
    { label: "0", type: "n", value: "0" }, { label: ".", type: "n", value: "." },
    { label: "%", type: "op", value: "%" }, { label: "+", type: "op", value: "+" },
  ],
];

export function CalculatorModal({ onClose, onSendToCash, target }: Props) {
  const calc = useCalculator();
  const fmtNum = (n: number) => Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : "0";
  function setExpr(value: number) {
    calc.clear();
    calc.append(fmtNum(value));
  }

  // Local key bindings — only active while the modal is mounted.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && ["INPUT", "TEXTAREA", "SELECT"].includes(tgt.tagName)) return;
      if (e.key >= "0" && e.key <= "9") { calc.append(e.key); e.preventDefault(); return; }
      if ("+-*/().".includes(e.key)) { calc.append(e.key); e.preventDefault(); return; }
      if (e.key === "%") { calc.append("%"); e.preventDefault(); return; }
      if (e.key === "Enter" || e.key === "=") { calc.equals(); e.preventDefault(); return; }
      if (e.key === "Backspace") { calc.backspace(); e.preventDefault(); return; }
      if (e.key === "Escape") { /* Modal handles */ return; }
      if (e.key === "c" || e.key === "C") { calc.clear(); e.preventDefault(); return; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calc]);

  function press(label: string, type: "n" | "op" | "fn", value: string) {
    void label;
    if (type === "fn") {
      if (value === "C") calc.clear();
      else if (value === "BS") calc.backspace();
      return;
    }
    calc.append(value);
  }

  return (
    <Modal title="Calculator" onClose={onClose} width={380}>
      <div style={{
        background: colors.bg, padding: 12, borderRadius: 8,
        marginBottom: 10, minHeight: 64, display: "flex",
        flexDirection: "column", justifyContent: "flex-end",
      }}>
        <div style={{
          fontSize: 13, color: colors.textDim, fontFamily: "monospace",
          minHeight: 18, wordBreak: "break-all",
        }}>{calc.expr || "0"}</div>
        {calc.error && (
          <div style={{ fontSize: 12, color: colors.danger, marginTop: 4 }}>{calc.error}</div>
        )}
      </div>

      <div style={{
        display: "flex", gap: 6, marginBottom: 8, fontSize: 11, color: colors.textDim,
      }}>
        <button onClick={calc.memoryClear} style={memBtn}>MC</button>
        <button onClick={calc.memoryRecall} style={memBtn}>MR · {fmtINR(calc.memory)}</button>
        <button onClick={calc.memorySub} style={memBtn}>M−</button>
        <button onClick={calc.memoryAdd} style={memBtn}>M+</button>
      </div>

      {target != null && target > 0 && (
        <div style={{
          background: colors.bg, borderRadius: 8, padding: "8px 10px",
          marginBottom: 8, border: `1px dashed ${colors.border}`,
        }}>
          <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 6 }}>
            Quick modes · amount due <b style={{ color: colors.brand }}>{fmtINR(target)}</b>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            <button style={quickBtn} onClick={() => setExpr(target)}>= due</button>
            {[500, 1000, 2000].map(n => (
              <button key={n} style={quickBtn} onClick={() => setExpr(Math.max(n, Math.ceil(target / n) * n))}>
                ₹{n}
              </button>
            ))}
            <button
              style={quickBtn}
              title="Change from current expression as tender"
              onClick={() => {
                const tender = calc.equals() ?? (Number(calc.expr) || 0);
                if (tender > 0) setExpr(Math.max(0, tender - target));
              }}
            >Change</button>
            {[2, 3, 4].map(n => (
              <button key={`s${n}`} style={quickBtn} onClick={() => setExpr(target / n)}>
                ÷{n} split
              </button>
            ))}
            {[5, 10, 15, 20].map(p => (
              <button key={`d${p}`} style={quickBtn} onClick={() => setExpr(target * (1 - p / 100))}>
                −{p}%
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {KEYPAD.flat().map((k, i) => (
          <button
            key={i}
            onClick={() => press(k.label, k.type, k.value)}
            style={{
              padding: "14px 0", borderRadius: 6, fontSize: 16, fontWeight: 600,
              cursor: "pointer", border: 0,
              background: k.type === "op" ? colors.brandSoft
                : k.type === "fn" ? colors.panel : colors.panelAlt,
              color: k.type === "op" ? "#fff" : colors.textPrimary,
            }}
          >{k.label}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <Button variant="ghost" style={{ flex: 1 }} onClick={() => { calc.equals(); }}>
          =
        </Button>
        {onSendToCash && (
          <Button style={{ flex: 2 }} onClick={() => {
            const v = calc.equals() ?? (Number(calc.expr) || 0);
            if (v > 0) { onSendToCash(v); onClose(); }
          }}>
            Use as cash tendered
          </Button>
        )}
      </div>

      {calc.history.length > 0 && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${colors.border}`, paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 4 }}>Recent</div>
          <div style={{ display: "grid", gap: 2, maxHeight: 100, overflowY: "auto" }}>
            {calc.history.slice(0, 5).map((h, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", fontSize: 12,
                color: colors.textDim, fontFamily: "monospace",
              }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{h.expr}</span>
                <span style={{ color: colors.textPrimary, fontWeight: 600 }}>= {h.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

const memBtn: React.CSSProperties = {
  flex: 1, padding: "6px 4px", borderRadius: 4, fontSize: 11,
  background: colors.panelAlt, color: colors.textDim, border: 0,
  cursor: "pointer", fontWeight: 600,
};

const quickBtn: React.CSSProperties = {
  background: colors.panelAlt, color: colors.textPrimary, border: 0,
  borderRadius: 999, padding: "4px 10px", fontSize: 11,
  cursor: "pointer", fontWeight: 600,
};
