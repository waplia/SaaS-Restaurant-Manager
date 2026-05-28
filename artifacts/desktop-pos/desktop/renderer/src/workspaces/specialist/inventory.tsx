/**
 * Inventory workspace screens.
 *
 * Each export below is a self-contained module screen wired straight to
 * the inventory IPC namespace. Quick actions (receive, adjust, waste,
 * raise PO) are drawer-based so they don't take the user out of the
 * list they were looking at.
 */
import { useMemo, useState } from "react";
import {
  PageShell, Empty, ErrorBox, Skeleton, useAsync, Drawer, Field, Stat, StatRow,
  DataTable, Button, Input, colors, fmtMoney, fmtDate, fmtDateShort, StatusPill,
  PendingBackend,
} from "./shared";

// ─── Types (narrowed from the loose IPC `unknown` responses) ──────────────
interface InventoryItem {
  id: number; name: string; unit: string; category?: string | null;
  currentStock: string | number; minStockLevel: string | number;
  costPerUnit?: string | number | null; supplierId?: number | null;
  parLevel?: string | number | null; isLowStock?: boolean;
}
interface Supplier { id: number; name: string; phone?: string | null; email?: string | null; address?: string | null; }
interface PurchaseOrder {
  id: number; supplierId: number | null; status: string;
  totalAmount?: string | number | null; expectedDate?: string | null;
  createdAt?: string;
}
interface WasteEntry {
  id: number; itemId: number; itemName: string; unit: string;
  quantity: string | number; notes?: string | null; createdAt?: string;
  type?: string;
}
interface MenuItemRow { id: number; name: string; price?: string | number; isAvailable?: boolean; }

const num = (v: unknown) => Number(v ?? 0) || 0;

// ─── Raw materials / stock levels ─────────────────────────────────────────
export function RawMaterialsScreen() {
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const { data, loading, error, reload } = useAsync<InventoryItem[]>(
    () => window.khanalagao.inv.list({ search: search || undefined, lowStock: lowOnly }) as Promise<InventoryItem[]>,
    [search, lowOnly],
  );
  const [adjust, setAdjust] = useState<InventoryItem | null>(null);
  const lowCount = useMemo(() => (data ?? []).filter((i) => i.isLowStock).length, [data]);

  return (
    <PageShell
      title="Raw materials"
      actions={
        <>
          <Button variant="ghost" onClick={() => setLowOnly((v) => !v)}>
            {lowOnly ? "Show all" : "Low stock only"}
          </Button>
          <Button onClick={() => reload()}>Refresh</Button>
        </>
      }
      attention={lowCount > 0 && !lowOnly ? (
        <span>
          {lowCount} item{lowCount === 1 ? "" : "s"} below par.&nbsp;
          <a onClick={() => setLowOnly(true)} style={{ color: "#fde68a", cursor: "pointer", textDecoration: "underline" }}>Review low stock →</a>
        </span>
      ) : null}
    >
      <div style={{ marginBottom: 14 }}>
        <Input
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<InventoryItem>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="No inventory yet" hint="Add a raw material from the admin web app to see it here." />}
          columns={[
            { key: "name", header: "Item", render: (r) => (
              <div>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                {r.category && <div style={{ fontSize: 11, color: colors.textDim }}>{r.category}</div>}
              </div>
            ) },
            { key: "stock", header: "On hand", align: "right", render: (r) => (
              <span style={{ color: r.isLowStock ? "#fca5a5" : colors.textPrimary, fontWeight: 600 }}>
                {num(r.currentStock).toFixed(2)} {r.unit}
              </span>
            ) },
            { key: "par", header: "Min / Par", align: "right", render: (r) => (
              <span style={{ color: colors.textDim }}>
                {num(r.minStockLevel).toFixed(0)} / {r.parLevel ? num(r.parLevel).toFixed(0) : "—"}
              </span>
            ) },
            { key: "cost", header: "Cost", align: "right", render: (r) => fmtMoney(r.costPerUnit) },
            { key: "status", header: "Status", render: (r) => r.isLowStock
              ? <StatusPill status="Low" tone="bad" /> : <StatusPill status="OK" tone="ok" /> },
            { key: "act", header: "", align: "right", render: (r) => (
              <Button variant="ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setAdjust(r)}>Adjust</Button>
            ) },
          ]}
        />
      )}
      <AdjustDrawer item={adjust} onClose={() => setAdjust(null)} onSaved={reload} />
    </PageShell>
  );
}

