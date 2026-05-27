/**
 * Modal surfaces for the order workspace: modifier picker, customer search,
 * table picker, manual-discount form and keyboard-shortcut help.
 *
 * They all share a simple <Modal/> wrapper that locks focus to the dialog,
 * dismisses on Esc, and renders centered on the brand background.
 */

import { useEffect, useMemo, useState } from "react";
import type {
  CustomerSummary, FloorTable, MenuItem, ModifierGroup,
  ModifierOption, DiscountsConfig,
} from "../../../../shared/ipc-contract";
import { Button, Input, Label, Spinner, colors } from "../../ui/components";
import {
  type CartModifier, fmtINR, modifierFromOption,
} from "./types";
import { CalculatorModal } from "./CalculatorModal";

// ─── Generic shell ─────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, width = 560 }: {
  title: string; onClose: () => void; children: React.ReactNode; width?: number;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.55)",
      display: "grid", placeItems: "center", padding: 24,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: width, maxHeight: "85vh",
          background: colors.panel, color: colors.textPrimary,
          border: `1px solid ${colors.border}`, borderRadius: 12,
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <header style={{
          padding: "14px 18px", borderBottom: `1px solid ${colors.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{
            background: "transparent", border: 0, color: colors.textDim,
            cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 4,
          }}>×</button>
        </header>
        <div style={{ padding: 18, overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Modifier picker ───────────────────────────────────────────────────────
/**
 * `initialModifierIds` lets the cart re-open the picker on an existing line
 * with its previous selections checked, so a cashier can tweak choices
 * instead of removing-and-re-adding. `confirmLabel` lets callers say
 * "Update" instead of the default "Add to cart".
 */
export function ModifierModal({
  item, onClose, onConfirm, initialModifierIds, confirmLabel,
  initialNotes, initialQuantity, notePresets,
}: {
  item: MenuItem;
  onClose: () => void;
  /** Second arg carries optional per-line note + quantity entered in the modal. */
  onConfirm: (mods: CartModifier[], details?: { notes?: string; quantity?: number }) => void;
  initialModifierIds?: number[];
  confirmLabel?: string;
  initialNotes?: string;
  initialQuantity?: number;
  /** Quick-tap note presets the cashier can append (e.g., "less spicy"). */
  notePresets?: string[];
}) {
  const [groups, setGroups] = useState<ModifierGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per group → set of selected modifier ids
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [qty, setQty] = useState(Math.max(1, initialQuantity ?? 1));
  const presets = notePresets ?? ["Less spicy", "Extra spicy", "No onion", "No garlic", "Make jain", "Pack separately"];

  useEffect(() => {
    let alive = true;
    window.khanalagao.menu.modifiers({ menuItemId: item.id })
      .then(g => {
        if (!alive) return;
        setGroups(g);
        // Seed selection from the cart line we're editing (if any).
        const preset = new Set(initialModifierIds ?? []);
        const seed: Record<number, Set<number>> = {};
        for (const grp of g) {
          const ids = new Set<number>();
          for (const opt of grp.modifiers ?? []) if (preset.has(opt.id)) ids.add(opt.id);
          if (ids.size > 0) seed[grp.id] = ids;
        }
        setSelected(seed);
      })
      .catch(e => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [item.id, initialModifierIds]);

  function toggle(group: ModifierGroup, opt: ModifierOption) {
    setSelected(prev => {
      const next = { ...prev };
      const set = new Set(next[group.id] ?? []);
      const max = group.maxSelections ?? 1;
      if (set.has(opt.id)) {
        set.delete(opt.id);
      } else {
        if (max === 1) set.clear();
        if (set.size >= max && max > 1) return prev;
        set.add(opt.id);
      }
      next[group.id] = set;
      return next;
    });
  }

  const allMods: CartModifier[] = useMemo(() => {
    const out: CartModifier[] = [];
    for (const g of groups ?? []) {
      const ids = selected[g.id] ?? new Set<number>();
      for (const o of g.modifiers ?? []) {
        if (ids.has(o.id)) out.push(modifierFromOption(o, g.id));
      }
    }
    return out;
  }, [groups, selected]);

  const requiredOk = (groups ?? []).every(g => {
    if (!g.isRequired) return true;
    const min = g.minSelections ?? 1;
    return (selected[g.id]?.size ?? 0) >= min;
  });

  return (
    <Modal title={`Customize · ${item.name}`} onClose={onClose}>
      {error && <div style={{ color: colors.danger, marginBottom: 12 }}>{error}</div>}
      {!groups && !error && <div style={{ display: "grid", placeItems: "center", padding: 24 }}><Spinner /></div>}
      {groups && groups.length === 0 && (
        <div style={{ color: colors.textDim, padding: 12 }}>No options configured — adding as-is.</div>
      )}
      {(groups ?? []).map(g => (
        <div key={g.id} style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {g.name}
              {g.isRequired && <span style={{ color: colors.danger, marginLeft: 6 }}>*</span>}
            </div>
            <span style={{ fontSize: 11, color: colors.textDim }}>
              {g.maxSelections === 1 ? "Pick one" : `Up to ${g.maxSelections ?? "any"}`}
            </span>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {(g.modifiers ?? []).map(o => {
              const isSel = (selected[g.id] ?? new Set()).has(o.id);
              return (
                <button
                  key={o.id}
                  onClick={() => toggle(g, o)}
                  disabled={o.isAvailable === false}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: isSel ? colors.brandSoft : colors.panelAlt,
                    color: o.isAvailable === false ? colors.textMuted : colors.textPrimary,
                    border: `1px solid ${isSel ? colors.brand : "transparent"}`,
                    borderRadius: 8, padding: "10px 12px",
                    cursor: o.isAvailable === false ? "not-allowed" : "pointer",
                    opacity: o.isAvailable === false ? 0.55 : 1,
                    fontSize: 13, fontWeight: 500,
                  }}
                >
                  <span>{o.name}{o.isAvailable === false ? " · 86'd" : ""}</span>
                  <span style={{ color: isSel ? "#fed7aa" : colors.textDim }}>
                    {Number(o.price) > 0 ? `+${fmtINR(Number(o.price))}` : "Free"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Per-line note + quantity */}
      <div style={{ marginTop: 6, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
        <Label>Note for kitchen (optional)</Label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. extra spicy, no onion"
        />
        {presets.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {presets.map(p => (
              <button
                key={p}
                onClick={() => setNotes(prev => prev ? `${prev}, ${p.toLowerCase()}` : p)}
                style={{
                  background: colors.panelAlt, color: colors.textPrimary, border: 0,
                  borderRadius: 999, padding: "4px 10px", fontSize: 11, cursor: "pointer",
                }}
              >+ {p}</button>
            ))}
          </div>
        )}
        <div style={{ height: 12 }} />
        <Label>Quantity</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setQty(q => Math.max(1, q - 1))}
            style={qtyBtnStyle}
          >−</button>
          <span style={{
            minWidth: 48, textAlign: "center", fontWeight: 800, fontSize: 18,
            fontVariantNumeric: "tabular-nums",
          }}>{qty}</span>
          <button
            onClick={() => setQty(q => Math.min(99, q + 1))}
            style={qtyBtnStyle}
          >+</button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <span style={{ fontSize: 13, color: colors.textDim }}>
          Line total · <b style={{ color: colors.brand }}>
            {fmtINR((Number(item.price) + allMods.reduce((s, m) => s + m.price, 0)) * qty)}
          </b>
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onConfirm(allMods, { notes: notes.trim() || undefined, quantity: qty })}
            disabled={!requiredOk}
          >{confirmLabel ?? "Add to cart"}</Button>
        </div>
      </div>
    </Modal>
  );
}

const qtyBtnStyle: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 8, border: 0, cursor: "pointer",
  background: colors.panelAlt, color: colors.textPrimary, fontSize: 20, fontWeight: 800,
};

// ─── Table picker ──────────────────────────────────────────────────────────
export function TablePickerModal({ tables, selectedId, onPick, onClose }: {
  tables: FloorTable[];
  selectedId: number | null;
  onPick: (t: FloorTable | null) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Select table" onClose={onClose} width={720}>
      <div style={{ marginBottom: 12 }}>
        <Button variant="ghost" onClick={() => { onPick(null); onClose(); }}>
          Clear / no table
        </Button>
      </div>
      {tables.length === 0 && (
        <div style={{ color: colors.textDim }}>No tables configured for this outlet.</div>
      )}
      <div style={{
        display: "grid", gap: 10,
        gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
      }}>
        {tables.map(t => {
          const isSel = t.id === selectedId;
          const occupied = t.status && t.status !== "available";
          return (
            <button
              key={t.id}
              onClick={() => { onPick(t); onClose(); }}
              style={{
                background: isSel ? colors.brand : occupied ? "rgba(220,38,38,0.10)" : colors.panelAlt,
                border: `1px solid ${isSel ? colors.brand : occupied ? "rgba(220,38,38,0.4)" : colors.border}`,
                color: colors.textPrimary, borderRadius: 10, padding: "14px 8px",
                cursor: "pointer", display: "flex", flexDirection: "column", gap: 4,
              }}
            >
              <span style={{ fontWeight: 800, fontSize: 18 }}>{t.tableNumber}</span>
              <span style={{ fontSize: 11, color: colors.textDim }}>
                {t.capacity} seats · {t.status}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

// ─── Customer search / create ──────────────────────────────────────────────
export function CustomerModal({ initialQuery, onPick, onClose }: {
  initialQuery: string;
  onPick: (c: CustomerSummary | null, fallback?: { name: string; phone: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [rows, setRows] = useState<CustomerSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    const term = q.trim();
    if (!term) { setRows(null); return; }
    let alive = true;
    const id = window.setTimeout(() => {
      window.khanalagao.customers.search({ search: term, limit: 15 })
        .then(r => { if (alive) setRows(r); })
        .catch(e => { if (alive) setError((e as Error).message); });
    }, 200);
    return () => { alive = false; window.clearTimeout(id); };
  }, [q]);

  async function create() {
    if (!newName.trim() && !newPhone.trim()) return;
    setBusy(true); setError(null);
    try {
      const c = await window.khanalagao.customers.create({
        name: newName.trim() || undefined,
        phone: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
      });
      onPick(c);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Customer" onClose={onClose}>
      {error && <div style={{ color: colors.danger, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {!createMode && (
        <>
          <Label>Search by name or phone</Label>
          <Input
            autoFocus
            placeholder="9876543210 or 'Priya'"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div style={{ maxHeight: 280, overflowY: "auto", marginTop: 10 }}>
            {rows === null && q && <div style={{ color: colors.textDim, padding: 12 }}>Searching…</div>}
            {rows && rows.length === 0 && (
              <div style={{ color: colors.textDim, padding: 12 }}>
                No matches. <button onClick={() => {
                  setCreateMode(true);
                  // Pre-fill the create form from the query
                  if (/^\+?\d[\d\s-]*$/.test(q)) setNewPhone(q.trim()); else setNewName(q.trim());
                }} style={linkBtnStyle}>+ Create new customer</button>
              </div>
            )}
            {(rows ?? []).map(c => (
              <button
                key={c.id}
                onClick={() => { onPick(c); onClose(); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  background: colors.panelAlt, border: 0, color: colors.textPrimary,
                  padding: "10px 12px", borderRadius: 8, marginBottom: 4, cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name || "(no name)"}</div>
                <div style={{ fontSize: 12, color: colors.textDim }}>{c.phone ?? "—"}</div>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}>
            <Button variant="ghost" onClick={() => onPick(null)}>Walk-in (no customer)</Button>
            <Button onClick={() => setCreateMode(true)}>+ New customer</Button>
          </div>
        </>
      )}

      {createMode && (
        <>
          <Label>Name</Label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Guest name" />
          <div style={{ height: 10 }} />
          <Label>Phone</Label>
          <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="9876543210" />
          <div style={{ height: 10 }} />
          <Label>Email (optional)</Label>
          <Input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="guest@example.com"
          />
          <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}>
            <Button variant="ghost" onClick={() => setCreateMode(false)}>← Back to search</Button>
            <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

const linkBtnStyle: React.CSSProperties = {
  background: "transparent", border: 0, color: colors.brand,
  cursor: "pointer", padding: 0, marginLeft: 4, fontSize: 13,
  textDecoration: "underline",
};

// ─── Discount form ─────────────────────────────────────────────────────────
/**
 * Apply a discount to the whole order (`orderItemId` omitted) or to a single
 * line (`orderItemId` provided → type is forced to "item" and value is a flat
 * rupee amount, mirroring the web POS contract enforced in
 * artifacts/api-server/src/routes/orders.ts line 1655).
 */
export function DiscountModal({ orderId, orderItemId, lineLabel, config, onApplied, onClose }: {
  orderId: number;
  orderItemId?: number;
  lineLabel?: string;
  config: DiscountsConfig | null;
  onApplied: () => void;
  onClose: () => void;
}) {
  const isLine = orderItemId != null;
  const [type, setType] = useState<"percentage" | "flat">(isLine ? "flat" : "percentage");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalc, setShowCalc] = useState(false);

  const presets = config?.presetReasons ?? [];

  async function submit() {
    setBusy(true); setError(null);
    try {
      await window.khanalagao.discounts.apply({
        orderId,
        type: isLine ? "item" : type,
        value: Number(value) || 0,
        reason: reason.trim(),
        orderItemId: isLine ? orderItemId : undefined,
        managerPin: pin || undefined,
        managerOtp: otp || undefined,
      });
      onApplied();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={isLine ? `Discount line · ${lineLabel ?? ""}` : "Apply discount"} onClose={onClose}>
      {error && <div style={{ color: colors.danger, marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {!isLine && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setType("percentage")} style={typeBtn(type === "percentage")}>%</button>
          <button onClick={() => setType("flat")} style={typeBtn(type === "flat")}>₹ Flat</button>
        </div>
      )}
      <Label>{isLine ? "Discount amount (₹, capped at line total)" : "Value"}</Label>
      <div style={{ display: "flex", gap: 6 }}>
        <Input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isLine || type === "flat" ? "50" : "10"}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={() => setShowCalc(true)}
          title="Open calculator"
          style={{
            background: colors.panelAlt, color: colors.textPrimary, border: 0,
            borderRadius: 6, padding: "0 14px", fontSize: 16, cursor: "pointer",
          }}
        >🧮</button>
      </div>
      <div style={{ height: 10 }} />
      <Label>Reason</Label>
      {presets.length > 0 ? (
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 8,
            background: colors.bg, color: colors.textPrimary,
            border: `1px solid ${colors.borderStrong}`, fontSize: 14,
          }}
        >
          <option value="">Select a reason…</option>
          {presets.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      ) : (
        <div style={{ color: colors.textDim, fontSize: 12 }}>
          No discount reasons configured. Ask the owner to add presets in Settings → Discounts.
        </div>
      )}
      {config?.hasManagerPin && (
        <>
          <div style={{ height: 10 }} />
          <Label>Manager PIN (if required)</Label>
          <Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
        </>
      )}
      {config?.otpEnabled && (
        <>
          <div style={{ height: 10 }} />
          <Label>Manager OTP (if required)</Label>
          <Input
            inputMode="numeric"
            pattern="[0-9]*"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="6-digit code"
            autoComplete="one-time-code"
          />
        </>
      )}
      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy || !value || !reason}>Apply</Button>
      </div>
      {showCalc && (
        <CalculatorModal
          onClose={() => setShowCalc(false)}
          onSendToCash={(v) => setValue(v.toFixed(2))}
        />
      )}
    </Modal>
  );
}

function typeBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "10px", borderRadius: 8, border: 0, cursor: "pointer",
    background: active ? colors.brand : colors.panelAlt,
    color: active ? "#fff" : colors.textPrimary, fontWeight: 700,
  };
}

// ─── Keyboard help ─────────────────────────────────────────────────────────
export function HelpModal({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ["F2", "Focus menu search"],
    ["F3", "Pick / change customer"],
    ["F4", "Hold current bill"],
    ["F5", "Recall held bills"],
    ["F6", "Send order / KOT"],
    ["F7", "Print bill"],
    ["F8", "Open payment dialog"],
    ["F9", "Open cash drawer"],
    ["F10", "Close shift"],
    ["Ctrl+P", "Print bill"],
    ["Ctrl+Enter", "Open payment"],
    ["Ctrl+N", "Start a new order"],
    ["Ctrl+L", "Open calculator"],
    ["Ctrl+K", "Open calculator"],
    ["Del", "Remove selected cart line"],
    ["+ / −", "Adjust quantity of selected line"],
    ["/", "Focus menu search"],
    ["Esc", "Close any modal"],
    ["?", "Show this help"],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={420}>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
            <kbd style={{
              background: colors.panelAlt, padding: "3px 8px", borderRadius: 4,
              border: `1px solid ${colors.borderStrong}`, fontFamily: "monospace",
              fontSize: 12, color: colors.textPrimary,
            }}>{k}</kbd>
            <span style={{ color: colors.textDim, fontSize: 13 }}>{v}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
