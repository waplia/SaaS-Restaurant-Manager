/**
 * Accountant workspace screens.
 *
 * Wired to the existing payments / expenses / pnl / accounting-targets
 * endpoints. Modules that depend on yet-to-be-built backend (vouchers,
 * cards, wallet, bank reconciliation, refunds, settlements) render an
 * honest "endpoint pending" state instead of a fake table.
 */
import { useMemo, useState } from "react";
import {
  PageShell, Empty, ErrorBox, Skeleton, useAsync, Drawer, Field, Stat, StatRow,
  DataTable, Button, Input, colors, fmtMoney, fmtDate, fmtDateShort, StatusPill,
  PendingBackend, todayISO,
} from "./shared";

const num = (v: unknown) => Number(v ?? 0) || 0;

interface ExpenseRow { id: number; categoryId: number; amount: string; expenseDate: string; payee?: string | null; paymentMethod?: string | null; notes?: string | null; status?: string | null; }
interface Category { id: number; name: string; categoryKind?: string | null; isActive?: boolean; }
interface PaymentRow { id: number; orderId?: number | null; amount: string | number; method?: string; createdAt?: string; status?: string; }
interface Pnl { revenue?: { gross?: number; net?: number }; expenses?: { total?: number }; profit?: number; period?: { from?: string; to?: string }; cogs?: number; }

// ─── Expenses ─────────────────────────────────────────────────────────────
export function ExpensesScreen() {
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const { data, loading, error, reload } = useAsync<{ data: ExpenseRow[]; totalAmount: string; total: number } | ExpenseRow[]>(
    () => window.khanalagao.acc.expenses({ from, to, limit: 200 }) as Promise<{ data: ExpenseRow[]; totalAmount: string; total: number }>,
    [from, to],
  );
  const rows = Array.isArray(data) ? data : (data?.data ?? []);
  const totalAmount = Array.isArray(data) ? rows.reduce((s, r) => s + num(r.amount), 0) : num(data?.totalAmount);
  const cats = useAsync<Category[]>(() => window.khanalagao.acc.expenseCategories() as Promise<Category[]>, []);
  const catMap = useMemo(() => new Map((cats.data ?? []).map((c) => [c.id, c.name])), [cats.data]);
  const [open, setOpen] = useState(false);

  return (
    <PageShell title="Expenses" actions={
      <>
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <Button onClick={() => setOpen(true)}>+ Record expense</Button>
      </>
    }>
      <StatRow>
        <Stat label="Period total" value={fmtMoney(totalAmount)} hint={`${from} → ${to}`} />
        <Stat label="Entries" value={rows.length} />
      </StatRow>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<ExpenseRow>
          rowKey={(r) => r.id}
          rows={rows}
          empty={<Empty title="No expenses in this period" />}
          columns={[
            { key: "date", header: "Date", render: (r) => fmtDateShort(r.expenseDate) },
            { key: "cat", header: "Category", render: (r) => catMap.get(r.categoryId) ?? `#${r.categoryId}` },
            { key: "payee", header: "Payee", render: (r) => r.payee ?? "—" },
            { key: "amount", header: "Amount", align: "right", render: (r) => fmtMoney(r.amount) },
            { key: "method", header: "Method", render: (r) => r.paymentMethod ?? "—" },
            { key: "status", header: "Status", render: (r) => r.status
              ? <StatusPill status={r.status} tone={r.status === "approved" ? "ok" : r.status === "pending" ? "warn" : "info"} />
              : "—" },
          ]}
        />
      )}
      <ExpenseDrawer open={open} onClose={() => setOpen(false)} onSaved={reload} categories={cats.data ?? []} />
    </PageShell>
  );
}

