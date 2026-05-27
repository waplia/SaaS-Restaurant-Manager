/**
 * Customers screen — search, create, and quick actions (call / WhatsApp /
 * open in orders). Loyalty points & wallet balance are surfaced from the
 * CustomerSummary when present so the cashier can see if a guest has
 * redeemable value, even though redemption itself happens in payment.
 */
import { useCallback, useEffect, useState } from "react";
import type { CustomerSummary, OrderHeader } from "../../../shared/ipc-contract";
import { shortOrderNumber } from "../../../shared/orderNumber";
import { Banner, Button, Input, Label, Spinner, colors } from "../ui/components";
import { fmtINR } from "./order/types";

/** Local notes & favourite-customer flags keyed by customer id. */
interface LocalCustomerMeta { notes?: string; favorite?: boolean; }
const LCM_KEY = "kp:customerMeta";
function readMeta(): Record<string, LocalCustomerMeta> {
  try { return JSON.parse(localStorage.getItem(LCM_KEY) ?? "{}"); } catch { return {}; }
}
function writeMeta(m: Record<string, LocalCustomerMeta>) {
  try { localStorage.setItem(LCM_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

/** Optional fields some backends include but the contract doesn't promise. */
type CustomerExt = CustomerSummary & {
  walletBalance?: string | number | null;
  totalOrders?: number | null;
  lastOrderAt?: string | null;
};

interface Props {
  onUseInOrder: (c: CustomerSummary) => void;
}

export function CustomersScreen({ onUseInOrder }: Props) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CustomerSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<CustomerSummary | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const search = useCallback(async (term: string) => {
    if (!term.trim()) { setRows(null); return; }
    setBusy(true); setErr(null);
    try {
      const r = await window.khanalagao.customers.search({ search: term.trim(), limit: 30 });
      setRows(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => { void search(q); }, 220);
    return () => window.clearTimeout(id);
  }, [q, search]);

  async function create() {
    if (!newName.trim() && !newPhone.trim()) return;
    setBusy(true); setErr(null);
    try {
      const c = await window.khanalagao.customers.create({
        name: newName.trim() || undefined,
        phone: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
      });
      setSelected(c);
      setCreateOpen(false);
      setQ(c.phone || c.name || "");
      setInfo(`Created ${c.name || c.phone || "customer"}.`);
      window.setTimeout(() => setInfo(null), 3000);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  function whatsApp(phone: string) {
    const digits = phone.replace(/\D+/g, "");
    if (!digits) return;
    const full = digits.length === 10 ? `91${digits}` : digits;
    window.khanalagao.app.openExternal(`https://wa.me/${full}`).catch(() => undefined);
  }
  function call(phone: string) {
    if (!phone) return;
    window.khanalagao.app.openExternal(`tel:${phone.replace(/[^\d+]/g, "")}`).catch(() => undefined);
  }
  function sms(phone: string) {
    if (!phone) return;
    window.khanalagao.app.openExternal(`sms:${phone.replace(/[^\d+]/g, "")}`).catch(() => undefined);
  }
  function email(addr: string) {
    if (!addr) return;
    window.khanalagao.app.openExternal(`mailto:${addr}`).catch(() => undefined);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", height: "100%", minHeight: 0 }}>
      {/* List */}
      <section style={{ overflow: "auto", padding: 20, borderRight: `1px solid ${colors.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Customers</h2>
          <Button onClick={() => setCreateOpen(true)}>+ New customer</Button>
        </div>
        <Input
          autoFocus
          placeholder="Search by name or phone… (start typing)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {info && <div style={{ marginTop: 12 }}><Banner kind="info">{info}</Banner></div>}
        {err && <div style={{ marginTop: 12 }}><Banner kind="error">{err}</Banner></div>}

        <div style={{ marginTop: 16 }}>
          {busy && <Spinner />}
          {!busy && rows === null && (
            <div style={{ color: colors.textMuted, padding: 30, textAlign: "center" }}>
              Type a name or phone number to start searching.
            </div>
          )}
          {!busy && rows && rows.length === 0 && (
            <div style={{ color: colors.textDim, padding: 30, textAlign: "center" }}>
              No matches for "{q}".
              <div style={{ marginTop: 10 }}>
                <Button variant="ghost" onClick={() => {
                  setCreateOpen(true);
                  if (/^\+?\d[\d\s-]*$/.test(q)) setNewPhone(q.trim()); else setNewName(q.trim());
                }}>+ Create "{q}"</Button>
              </div>
            </div>
          )}
          {rows && rows.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
              {(rows as CustomerExt[]).map(c => {
                const isSel = selected?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    style={{
                      textAlign: "left", padding: 10, borderRadius: 8,
                      background: isSel ? colors.brandSoft : colors.panelAlt,
                      color: colors.textPrimary,
                      border: `1px solid ${isSel ? colors.brand : "transparent"}`,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name || "(no name)"}</span>
                      <span style={{ fontSize: 12, color: colors.textDim }}>{c.phone ?? "—"}</span>
                    </div>
                    {(c.loyaltyPoints != null || c.walletBalance != null) && (
                      <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4 }}>
                        {c.loyaltyPoints != null && <span>★ {c.loyaltyPoints} pts</span>}
                        {c.loyaltyPoints != null && c.walletBalance != null && " · "}
                        {c.walletBalance != null && <span>👛 {fmtINR(Number(c.walletBalance))}</span>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Detail */}
      <aside style={{ overflow: "auto", padding: 20, background: colors.panel }}>
        {!selected && !createOpen && (
          <div style={{ color: colors.textMuted, padding: 30, textAlign: "center", fontSize: 13 }}>
            Select a customer to see details & quick actions.
          </div>
        )}

        {createOpen && (
          <>
            <h3 style={{ marginTop: 0 }}>New customer</h3>
            <Label>Name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Guest name" />
            <div style={{ height: 10 }} />
            <Label>Phone</Label>
            <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="9876543210" />
            <div style={{ height: 10 }} />
            <Label>Email (optional)</Label>
            <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="guest@example.com" />
            <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Save"}</Button>
            </div>
          </>
        )}

        {selected && !createOpen && (() => {
          const sel = selected as CustomerExt;
          const visits = sel.totalOrders ?? sel.visits ?? null;
          return (
          <>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{sel.name || "(no name)"}</div>
            <div style={{ color: colors.textDim, fontSize: 13, marginTop: 4 }}>
              {sel.phone || "no phone"}{sel.email ? ` · ${sel.email}` : ""}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
              <Stat label="Loyalty" value={sel.loyaltyPoints != null ? `${sel.loyaltyPoints} pts` : "—"} />
              <Stat label="Wallet" value={sel.walletBalance != null ? fmtINR(Number(sel.walletBalance)) : "—"} />
              <Stat label="Visits" value={visits != null ? String(visits) : "—"} />
              <Stat label="Lifetime" value={sel.totalSpent != null ? fmtINR(Number(sel.totalSpent)) : "—"} />
            </div>

            {sel.lastOrderAt && (
              <div style={{ marginTop: 10, fontSize: 12, color: colors.textDim }}>
                Last order: {new Date(sel.lastOrderAt).toLocaleString()}
              </div>
            )}

            <div style={{ marginTop: 16, display: "grid", gap: 6 }}>
              <Button onClick={() => onUseInOrder(sel)}>Use in current order</Button>
              {sel.phone && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  <Button variant="ghost" onClick={() => call(sel.phone!)}>📞 Call</Button>
                  <Button variant="ghost" onClick={() => whatsApp(sel.phone!)}>💬 WA</Button>
                  <Button variant="ghost" onClick={() => sms(sel.phone!)}>✉ SMS</Button>
                </div>
              )}
              {sel.email && (
                <Button variant="ghost" onClick={() => email(sel.email!)}>📧 Email {sel.email}</Button>
              )}
            </div>

            <CustomerNotes customer={sel} />
            <CustomerHistory customer={sel} />
          </>
          );
        })()}
      </aside>
    </div>
  );
}

/**
 * Per-customer notes + favourite flag, stored locally on this terminal.
 * The shared backend customer record is left untouched.
 */
function CustomerNotes({ customer }: { customer: CustomerSummary }) {
  const [meta, setMeta] = useState<LocalCustomerMeta>(() => readMeta()[String(customer.id)] ?? {});
  const [draft, setDraft] = useState(meta.notes ?? "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const m = readMeta()[String(customer.id)] ?? {};
    setMeta(m); setDraft(m.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.id]);

  function save() {
    const all = readMeta();
    const next: LocalCustomerMeta = { ...meta, notes: draft.trim() || undefined };
    all[String(customer.id)] = next; writeMeta(all);
    setMeta(next); setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }
  function toggleFav() {
    const all = readMeta();
    const next: LocalCustomerMeta = { ...meta, favorite: !meta.favorite };
    all[String(customer.id)] = next; writeMeta(all); setMeta(next);
  }

  return (
    <div style={{ marginTop: 16, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <Label>Notes (this terminal)</Label>
        <button onClick={toggleFav} title="Mark as favourite" style={{
          background: "transparent", border: 0, cursor: "pointer", fontSize: 18,
          color: meta.favorite ? "#fbbf24" : colors.textMuted,
        }}>{meta.favorite ? "★" : "☆"}</button>
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={3}
        placeholder="Allergies, preferences, table preference…"
        style={{
          width: "100%", background: colors.panelAlt, color: colors.textPrimary,
          border: `1px solid ${colors.borderStrong}`, borderRadius: 6,
          padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical",
        }}
      />
      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: saved ? colors.success : colors.textMuted }}>
          {saved ? "Saved" : "Stored locally — not synced to server"}
        </span>
        <Button variant="ghost" onClick={save} disabled={draft === (meta.notes ?? "")}>Save</Button>
      </div>
    </div>
  );
}

/**
 * Recent order history for the selected customer. The terminal backend
 * doesn't accept a customerId filter on orders:list, so we pull a
 * window of orders and filter client-side.
 */
function CustomerHistory({ customer }: { customer: CustomerSummary }) {
  const [orders, setOrders] = useState<OrderHeader[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setOrders(null); setErr(null);
    window.khanalagao.orders.list({ limit: 200 })
      .then(all => {
        if (!alive) return;
        const phone = customer.phone?.replace(/\D+/g, "") ?? "";
        const mine = all.filter(o =>
          o.customerId === customer.id ||
          (phone && o.customerPhone?.replace(/\D+/g, "") === phone)
        ).slice(0, 20);
        setOrders(mine);
      })
      .catch(e => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [customer.id, customer.phone]);

  return (
    <div style={{ marginTop: 16 }}>
      <Label>Recent orders</Label>
      {err && <Banner kind="error">{err}</Banner>}
      {!err && orders === null && <Spinner size={16} />}
      {orders && orders.length === 0 && (
        <div style={{ fontSize: 12, color: colors.textMuted, padding: "6px 0" }}>
          No recent orders found for this customer on this terminal.
        </div>
      )}
      {orders && orders.length > 0 && (
        <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
          {orders.map(o => (
            <div key={o.id} style={{
              display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8,
              fontSize: 12, padding: "6px 8px", background: colors.bg,
              borderRadius: 6, border: `1px solid ${colors.border}`,
              alignItems: "center",
            }}>
              <div>
                <div style={{ fontWeight: 600 }}>#{shortOrderNumber(o)}</div>
                <div style={{ fontSize: 10, color: colors.textDim }}>
                  {new Date(o.createdAt).toLocaleString()} · {o.status}
                </div>
              </div>
              <span style={{ fontSize: 10, color: colors.textDim, textTransform: "uppercase" }}>{o.paymentStatus}</span>
              <b style={{ fontVariantNumeric: "tabular-nums", color: colors.brand }}>
                {fmtINR(Number(o.totalAmount))}
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: colors.bg, padding: "10px 12px", borderRadius: 8,
      border: `1px solid ${colors.border}`,
    }}>
      <div style={{ fontSize: 10, color: colors.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: colors.textPrimary, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
