/**
 * Delivery workspace screens.
 *
 * The delivery dispatcher needs to know which orders are assigned to
 * which rider, push them through pickup → on-the-way → delivered, log
 * proof of delivery / failure reasons, then collect cash at end of shift
 * via the handover endpoint.
 */
import { useEffect, useMemo, useState } from "react";
import {
  PageShell, Empty, ErrorBox, Skeleton, useAsync, Drawer, Field, Stat, StatRow,
  DataTable, Button, Input, colors, fmtMoney, fmtDate, fmtDateShort, StatusPill, todayISO,
} from "./shared";

interface Assignment {
  id: number; orderId: number; riderId: number;
  status: "assigned" | "picked_up" | "delivered" | "cancelled";
  codAmount: string | number;
  codCollected?: boolean;
  codHandedIn?: boolean;
  proofPhotoUrl?: string | null;
  unavailableReason?: string | null;
  notes?: string | null;
  assignedAt?: string;
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  // Joined fields (some endpoints embed these; we render defensively).
  orderNumber?: string | null;
  totalAmount?: string | number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryLat?: number | string | null;
  deliveryLng?: number | string | null;
  pickupAddress?: string | null;
  riderName?: string | null;
  // Server often nests the joined order:
  order?: {
    orderNumber?: string | null;
    totalAmount?: string | number | null;
    customerName?: string | null;
    customerPhone?: string | null;
    deliveryAddress?: string | null;
    deliveryLat?: number | string | null;
    deliveryLng?: number | string | null;
  };
  rider?: { id: number; name?: string; phone?: string | null };
}
interface Executive { id: number; name: string; phone?: string | null; isActive: boolean; activeDeliveries?: number; }
interface Handover { id: number; riderId: number; amount: string | number; createdAt?: string; notes?: string | null; riderName?: string | null; }

const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Backend status semantics for delivery assignments:
 *   assigned | picked_up | delivered | cancelled
 *
 * "Failed" is a UX-only state: the server collapses customer-unavailable
 * and other delivery failures into `cancelled` plus a free-text
 * `unavailableReason`. The desktop UI splits them back out so dispatchers
 * can distinguish "operationally cancelled" (e.g. duplicate, customer
 * called to cancel) from "failed at door" (rider attempted, customer
 * not reachable). This mapping lives only on the client — once the
 * server grows a first-class `failed` status, drop these helpers and
 * use a.status directly.
 */
type DisplayStatus = "assigned" | "picked_up" | "delivered" | "cancelled" | "failed";
function displayStatus(a: Pick<Assignment, "status" | "unavailableReason">): DisplayStatus {
  if (a.status === "cancelled" && (a.unavailableReason ?? "").trim() !== "") return "failed";
  return a.status as DisplayStatus;
}