function ExpenseDrawer({ open, onClose, onSaved, categories }: {
  open: boolean; onClose: () => void; onSaved: () => void; categories: Category[];
}) {
  const [categoryId, setCategoryId] = useState<number>(0);
  const [amount, setAmount] = useState(""); const [date, setDate] = useState(todayISO());
  const [payee, setPayee] = useState(""); const [method, setMethod] = useState("cash"); const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!categoryId || !amount) { setErr("Pick a category and enter the amount."); return; }
    setBusy(true); setErr(null);
    try {
      await window.khanalagao.acc.expenseCreate({
        categoryId, amount: Number(amount), expenseDate: date,
        payee: payee || undefined, paymentMethod: method, notes: notes || undefined,
      });
      setCategoryId(0); setAmount(""); setPayee(""); setNotes("");
      onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Drawer
      open={open} title="Record expense" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save expense"}</Button>
      </>}
    >
      <Field label="Category *">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(Number(e.target.value))}
          style={{ width: "100%", background: colors.bg, color: colors.textPrimary, padding: 10, borderRadius: 8, border: `1px solid ${colors.borderStrong}`, fontSize: 14 }}
        >
          <option value={0}>Select category…</option>
          {categories.filter((c) => c.isActive !== false).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Amount *"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Payee"><Input value={payee} onChange={(e) => setPayee(e.target.value)} /></Field>
      <Field label="Payment method">
        <select value={method} onChange={(e) => setMethod(e.target.value)}
          style={{ width: "100%", background: colors.bg, color: colors.textPrimary, padding: 10, borderRadius: 8, border: `1px solid ${colors.borderStrong}`, fontSize: 14 }}>
          <option value="cash">Cash</option><option value="card">Card</option>
          <option value="upi">UPI</option><option value="bank">Bank transfer</option>
        </select>
      </Field>
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {err && <ErrorBox message={err} />}
    </Drawer>
  );
}

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <Input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} style={{ width: 140, padding: "8px 10px" }} />
      <span style={{ color: colors.textDim }}>→</span>
      <Input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} style={{ width: 140, padding: "8px 10px" }} />
    </div>
  );
}

// ─── Expense categories (Expense Type in task spec) ───────────────────────
export function ExpenseTypesScreen() {
  const { data, loading, error, reload } = useAsync<Category[]>(
    () => window.khanalagao.acc.expenseCategories() as Promise<Category[]>, [],
  );
  const [open, setOpen] = useState(false);
  return (
    <PageShell title="Expense types" actions={
      <>
        <Button variant="ghost" onClick={reload}>Refresh</Button>
        <Button onClick={() => setOpen(true)}>+ New type</Button>
      </>
    }>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<Category>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="No expense categories" />}
          columns={[
            { key: "name", header: "Name", render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
            { key: "kind", header: "Kind", render: (r) => r.categoryKind ?? "—" },
            { key: "active", header: "Status",
              render: (r) => r.isActive === false
                ? <StatusPill status="archived" tone="bad" />
                : <StatusPill status="active" tone="ok" /> },
          ]}
        />
      )}
      <CategoryDrawer open={open} onClose={() => setOpen(false)} onSaved={reload} />
    </PageShell>
  );
}

function CategoryDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(""); const [kind, setKind] = useState("other");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    setBusy(true); setErr(null);
    try {
      await window.khanalagao.acc.expenseCategoryCreate({ name: name.trim(), categoryKind: kind });
      setName(""); onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Drawer open={open} title="New expense type" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Create"}</Button>
      </>}>
      <Field label="Name *"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value)}
          style={{ width: "100%", background: colors.bg, color: colors.textPrimary, padding: 10, borderRadius: 8, border: `1px solid ${colors.borderStrong}`, fontSize: 14 }}>
          <option value="cogs">COGS</option><option value="opex">Operating</option>
          <option value="payroll">Payroll</option><option value="rent">Rent</option>
          <option value="utilities">Utilities</option><option value="other">Other</option>
        </select>
      </Field>
      {err && <ErrorBox message={err} />}
    </Drawer>
  );
}