function AdjustDrawer({ item, onClose, onSaved }: {
  item: InventoryItem | null; onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<"add" | "remove" | "use" | "waste" | "set">("add");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!item) return;
    const q = Number(quantity);
    if (!Number.isFinite(q) || q <= 0) { setErr("Quantity must be a positive number."); return; }
    setBusy(true); setErr(null);
    try {
      await window.khanalagao.inv.adjust({ id: item.id, type, quantity: q, notes: notes || undefined });
      setQuantity(""); setNotes(""); onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Drawer
      open={!!item}
      title={item ? `Adjust ${item.name}` : ""}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save adjustment"}</Button>
        </>
      }
    >
      {item && (
        <>
          <div style={{ marginBottom: 14, fontSize: 12, color: colors.textDim }}>
            Current on hand: <b style={{ color: colors.textPrimary }}>{num(item.currentStock).toFixed(2)} {item.unit}</b>
          </div>
          <Field label="Adjustment type">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["add", "remove", "use", "waste", "set"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  style={{
                    padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${type === t ? colors.brand : colors.borderStrong}`,
                    background: type === t ? colors.brandSoft : colors.bg,
                    color: colors.textPrimary, cursor: "pointer", textTransform: "capitalize",
                  }}
                >{t}</button>
              ))}
            </div>
          </Field>
          <Field label={`Quantity (${item.unit})`}>
            <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason or batch reference" />
          </Field>
          {err && <ErrorBox message={err} />}
        </>
      )}
    </Drawer>
  );
}

// ─── Menu item stock ──────────────────────────────────────────────────────
export function MenuItemStockScreen() {
  const { data, loading, error, reload } = useAsync<MenuItemRow[]>(
    () => window.khanalagao.inv.menuItemsStock() as Promise<MenuItemRow[]>, [],
  );
  return (
    <PageShell title="Menu item stock" actions={<Button onClick={reload}>Refresh</Button>}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<MenuItemRow>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="No menu items" hint="Add menu items from the admin web app to see availability and recipe cost here." />}
          columns={[
            { key: "name", header: "Menu item" },
            { key: "price", header: "Price", align: "right", render: (r) => fmtMoney(r.price) },
            { key: "available", header: "Availability",
              render: (r) => r.isAvailable === false
                ? <StatusPill status="Off" tone="bad" />
                : <StatusPill status="Available" tone="ok" /> },
          ]}
        />
      )}
      <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: colors.panel, border: `1px solid ${colors.border}`, color: colors.textDim, fontSize: 12 }}>
        Recipe-driven stock projections rely on the per-item recipe mapping
        endpoint. Until that ships, this screen shows current availability
        flags only.
      </div>
    </PageShell>
  );
}

// ─── Low stock ────────────────────────────────────────────────────────────
export function LowStockScreen() {
  const { data, loading, error, reload } = useAsync<InventoryItem[]>(
    () => window.khanalagao.inv.list({ lowStock: true }) as Promise<InventoryItem[]>, [],
  );
  return (
    <PageShell title="Low stock" actions={<Button onClick={reload}>Refresh</Button>}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<InventoryItem>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="All stock is healthy" hint="No items are below their minimum threshold." icon="✓" />}
          columns={[
            { key: "name", header: "Item", render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
            { key: "stock", header: "On hand", align: "right", render: (r) => `${num(r.currentStock).toFixed(2)} ${r.unit}` },
            { key: "min", header: "Min", align: "right", render: (r) => num(r.minStockLevel).toFixed(2) },
            { key: "needed", header: "Top-up to par", align: "right", render: (r) =>
              r.parLevel != null ? `${Math.max(0, num(r.parLevel) - num(r.currentStock)).toFixed(2)} ${r.unit}` : "—" },
          ]}
        />
      )}
    </PageShell>
  );
}

// ─── Suppliers ────────────────────────────────────────────────────────────
export function SuppliersScreen() {
  const { data, loading, error, reload } = useAsync<Supplier[]>(
    () => window.khanalagao.inv.suppliers() as Promise<Supplier[]>, [],
  );
  const [open, setOpen] = useState(false);
  return (
    <PageShell title="Suppliers" actions={
      <>
        <Button variant="ghost" onClick={reload}>Refresh</Button>
        <Button onClick={() => setOpen(true)}>+ New supplier</Button>
      </>
    }>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<Supplier>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="No suppliers yet" hint="Add the supplier you raise purchase orders to." />}
          columns={[
            { key: "name", header: "Supplier", render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
            { key: "phone", header: "Phone", render: (r) => r.phone ?? "—" },
            { key: "email", header: "Email", render: (r) => r.email ?? "—" },
            { key: "address", header: "Address", render: (r) => r.address ?? "—" },
          ]}
        />
      )}
      <SupplierDrawer open={open} onClose={() => setOpen(false)} onSaved={reload} />
    </PageShell>
  );
}

function SupplierDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(""); const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    setBusy(true); setErr(null);
    try {
      await window.khanalagao.inv.supplierCreate({ name: name.trim(), phone: phone || undefined, email: email || undefined, address: address || undefined });
      setName(""); setPhone(""); setEmail(""); setAddress(""); onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Drawer
      open={open} title="New supplier" onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Create supplier"}</Button>
        </>
      }
    >
      <Field label="Name *"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      {err && <ErrorBox message={err} />}
    </Drawer>
  );
}

// ─── Purchase orders ──────────────────────────────────────────────────────
export function PurchaseOrdersScreen() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { data, loading, error, reload } = useAsync<PurchaseOrder[]>(
    () => window.khanalagao.inv.purchaseOrders({ status: statusFilter || undefined }) as Promise<PurchaseOrder[]>,
    [statusFilter],
  );
  const [creating, setCreating] = useState(false);

  return (
    <PageShell title="Purchase orders" actions={
      <>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            background: colors.bg, color: colors.textPrimary, padding: "8px 12px",
            border: `1px solid ${colors.borderStrong}`, borderRadius: 8, fontSize: 13,
          }}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="ordered">Ordered</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Button onClick={() => setCreating(true)}>+ Raise PO</Button>
      </>
    }>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<PurchaseOrder>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="No purchase orders" hint="Raise a PO to restock from a supplier." />}
          columns={[
            { key: "id", header: "PO #", render: (r) => `#${r.id}` },
            { key: "supplier", header: "Supplier", render: (r) => r.supplierId ?? "—" },
            { key: "status", header: "Status", render: (r) => {
              const tone = r.status === "received" ? "ok" : r.status === "cancelled" ? "bad"
                : r.status === "ordered" ? "info" : "warn";
              return <StatusPill status={r.status} tone={tone} />;
            } },
            { key: "expected", header: "Expected", render: (r) => fmtDateShort(r.expectedDate) },
            { key: "total", header: "Total", align: "right", render: (r) => fmtMoney(r.totalAmount) },
            { key: "act", header: "", align: "right", render: (r) =>
              r.status !== "received" && r.status !== "cancelled" ? (
                <Button variant="ghost" style={{ padding: "5px 10px", fontSize: 12 }}
                  onClick={async () => {
                    try { await window.khanalagao.inv.purchaseOrderReceive({ id: r.id }); reload(); }
                    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
                  }}>Mark received</Button>
              ) : null },
          ]}
        />
      )}
      <PurchaseOrderDrawer open={creating} onClose={() => setCreating(false)} onSaved={reload} />
    </PageShell>
  );
}

function PurchaseOrderDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const suppliers = useAsync<Supplier[]>(() => window.khanalagao.inv.suppliers() as Promise<Supplier[]>, [open]);
  const items = useAsync<InventoryItem[]>(() => window.khanalagao.inv.list({}) as Promise<InventoryItem[]>, [open]);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ inventoryItemId: number; quantity: string; unitCost: string }>>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const cleaned = lines
      .filter((l) => l.inventoryItemId && Number(l.quantity) > 0)
      .map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) || 0 }));
    if (cleaned.length === 0) { setErr("Add at least one item line."); return; }
    setBusy(true); setErr(null);
    try {
      await window.khanalagao.inv.purchaseOrderCreate({
        supplierId, expectedDate: expected || undefined, notes: notes || undefined, items: cleaned,
      });
      setLines([]); setSupplierId(null); setExpected(""); setNotes(""); onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Drawer
      open={open} title="Raise purchase order" onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Create PO"}</Button>
        </>
      }
    >
      <Field label="Supplier">
        <select
          value={supplierId ?? ""}
          onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}
          style={{ width: "100%", background: colors.bg, color: colors.textPrimary, padding: 10, borderRadius: 8, border: `1px solid ${colors.borderStrong}`, fontSize: 14 }}
        >
          <option value="">Select supplier…</option>
          {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Expected date">
        <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
      </Field>
      <Field label="Items">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 30px", gap: 6 }}>
              <select
                value={l.inventoryItemId}
                onChange={(e) => setLines((x) => x.map((y, j) => j === i ? { ...y, inventoryItemId: Number(e.target.value) } : y))}
                style={{ background: colors.bg, color: colors.textPrimary, padding: 8, borderRadius: 6, border: `1px solid ${colors.borderStrong}`, fontSize: 12 }}
              >
                <option value={0}>—</option>
                {(items.data ?? []).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
              <Input type="number" placeholder="Qty" value={l.quantity}
                onChange={(e) => setLines((x) => x.map((y, j) => j === i ? { ...y, quantity: e.target.value } : y))}
                style={{ padding: 8, fontSize: 12 }} />
              <Input type="number" placeholder="Unit ₹" value={l.unitCost}
                onChange={(e) => setLines((x) => x.map((y, j) => j === i ? { ...y, unitCost: e.target.value } : y))}
                style={{ padding: 8, fontSize: 12 }} />
              <button
                onClick={() => setLines((x) => x.filter((_, j) => j !== i))}
                style={{ background: "transparent", color: colors.danger, border: 0, cursor: "pointer", fontSize: 16 }}
              >×</button>
            </div>
          ))}
          <Button variant="ghost" style={{ padding: "8px 12px", fontSize: 12 }}
            onClick={() => setLines((x) => [...x, { inventoryItemId: 0, quantity: "", unitCost: "" }])}>
            + Add line
          </Button>
        </div>
      </Field>
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {err && <ErrorBox message={err} />}
    </Drawer>
  );
}