// ─── Assigned delivery orders (dispatch board) ────────────────────────────
export function AssignmentsScreen() {
  const [statusFilter, setStatusFilter] = useState<"" | DisplayStatus>("");
  // For "failed" we ask the server for cancelled rows and post-filter
  // on `unavailableReason`. For "cancelled" we ask the server for
  // cancelled rows and drop anything with a reason (those are failed).
  const serverStatus = statusFilter === "failed" ? "cancelled"
    : statusFilter === "cancelled" ? "cancelled"
    : statusFilter || undefined;
  const { data: rawData, loading, error, reload } = useAsync<Assignment[]>(
    () => window.khanalagao.del.assignments({ status: serverStatus }) as Promise<Assignment[]>,
    [serverStatus],
  );
  const data = useMemo(() => {
    if (!rawData) return rawData;
    if (statusFilter === "failed") return rawData.filter((a) => displayStatus(a) === "failed");
    if (statusFilter === "cancelled") return rawData.filter((a) => displayStatus(a) === "cancelled");
    return rawData;
  }, [rawData, statusFilter]);
  const exec = useAsync<Executive[]>(() => window.khanalagao.del.executives() as Promise<Executive[]>, []);
  const riderMap = useMemo(() => new Map((exec.data ?? []).map((r) => [r.id, r.name])), [exec.data]);
  const [picked, setPicked] = useState<Assignment | null>(null);

  return (
    <PageShell title="Assigned orders" actions={
      <>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | DisplayStatus)}
          style={{ background: colors.bg, color: colors.textPrimary, padding: "8px 12px", border: `1px solid ${colors.borderStrong}`, borderRadius: 8, fontSize: 13 }}>
          <option value="">All statuses</option>
          <option value="assigned">Assigned</option>
          <option value="picked_up">Picked up</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed (customer unavailable)</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Button onClick={reload}>Refresh</Button>
      </>
    }>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<Assignment>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="No delivery assignments" hint="Assignments appear here once a manager dispatches an online/delivery order." />}
          onRowClick={(r) => setPicked(r)}
          columns={[
            { key: "order", header: "Order", render: (r) => `#${r.order?.orderNumber ?? r.orderNumber ?? r.orderId}` },
            { key: "rider", header: "Rider", render: (r) => r.rider?.name ?? r.riderName ?? riderMap.get(r.riderId) ?? `#${r.riderId}` },
            { key: "customer", header: "Customer", render: (r) => {
              const name = r.order?.customerName ?? r.customerName;
              const phone = r.order?.customerPhone ?? r.customerPhone;
              return (
                <div>
                  <div>{name ?? "—"}</div>
                  {phone && <a href={`tel:${phone}`} onClick={(e) => e.stopPropagation()}
                    style={{ fontSize: 11, color: colors.brand }}>{phone}</a>}
                </div>
              );
            } },
            { key: "drop", header: "Drop", render: (r) => {
              const addr = r.order?.deliveryAddress ?? r.deliveryAddress;
              return <span style={{ color: colors.textDim, fontSize: 12 }}>{(addr ?? "—").slice(0, 50)}</span>;
            } },
            { key: "eta", header: "Distance / ETA", render: () => (
              <span style={{ color: colors.textMuted, fontSize: 11, fontStyle: "italic" }}>—</span>
            ) },
            { key: "total", header: "Order", align: "right", render: (r) => fmtMoney(r.order?.totalAmount ?? r.totalAmount) },
            { key: "cod", header: "COD", align: "right", render: (r) =>
              num(r.codAmount) > 0
                ? <span style={{ color: r.codCollected ? "#22c55e" : "#fbbf24", fontWeight: 600 }}>{fmtMoney(r.codAmount)}{r.codCollected ? " ✓" : ""}</span>
                : "—" },
            { key: "status", header: "Status", render: (r) => statusPill(displayStatus(r)) },
            { key: "assigned", header: "Assigned", render: (r) => fmtDate(r.assignedAt) },
          ]}
        />
      )}
      <AssignmentDrawer assignment={picked} onClose={() => setPicked(null)} onSaved={reload} />
    </PageShell>
  );
}

/**
 * Pickup address for the currently-selected restaurant. The server
 * returns it on `/restaurants` (exposed as `restaurants:list`), so we
 * look it up against the active selection. Falls back to a generic
 * label when address is missing.
 */
function PickupAddress() {
  const [text, setText] = useState<string>("Restaurant (origin)");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, snap] = await Promise.all([
          window.khanalagao.restaurants.list(),
          window.khanalagao.session.snapshot(),
        ]);
        if (!alive) return;
        const rid = snap?.selection?.restaurantId;
        const r = (list ?? []).find((x) => x.id === rid);
        if (r) {
          setText(r.city ? `${r.name} — ${r.city}` : r.name);
        }
      } catch { /* fall back to default label */ }
    })();
    return () => { alive = false; };
  }, []);
  return <div style={{ color: colors.textPrimary }}>{text}</div>;
}

function statusPill(s: string) {
  const tone = s === "delivered" ? "ok"
    : s === "cancelled" ? "bad"
    : s === "failed" ? "bad"
    : s === "picked_up" ? "info"
    : "warn";
  return <StatusPill status={s.replace("_", " ")} tone={tone} />;
}