// ─── Payments ─────────────────────────────────────────────────────────────
export function PaymentsLedgerScreen() {
  const [from, setFrom] = useState(todayISO(-7));
  const [to, setTo] = useState(todayISO());
  const list = useAsync<{ data?: PaymentRow[] } | PaymentRow[]>(
    () => window.khanalagao.acc.paymentsList({ from, to, limit: 200 }) as Promise<{ data?: PaymentRow[] }>,
    [from, to],
  );
  const summary = useAsync<{ total?: number; byMethod?: Record<string, { amount: number; count: number }> }>(
    () => window.khanalagao.acc.paymentsSummary({ from, to }) as Promise<{ total: number }>,
    [from, to],
  );
  const rows = Array.isArray(list.data) ? list.data : (list.data?.data ?? []);
  return (
    <PageShell title="Payments" actions={<DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />}>
      <StatRow>
        <Stat label="Total received" value={fmtMoney(summary.data?.total)} hint={`${from} → ${to}`} />
        {summary.data?.byMethod && Object.entries(summary.data.byMethod).map(([m, v]) => (
          <Stat key={m} label={m} value={fmtMoney(v.amount)} hint={`${v.count} txn${v.count === 1 ? "" : "s"}`} />
        ))}
      </StatRow>
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <Skeleton />}
      {list.data && (
        <DataTable<PaymentRow>
          rowKey={(r) => r.id}
          rows={rows}
          empty={<Empty title="No payments in this period" />}
          columns={[
            { key: "when", header: "When", render: (r) => fmtDate(r.createdAt) },
            { key: "order", header: "Order", render: (r) => r.orderId ? `#${r.orderId}` : "—" },
            { key: "method", header: "Method", render: (r) => r.method ?? "—" },
            { key: "amount", header: "Amount", align: "right", render: (r) => fmtMoney(r.amount) },
            { key: "status", header: "Status", render: (r) => r.status
              ? <StatusPill status={r.status} tone={r.status === "succeeded" || r.status === "completed" ? "ok" : "info"} />
              : "—" },
          ]}
        />
      )}
    </PageShell>
  );
}