// ─── Wastage ──────────────────────────────────────────────────────────────
export function WastageScreen() {
  const { data, loading, error, reload } = useAsync<WasteEntry[]>(
    () => window.khanalagao.inv.wasteLog() as Promise<WasteEntry[]>, [],
  );
  const totalQty = (data ?? []).reduce((s, w) => s + num(w.quantity), 0);
  return (
    <PageShell title="Wastage" actions={<Button onClick={reload}>Refresh</Button>}>
      <StatRow>
        <Stat label="Entries" value={data?.length ?? "—"} />
        <Stat label="Total units wasted" value={totalQty.toFixed(2)} />
      </StatRow>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<WasteEntry>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="No wastage logged" hint="Wastage is logged from the Raw Materials screen → Adjust → Waste." />}
          columns={[
            { key: "when", header: "When", render: (r) => fmtDate(r.createdAt) },
            { key: "item", header: "Item", render: (r) => r.itemName },
            { key: "qty", header: "Qty", align: "right", render: (r) => `${num(r.quantity).toFixed(2)} ${r.unit}` },
            { key: "type", header: "Type", render: (r) => r.type ?? "—" },
            { key: "notes", header: "Notes", render: (r) => r.notes ?? "—" },
          ]}
        />
      )}
    </PageShell>
  );
}

// ─── Inventory reports ────────────────────────────────────────────────────
export function InventoryReportsScreen() {
  const items = useAsync<InventoryItem[]>(() => window.khanalagao.inv.list({}) as Promise<InventoryItem[]>, []);
  const valuation = useMemo(() => {
    if (!items.data) return 0;
    return items.data.reduce((s, i) => s + num(i.currentStock) * num(i.costPerUnit), 0);
  }, [items.data]);
  const lowCount = useMemo(() => (items.data ?? []).filter((i) => i.isLowStock).length, [items.data]);

  return (
    <PageShell title="Inventory reports" actions={<Button onClick={items.reload}>Refresh</Button>}>
      <StatRow>
        <Stat label="Item count" value={items.data?.length ?? "—"} />
        <Stat label="Low-stock items" value={lowCount} hint={lowCount > 0 ? "needs replenishment" : "all healthy"} />
        <Stat label="Stock valuation" value={fmtMoney(valuation)} hint="at last recorded cost" />
      </StatRow>
      {items.error && <ErrorBox message={items.error} onRetry={items.reload} />}
      {items.loading && !items.data && <Skeleton rows={3} />}
      {items.data && (
        <DataTable<InventoryItem>
          rowKey={(r) => r.id}
          rows={items.data.slice().sort((a, b) => num(b.currentStock) * num(b.costPerUnit) - num(a.currentStock) * num(a.costPerUnit)).slice(0, 30)}
          empty={<Empty title="No inventory" />}
          columns={[
            { key: "name", header: "Item" },
            { key: "stock", header: "On hand", align: "right", render: (r) => `${num(r.currentStock).toFixed(2)} ${r.unit}` },
            { key: "value", header: "Stock value", align: "right", render: (r) => fmtMoney(num(r.currentStock) * num(r.costPerUnit)) },
          ]}
        />
      )}
    </PageShell>
  );
}

// ─── Pending-backend screens (no matching endpoint yet) ───────────────────
export const WarehouseScreen      = () => <PageShell title="Warehouses"><PendingBackend feature="Multi-warehouse management" /></PageShell>;
export const WarehouseTypeScreen  = () => <PageShell title="Warehouse types"><PendingBackend feature="Warehouse type catalog" /></PageShell>;
export const StockTransferScreen  = () => <PageShell title="Stock transfer / issue"><PendingBackend feature="Inter-warehouse stock transfer / issue" /></PageShell>;
export const VendorOcrScreen      = () => <PageShell title="Vendor invoice OCR"><PendingBackend feature="Vendor invoice OCR ingestion" /></PageShell>;