function AssignmentDrawer({ assignment, onClose, onSaved }: {
  assignment: Assignment | null; onClose: () => void; onSaved: () => void;
}) {
  const [reason, setReason] = useState(""); const [proofUrl, setProofUrl] = useState("");
  const [collectedCod, setCollectedCod] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  if (!assignment) return null;
  const orderNumber = assignment.order?.orderNumber ?? assignment.orderNumber ?? assignment.orderId;
  const customerName = assignment.order?.customerName ?? assignment.customerName;
  const customerPhone = assignment.order?.customerPhone ?? assignment.customerPhone;
  const deliveryAddress = assignment.order?.deliveryAddress ?? assignment.deliveryAddress;
  const totalAmount = assignment.order?.totalAmount ?? assignment.totalAmount;
  const codDue = num(assignment.codAmount);

  const markPickedUp = async () => {
    setBusy(true); setErr(null);
    try {
      await window.khanalagao.del.updateStatus({ assignmentId: assignment.id, status: "picked_up" });
      onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const markDelivered = async () => {
    setBusy(true); setErr(null);
    try {
      // Optional proof upload first (separate endpoint), then status transition
      // which can also flip codCollected for COD orders. Two distinct REST
      // calls because the server keeps these concerns separate.
      if (proofUrl.trim()) {
        await window.khanalagao.del.proof({ assignmentId: assignment.id, proofPhotoUrl: proofUrl.trim() });
      }
      await window.khanalagao.del.updateStatus({
        assignmentId: assignment.id,
        status: "delivered",
        codCollected: codDue > 0 ? collectedCod : undefined,
      });
      setProofUrl(""); onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const markFailed = async () => {
    if (!reason.trim()) { setErr("Reason is required."); return; }
    setBusy(true); setErr(null);
    try {
      // Server routes "customer unavailable / failed" through the
      // /unavailable endpoint — it cancels the assignment and re-opens
      // the order. The plain `cancelled` status would not capture the
      // reason text.
      await window.khanalagao.del.unavailable({ assignmentId: assignment.id, reason: reason.trim() });
      setReason(""); onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const markCodOnly = async () => {
    setBusy(true); setErr(null);
    try {
      await window.khanalagao.del.codCollected({ assignmentId: assignment.id });
      onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const mapsUrl = deliveryAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(deliveryAddress)}`
    : null;
  const isTerminal = assignment.status === "delivered" || assignment.status === "cancelled";

  return (
    <Drawer
      open={!!assignment}
      title={`Order #${orderNumber}`}
      onClose={onClose}
    >
      <Field label="Status">{statusPill(assignment.status)}</Field>
      <Field label="Customer">
        <div style={{ color: colors.textPrimary }}>{customerName ?? "—"}</div>
        {customerPhone && (
          <a href={`tel:${customerPhone}`} style={{ color: colors.brand, fontSize: 13 }}>
            ☎ Call {customerPhone}
          </a>
        )}
      </Field>
      <Field label="Pickup">
        <PickupAddress />
        <div style={{ color: colors.textMuted, fontSize: 11, fontStyle: "italic", marginTop: 4 }}>
          Distance &amp; ETA: backend endpoint pending — see PHASE6_BACKEND_GAPS.md
        </div>
      </Field>
      <Field label="Drop">
        <div style={{ color: colors.textPrimary, marginBottom: 6 }}>{deliveryAddress ?? "—"}</div>
        {mapsUrl && (
          <button
            onClick={() => window.khanalagao.app.openExternal(mapsUrl)}
            style={{ background: colors.panelAlt, color: colors.brand, border: 0, padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
          >🗺 Open in Google Maps</button>
        )}
      </Field>
      <Field label="Order total">{fmtMoney(totalAmount)}</Field>
      <Field label="COD to collect">
        {codDue > 0
          ? <span style={{ color: assignment.codCollected ? "#22c55e" : "#fbbf24", fontWeight: 700 }}>
              {fmtMoney(assignment.codAmount)}{assignment.codCollected ? " ✓ collected" : ""}
            </span>
          : "—"}
      </Field>
      {assignment.proofPhotoUrl && (
        <Field label="Proof photo">
          <a href={assignment.proofPhotoUrl} onClick={(e) => { e.preventDefault(); window.khanalagao.app.openExternal(assignment.proofPhotoUrl!); }}
            style={{ color: colors.brand, fontSize: 12, wordBreak: "break-all" }}>{assignment.proofPhotoUrl}</a>
        </Field>
      )}
      {assignment.unavailableReason && (
        <Field label="Returned reason">
          <span style={{ color: "#f87171" }}>{assignment.unavailableReason}</span>
        </Field>
      )}

      {!isTerminal && (
        <>
          <hr style={{ border: 0, borderTop: `1px solid ${colors.border}`, margin: "18px 0" }} />
          <Field label="Proof photo URL (saved on delivery)">
            <Input value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="Photo/signature URL (optional)" />
          </Field>
          {codDue > 0 && (
            <Field label="COD collected?">
              <label style={{ color: colors.textPrimary, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={collectedCod} onChange={(e) => setCollectedCod(e.target.checked)} />
                Mark cash as collected when delivering
              </label>
            </Field>
          )}
          <Field label="Failure / customer-unavailable reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer unavailable" />
          </Field>
          {err && <ErrorBox message={err} />}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {assignment.status === "assigned" && (
              <Button onClick={markPickedUp} disabled={busy}>Mark picked up</Button>
            )}
            <Button onClick={markDelivered} disabled={busy}>Mark delivered</Button>
            <Button variant="danger" onClick={markFailed} disabled={busy}>Mark customer unavailable</Button>
            {codDue > 0 && !assignment.codCollected && (
              <Button variant="ghost" onClick={markCodOnly} disabled={busy}>Mark COD collected</Button>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}

// ─── Status board — kanban-style grouping ─────────────────────────────────
export function StatusBoardScreen() {
  const { data, loading, error, reload } = useAsync<Assignment[]>(
    () => window.khanalagao.del.assignments({}) as Promise<Assignment[]>, [],
  );
  const groups = useMemo(() => {
    const g: Record<DisplayStatus, Assignment[]> = {
      assigned: [], picked_up: [], delivered: [], cancelled: [], failed: [],
    };
    (data ?? []).forEach((a) => {
      const ds = displayStatus(a);
      g[ds].push(a);
    });
    return g;
  }, [data]);
  return (
    <PageShell title="Delivery status board" actions={<Button onClick={reload}>Refresh</Button>}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton rows={6} />}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          {(["assigned", "picked_up", "delivered", "failed", "cancelled"] as const).map((status) => (
            <div key={status} style={{ background: colors.panel, borderRadius: 10, border: `1px solid ${colors.border}`, padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 200 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                <span style={{ flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: 700, textTransform: "capitalize" }}>{status.replace("_", " ")}</span>
                <span style={{ background: colors.panelAlt, padding: "2px 8px", borderRadius: 10, fontSize: 11, color: colors.textDim }}>{groups[status].length}</span>
              </div>
              {groups[status].length === 0
                ? <div style={{ padding: 12, color: colors.textMuted, fontSize: 12 }}>—</div>
                : groups[status].map((a) => (
                  <div key={a.id} style={{ background: colors.bg, borderRadius: 8, padding: 10, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: colors.textPrimary }}>#{a.orderNumber ?? a.orderId}</div>
                    <div style={{ color: colors.textDim, marginTop: 2 }}>{a.customerName ?? "—"}</div>
                    {num(a.codAmount) > 0 && <div style={{ color: "#fbbf24", marginTop: 4, fontWeight: 600 }}>COD {fmtMoney(a.codAmount)}</div>}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}

// ─── Riders / executives ──────────────────────────────────────────────────
export function RidersScreen() {
  const { data, loading, error, reload } = useAsync<Executive[]>(
    () => window.khanalagao.del.executives() as Promise<Executive[]>, [],
  );
  return (
    <PageShell title="Delivery riders" actions={<Button onClick={reload}>Refresh</Button>}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<Executive>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="No delivery executives" hint="Create users with the delivery_executive role to dispatch from the desktop." />}
          columns={[
            { key: "name", header: "Rider", render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
            { key: "phone", header: "Phone", render: (r) =>
              r.phone ? <a href={`tel:${r.phone}`} style={{ color: colors.brand }}>{r.phone}</a> : "—" },
            { key: "active", header: "Active deliveries", align: "right", render: (r) => r.activeDeliveries ?? 0 },
            { key: "status", header: "Account",
              render: (r) => r.isActive
                ? <StatusPill status="active" tone="ok" />
                : <StatusPill status="inactive" tone="bad" /> },
          ]}
        />
      )}
    </PageShell>
  );
}

// ─── COD collection summary ───────────────────────────────────────────────
//
// Server `/delivery/cod-summary` returns an array, one row per rider:
//   [{ riderId, riderName, riderPhone, outstanding, deliveredCount }]
// "outstanding" = cash the rider has collected from customers but has
// NOT yet handed in (codCollected && !codHandedIn). We sum it for the
// header strip; date filters are advisory (the server does not accept
// from/to yet — left in the UI so the future endpoint can wire it).
interface CodRiderRow {
  riderId: number;
  riderName?: string;
  riderPhone?: string | null;
  outstanding: number;
  deliveredCount: number;
}
export function CodCollectionScreen() {
  const [from, setFrom] = useState(todayISO(-7));
  const [to, setTo] = useState(todayISO());
  const { data, loading, error, reload } = useAsync<CodRiderRow[]>(
    () => window.khanalagao.del.codSummary({ from, to }) as Promise<CodRiderRow[]>, [from, to],
  );
  const totals = useMemo(() => {
    const rows = data ?? [];
    return {
      outstanding: rows.reduce((s, r) => s + num(r.outstanding), 0),
      delivered: rows.reduce((s, r) => s + (r.deliveredCount ?? 0), 0),
      riders: rows.length,
    };
  }, [data]);
  return (
    <PageShell title="COD collection" actions={
      <>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 140, padding: "8px 10px" }} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 140, padding: "8px 10px" }} />
        <Button onClick={reload}>Refresh</Button>
      </>
    }>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton rows={3} />}
      {data && (
        <>
          <StatRow>
            <Stat label="Outstanding cash" value={fmtMoney(totals.outstanding)} />
            <Stat label="Deliveries (all-time)" value={totals.delivered} />
            <Stat label="Riders with activity" value={totals.riders} />
          </StatRow>
          {data.length > 0 ? (
            <DataTable<CodRiderRow>
              rowKey={(r) => r.riderId}
              rows={data}
              empty={<Empty title="No COD activity" />}
              columns={[
                { key: "name", header: "Rider", render: (r) => r.riderName ?? `#${r.riderId}` },
                { key: "phone", header: "Phone", render: (r) =>
                  r.riderPhone ? <a href={`tel:${r.riderPhone}`} style={{ color: colors.brand }}>{r.riderPhone}</a> : "—" },
                { key: "delivered", header: "Delivered", align: "right", render: (r) => r.deliveredCount ?? 0 },
                { key: "outstanding", header: "Outstanding cash", align: "right",
                  render: (r) => <b style={{ color: num(r.outstanding) > 0 ? "#fbbf24" : colors.textDim }}>{fmtMoney(r.outstanding)}</b> },
              ]}
            />
          ) : <Empty title="No COD activity" />}
        </>
      )}
    </PageShell>
  );
}

// ─── Cash handover ────────────────────────────────────────────────────────
export function CashHandoverScreen() {
  const handovers = useAsync<Handover[]>(() => window.khanalagao.del.handovers({ limit: 50 }) as Promise<Handover[]>, []);
  const riders = useAsync<Executive[]>(() => window.khanalagao.del.executives() as Promise<Executive[]>, []);
  const [open, setOpen] = useState(false);
  return (
    <PageShell title="Cash handover" actions={
      <>
        <Button variant="ghost" onClick={handovers.reload}>Refresh</Button>
        <Button onClick={() => setOpen(true)}>+ Record handover</Button>
      </>
    }>
      {handovers.error && <ErrorBox message={handovers.error} onRetry={handovers.reload} />}
      {handovers.loading && !handovers.data && <Skeleton />}
      {handovers.data && (
        <DataTable<Handover>
          rowKey={(r) => r.id}
          rows={handovers.data}
          empty={<Empty title="No handovers yet" hint="Log rider cash handovers so the daybook reconciles." />}
          columns={[
            { key: "when", header: "When", render: (r) => fmtDate(r.createdAt) },
            { key: "rider", header: "Rider", render: (r) => r.riderName ?? `#${r.riderId}` },
            { key: "amount", header: "Amount", align: "right", render: (r) => fmtMoney(r.amount) },
            { key: "notes", header: "Notes", render: (r) => r.notes ?? "—" },
          ]}
        />
      )}
      <HandoverDrawer open={open} onClose={() => setOpen(false)} onSaved={handovers.reload} riders={riders.data ?? []} />
    </PageShell>
  );
}

function HandoverDrawer({ open, onClose, onSaved, riders }: { open: boolean; onClose: () => void; onSaved: () => void; riders: Executive[] }) {
  const [riderId, setRiderId] = useState<number>(0);
  const [amount, setAmount] = useState(""); const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!riderId || !amount) { setErr("Pick rider and enter amount."); return; }
    setBusy(true); setErr(null);
    try {
      await window.khanalagao.del.handoverCreate({ riderId, amount: Number(amount), notes: notes || undefined });
      setRiderId(0); setAmount(""); setNotes(""); onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Drawer open={open} title="Record cash handover" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save handover"}</Button>
      </>}>
      <Field label="Rider *">
        <select value={riderId} onChange={(e) => setRiderId(Number(e.target.value))}
          style={{ width: "100%", background: colors.bg, color: colors.textPrimary, padding: 10, borderRadius: 8, border: `1px solid ${colors.borderStrong}`, fontSize: 14 }}>
          <option value={0}>Select rider…</option>
          {riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Amount *"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {err && <ErrorBox message={err} />}
    </Drawer>
  );
}

// ─── Delivery reports ─────────────────────────────────────────────────────
export function DeliveryReportsScreen() {
  const cod = useAsync<CodRiderRow[]>(
    () => window.khanalagao.del.codSummary({}) as Promise<CodRiderRow[]>, [],
  );
  const agg = useAsync<Record<string, unknown>>(
    () => window.khanalagao.del.aggregatorDashboard() as Promise<Record<string, unknown>>, [],
  );
  const totals = useMemo(() => {
    const rows = cod.data ?? [];
    return {
      outstanding: rows.reduce((s, r) => s + num(r.outstanding), 0),
      delivered: rows.reduce((s, r) => s + (r.deliveredCount ?? 0), 0),
      riders: rows.length,
    };
  }, [cod.data]);
  return (
    <PageShell title="Delivery reports" actions={<Button onClick={() => { cod.reload(); agg.reload(); }}>Refresh</Button>}>
      <StatRow>
        <Stat label="Total deliveries" value={totals.delivered} />
        <Stat label="Active riders" value={totals.riders} />
        <Stat label="COD outstanding" value={fmtMoney(totals.outstanding)} />
      </StatRow>
      <h3 style={{ color: colors.textPrimary, fontSize: 14, marginTop: 24, marginBottom: 8 }}>Aggregator dashboard</h3>
      {agg.error && <ErrorBox message={agg.error} onRetry={agg.reload} />}
      {agg.loading && !agg.data && <Skeleton rows={2} />}
      {agg.data && (
        <details open style={{ background: colors.panel, padding: 14, borderRadius: 10, border: `1px solid ${colors.border}` }}>
          <summary style={{ cursor: "pointer", color: colors.textPrimary, fontWeight: 600 }}>Latest aggregator payout snapshot</summary>
          <pre style={{ marginTop: 12, fontFamily: "ui-monospace, monospace", fontSize: 11, color: colors.textDim, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(agg.data, null, 2)}
          </pre>
        </details>
      )}
    </PageShell>
  );
}