// ─── P&L ──────────────────────────────────────────────────────────────────
export function PnlScreen() {
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const { data, loading, error, reload } = useAsync<Pnl>(
    () => window.khanalagao.acc.pnl({ from, to }) as Promise<Pnl>, [from, to],
  );
  const gross = num(data?.revenue?.gross);
  const net = num(data?.revenue?.net);
  const exp = num(data?.expenses?.total);
  const profit = data?.profit != null ? num(data.profit) : net - exp;
  return (
    <PageShell title="Profit & loss" actions={
      <>
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <Button onClick={reload}>Refresh</Button>
      </>
    }>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton rows={4} />}
      {data && (
        <>
          <StatRow>
            <Stat label="Gross revenue" value={fmtMoney(gross)} />
            <Stat label="Net revenue" value={fmtMoney(net)} hint="post-discount, pre-expense" />
            <Stat label="Expenses" value={fmtMoney(exp)} />
            <Stat label="Profit" value={fmtMoney(profit)} hint={profit >= 0 ? "in the black" : "loss"} />
          </StatRow>
          <details style={{ marginTop: 18, background: colors.panel, padding: 12, borderRadius: 8, border: `1px solid ${colors.border}`, color: colors.textDim, fontSize: 12 }}>
            <summary style={{ cursor: "pointer", color: colors.textPrimary }}>Raw API payload</summary>
            <pre style={{ marginTop: 12, fontFamily: "ui-monospace, monospace", fontSize: 11, color: colors.textDim, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </>
      )}
    </PageShell>
  );
}

// ─── Accounting reports (targets + summary) ───────────────────────────────
export function AccountingReportsScreen() {
  const targets = useAsync<unknown>(() => window.khanalagao.acc.targets(), []);
  const summary = useAsync<{ total?: number; byMethod?: Record<string, { amount: number; count: number }> }>(
    () => window.khanalagao.acc.paymentsSummary({ from: todayISO(-30), to: todayISO() }) as Promise<{ total: number }>, [],
  );
  return (
    <PageShell title="Accounting reports">
      <StatRow>
        <Stat label="Last 30d revenue" value={fmtMoney(summary.data?.total)} />
        {summary.data?.byMethod && Object.entries(summary.data.byMethod).slice(0, 3).map(([m, v]) => (
          <Stat key={m} label={`${m} (30d)`} value={fmtMoney(v.amount)} />
        ))}
      </StatRow>
      {targets.data ? (
        <details open style={{ background: colors.panel, padding: 14, borderRadius: 10, border: `1px solid ${colors.border}` }}>
          <summary style={{ cursor: "pointer", color: colors.textPrimary, fontWeight: 600 }}>Accounting targets</summary>
          <pre style={{ marginTop: 12, fontFamily: "ui-monospace, monospace", fontSize: 11, color: colors.textDim, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(targets.data, null, 2)}
          </pre>
        </details>
      ) : targets.loading ? <Skeleton rows={2} /> : null}
      {targets.error && <ErrorBox message={targets.error} onRetry={targets.reload} />}
    </PageShell>
  );
}

// ─── POS report — reuses Z-report list via existing zReports IPC ──────────
export function PosReportScreen() {
  const { data, loading, error, reload } = useAsync<Array<{ sessionId: number; openedAt: string; closedAt?: string; grossRevenue: number; orderCount: number; openedByName?: string | null }>>(
    () => window.khanalagao.zReports.list() as Promise<Array<{ sessionId: number; openedAt: string; closedAt?: string; grossRevenue: number; orderCount: number; openedByName?: string | null }>>,
    [],
  );
  return (
    <PageShell title="POS report" actions={<Button onClick={reload}>Refresh</Button>}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable
          rowKey={(r) => r.sessionId}
          rows={data}
          empty={<Empty title="No Z-reports yet" hint="Close a cashier shift to generate a Z-report." />}
          columns={[
            { key: "session", header: "Session", render: (r) => `#${r.sessionId}` },
            { key: "opened", header: "Opened", render: (r) => fmtDate(r.openedAt) },
            { key: "closed", header: "Closed", render: (r) => fmtDate(r.closedAt) },
            { key: "by", header: "Opened by", render: (r) => r.openedByName ?? "—" },
            { key: "orders", header: "Orders", align: "right", render: (r) => r.orderCount },
            { key: "gross", header: "Gross", align: "right", render: (r) => fmtMoney(r.grossRevenue) },
          ]}
        />
      )}
    </PageShell>
  );
}

// ─── Work period report — same data, different framing ───────────────────
export function WorkPeriodScreen() {
  return <PosReportScreen />;
}

// ─── Pending-backend modules ─────────────────────────────────────────────
export const VoucherScreen        = () => (
  <PageShell title="Vouchers">
    <PendingBackend feature="Manual accounting vouchers (journal entries)"
      quickActions={["New voucher", "Post journal entry", "Browse vouchers"]} />
  </PageShell>
);
export const CardsScreen          = () => (
  <PageShell title="Cards">
    <PendingBackend feature="Card payment instrument ledger"
      quickActions={["Add card account", "Reconcile card batch"]} />
  </PageShell>
);
export const WalletScreen         = () => (
  <PageShell title="Wallet">
    <PendingBackend feature="Customer wallet balance ledger"
      quickActions={["Top up wallet", "Adjust balance"]} />
  </PageShell>
);
export const BankReconciliationScreen = () => (
  <PageShell title="Bank reconciliation">
    <PendingBackend feature="Bank statement reconciliation"
      quickActions={["Import statement", "Reconcile batch", "Flag exception"]} />
  </PageShell>
);
export const RefundsScreen        = () => (
  <PageShell title="Refunds">
    <PendingBackend feature="Refund processing workflow"
      quickActions={["Issue refund", "Review pending refunds"]} />
  </PageShell>
);
export const SettlementsScreen    = () => (
  <PageShell title="Settlements">
    <PendingBackend feature="Payment processor settlement reports"
      quickActions={["View today's settlement", "Download settlement file"]} />
  </PageShell>
);
