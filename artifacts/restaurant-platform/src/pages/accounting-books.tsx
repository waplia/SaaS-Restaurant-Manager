import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { BookOpen, Plus, Trash2, Lock, Unlock, FileText, CheckCircle2, X, Send, Calendar, Wallet, RefreshCw } from "lucide-react";

const TABS = ["Chart of Accounts", "Journals", "Vendor Bills (AP)", "AR Invoices", "Mapping Rules", "Period Close", "Statements"] as const;
type Tab = typeof TABS[number];

interface Account { id: number; code: string; name: string; type: string; normalBalance: string; isActive: boolean; isSystem: boolean }
interface Journal { id: number; journalNo: string; entryDate: string; source: string; memo: string | null; status: string; totalDebit: string; totalCredit: string; sourceRef: string | null }
interface JournalLine { id?: number; accountId: number; debit: string | number; credit: string | number; memo?: string | null }
interface VendorBill { id: number; billNo: string; vendorName: string; billDate: string; dueDate: string; totalAmount: string; amountPaid: string; status: string; scheduledPayDate: string | null }
interface VendorBillDetail extends VendorBill { lines: Array<{ description: string; quantity: string; unitPrice: string; taxRate: string; lineTotal: string }>; payments: Array<{ id: number; amount: string; paymentDate: string; paymentMethod: string }>; apAccountId: number | null; expenseAccountId: number | null }
interface ArInvoice { id: number; invoiceNo: string; customerName: string; invoiceDate: string; dueDate: string; totalAmount: string; amountReceived: string; status: string }
interface Period { id: number; periodStart: string; periodEnd: string; status: string; closedAt: string | null; notes: string | null }
interface Rule { id: number; source: string; matchKey: string; debitAccountId: number | null; creditAccountId: number | null; isActive: boolean; notes: string | null }
interface TrialBalanceRow { accountId: number; code: string; name: string; type: string; normalBalance: string; debit: number; credit: number; balance: number }
interface BalanceSheet { asOf: string; assets: { rows: TrialBalanceRow[]; total: number }; liabilities: { rows: TrialBalanceRow[]; total: number }; equity: { rows: TrialBalanceRow[]; total: number; netIncome: number }; balanced: boolean }
interface CashFlow { from: string; to: string; rows: Array<{ id: number; code: string; name: string; inflow: number; outflow: number; net: number }>; net: number; note?: string }

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"];
const RULE_SOURCES = ["pos_sales", "payroll", "inventory_purchase", "inventory_adjustment", "refund", "expense"];
const JOURNAL_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual", pos_sales: "POS Sales", payroll: "Payroll", inventory_purchase: "Inventory Purchase",
  inventory_adjustment: "Inventory Adjustment", refund: "Refund", expense: "Expense",
  vendor_bill: "Vendor Bill", vendor_bill_payment: "Bill Payment", ar_invoice: "AR Invoice",
  ar_receipt: "AR Receipt", bank_rec: "Bank Rec", opening_balance: "Opening Balance",
};

const fmtMoney = (v: number | string) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    posted: "bg-green-100 text-green-700",
    void: "bg-red-100 text-red-700",
    pending_approval: "bg-yellow-100 text-yellow-800",
    approved: "bg-blue-100 text-blue-700",
    scheduled: "bg-indigo-100 text-indigo-700",
    paid: "bg-green-100 text-green-700",
    open: "bg-blue-100 text-blue-700",
    partial: "bg-yellow-100 text-yellow-800",
    closed: "bg-red-100 text-red-700",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-700"}`}>{status.replace(/_/g, " ")}</span>;
}

export default function AccountingBooksPage() {
  const restaurantId = useRestaurantId();
  const [tab, setTab] = useState<Tab>("Chart of Accounts");

  if (!restaurantId) {
    return <Layout><div className="p-6">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <PageHeader title="Accounting Back Office" subtitle="Chart of accounts, journals, AP/AR, period close & statements" icon={BookOpen} />
      <div className="px-6 pt-4 border-b border-gray-200 bg-white flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${tab === t ? "border-orange-500 text-orange-600" : "border-transparent text-gray-600 hover:text-gray-900"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="p-6">
        {tab === "Chart of Accounts" && <CoaTab restaurantId={restaurantId} />}
        {tab === "Journals" && <JournalsTab restaurantId={restaurantId} />}
        {tab === "Vendor Bills (AP)" && <VendorBillsTab restaurantId={restaurantId} />}
        {tab === "AR Invoices" && <ArInvoicesTab restaurantId={restaurantId} />}
        {tab === "Mapping Rules" && <RulesTab restaurantId={restaurantId} />}
        {tab === "Period Close" && <PeriodsTab restaurantId={restaurantId} />}
        {tab === "Statements" && <StatementsTab restaurantId={restaurantId} />}
      </div>
    </Layout>
  );
}

// ─── Chart of Accounts Tab ────────────────────────────────────────────
function CoaTab({ restaurantId }: { restaurantId: number }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [templates, setTemplates] = useState<Array<{ key: string; label: string; accountCount: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", type: "asset", normalBalance: "debit" });

  const reload = async () => {
    setLoading(true);
    try {
      const [accs, tpls] = await Promise.all([
        apiGet<Account[]>(`/restaurants/${restaurantId}/accounting-books/coa`),
        apiGet<Array<{ key: string; label: string; accountCount: number }>>(`/restaurants/${restaurantId}/accounting-books/coa-templates`),
      ]);
      setAccounts(accs);
      setTemplates(tpls);
    } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [restaurantId]);

  const seed = async (template: string) => {
    try {
      const res = await apiPost<{ inserted: number }>(`/restaurants/${restaurantId}/accounting-books/coa/seed`, { template });
      toast({ title: "Template applied", description: `${res.inserted} accounts added` });
      await reload();
    } catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };

  const create = async () => {
    try {
      await apiPost(`/restaurants/${restaurantId}/accounting-books/coa`, form);
      setShowNew(false);
      setForm({ code: "", name: "", type: "asset", normalBalance: "debit" });
      await reload();
      toast({ title: "Account created" });
    } catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };

  const toggleActive = async (a: Account) => {
    await apiPatch(`/restaurants/${restaurantId}/accounting-books/coa/${a.id}`, { isActive: !a.isActive });
    await reload();
  };

  const grouped = useMemo(() => {
    const g: Record<string, Account[]> = {};
    for (const a of accounts) (g[a.type] = g[a.type] ?? []).push(a);
    return g;
  }, [accounts]);

  if (loading) return <div>Loading…</div>;

  if (accounts.length === 0) {
    return (
      <div className="max-w-2xl">
        <div className="bg-white border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-2">Start with a Chart of Accounts template</h3>
          <p className="text-sm text-gray-600 mb-4">Pick a starter pack appropriate for your business. You can edit, add or deactivate accounts afterwards.</p>
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.key} className="flex items-center justify-between border rounded p-3">
                <div>
                  <div className="font-medium">{t.label}</div>
                  <div className="text-xs text-gray-500">{t.accountCount} accounts</div>
                </div>
                <Button onClick={() => seed(t.key)}><Plus className="w-4 h-4 mr-1" /> Use</Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{accounts.length} accounts</h2>
        <Button onClick={() => setShowNew(true)} size="sm"><Plus className="w-4 h-4 mr-1" /> New Account</Button>
      </div>

      {showNew && (
        <div className="bg-white border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="6000" /></div>
          <div className="md:col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Type</Label>
            <select className="w-full border rounded h-10 px-2" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, normalBalance: ["asset", "expense"].includes(e.target.value) ? "debit" : "credit" })}>
              {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex gap-2"><Button onClick={create}>Save</Button><Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button></div>
        </div>
      )}

      <div className="space-y-4">
        {ACCOUNT_TYPES.map((type) => grouped[type] && (
          <div key={type} className="bg-white border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b font-semibold capitalize">{type} ({grouped[type].length})</div>
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b">
                <tr><th className="text-left px-4 py-2 w-24">Code</th><th className="text-left px-4 py-2">Name</th><th className="text-left px-4 py-2 w-32">Normal</th><th className="text-left px-4 py-2 w-24">Status</th><th className="px-4 py-2 w-24"></th></tr>
              </thead>
              <tbody>
                {grouped[type].map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono">{a.code}</td>
                    <td className="px-4 py-2">{a.name} {a.isSystem && <span className="text-xs text-gray-400 ml-1">(system)</span>}</td>
                    <td className="px-4 py-2 capitalize text-gray-600">{a.normalBalance}</td>
                    <td className="px-4 py-2">{a.isActive ? <span className="text-green-600">Active</span> : <span className="text-gray-400">Inactive</span>}</td>
                    <td className="px-4 py-2 text-right"><button className="text-xs text-orange-600 hover:underline" onClick={() => toggleActive(a)}>{a.isActive ? "Deactivate" : "Activate"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Journals Tab ─────────────────────────────────────────────────────
function JournalsTab({ restaurantId }: { restaurantId: number }) {
  const { toast } = useToast();
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{ entryDate: string; memo: string; lines: JournalLine[] }>({
    entryDate: today(), memo: "", lines: [{ accountId: 0, debit: 0, credit: 0 }, { accountId: 0, debit: 0, credit: 0 }],
  });

  const reload = async () => {
    setLoading(true);
    try {
      const [j, a] = await Promise.all([
        apiGet<Journal[]>(`/restaurants/${restaurantId}/accounting-books/journals?from=${from}&to=${to}`),
        apiGet<Account[]>(`/restaurants/${restaurantId}/accounting-books/coa`),
      ]);
      setJournals(j);
      setAccounts(a);
    } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [restaurantId, from, to]);

  const totalDr = draft.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCr = draft.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01 && totalDr > 0;

  const submit = async (status: "draft" | "posted") => {
    if (!balanced) { toast({ title: "Not balanced", description: `Debit ${totalDr} ≠ Credit ${totalCr}`, variant: "destructive" }); return; }
    try {
      await apiPost(`/restaurants/${restaurantId}/accounting-books/journals`, {
        entryDate: draft.entryDate, source: "manual", memo: draft.memo, status,
        lines: draft.lines.filter((l) => l.accountId > 0).map((l) => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })),
      });
      setShowNew(false);
      setDraft({ entryDate: today(), memo: "", lines: [{ accountId: 0, debit: 0, credit: 0 }, { accountId: 0, debit: 0, credit: 0 }] });
      await reload();
      toast({ title: status === "posted" ? "Journal posted" : "Draft saved" });
    } catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };

  const postJournal = async (id: number) => {
    try { await apiPost(`/restaurants/${restaurantId}/accounting-books/journals/${id}/post`); await reload(); toast({ title: "Posted" }); }
    catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };
  const voidJournal = async (id: number) => {
    if (!confirm("Void this journal?")) return;
    try { await apiPost(`/restaurants/${restaurantId}/accounting-books/journals/${id}/void`); await reload(); toast({ title: "Voided" }); }
    catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button onClick={() => setShowNew(!showNew)} size="sm"><Plus className="w-4 h-4 mr-1" /> New Journal</Button>
      </div>

      {showNew && (
        <div className="bg-white border rounded-lg p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div><Label>Date</Label><Input type="date" value={draft.entryDate} onChange={(e) => setDraft({ ...draft, entryDate: e.target.value })} /></div>
            <div className="md:col-span-2"><Label>Memo</Label><Input value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} placeholder="Optional description" /></div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500"><th className="text-left">Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th></th></tr></thead>
            <tbody>
              {draft.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <select className="w-full border rounded h-9 px-2" value={l.accountId} onChange={(e) => { const v = [...draft.lines]; v[i] = { ...v[i], accountId: Number(e.target.value) }; setDraft({ ...draft, lines: v }); }}>
                      <option value={0}>Select account…</option>
                      {accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2 w-32"><Input type="number" step="0.01" value={l.debit} onChange={(e) => { const v = [...draft.lines]; v[i] = { ...v[i], debit: e.target.value, credit: 0 }; setDraft({ ...draft, lines: v }); }} className="text-right" /></td>
                  <td className="py-1 pr-2 w-32"><Input type="number" step="0.01" value={l.credit} onChange={(e) => { const v = [...draft.lines]; v[i] = { ...v[i], credit: e.target.value, debit: 0 }; setDraft({ ...draft, lines: v }); }} className="text-right" /></td>
                  <td className="w-8"><button onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold text-sm"><td className="py-2">Total</td><td className="text-right">{totalDr.toFixed(2)}</td><td className="text-right">{totalCr.toFixed(2)}</td><td></td></tr>
            </tfoot>
          </table>
          <div className="flex items-center justify-between mt-3">
            <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { accountId: 0, debit: 0, credit: 0 }] })}><Plus className="w-4 h-4 mr-1" /> Add line</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => submit("draft")}>Save Draft</Button>
              <Button onClick={() => submit("posted")} disabled={!balanced}>Post Journal</Button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr>
            <th className="text-left px-4 py-2">Journal #</th><th className="text-left px-4 py-2">Date</th><th className="text-left px-4 py-2">Source</th><th className="text-left px-4 py-2">Memo</th><th className="text-right px-4 py-2">Amount</th><th className="text-left px-4 py-2">Status</th><th className="px-4 py-2"></th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="text-center py-6 text-gray-500">Loading…</td></tr> :
              journals.length === 0 ? <tr><td colSpan={7} className="text-center py-6 text-gray-500">No journals yet</td></tr> :
              journals.map((j) => (
                <tr key={j.id} className="border-t">
                  <td className="px-4 py-2 font-mono">{j.journalNo}</td>
                  <td className="px-4 py-2">{j.entryDate}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{JOURNAL_SOURCE_LABELS[j.source] ?? j.source}</td>
                  <td className="px-4 py-2 text-gray-600">{j.memo ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtMoney(j.totalDebit)}</td>
                  <td className="px-4 py-2"><StatusBadge status={j.status} /></td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {j.status === "draft" && <button onClick={() => postJournal(j.id)} className="text-xs text-blue-600 hover:underline mr-2">Post</button>}
                    {j.status !== "void" && <button onClick={() => voidJournal(j.id)} className="text-xs text-red-600 hover:underline">Void</button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Vendor Bills Tab ─────────────────────────────────────────────────
function VendorBillsTab({ restaurantId }: { restaurantId: number }) {
  const { toast } = useToast();
  const [bills, setBills] = useState<VendorBill[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [openBillId, setOpenBillId] = useState<number | null>(null);
  const [openBill, setOpenBill] = useState<VendorBillDetail | null>(null);

  const [draft, setDraft] = useState({
    billNo: "", vendorName: "", vendorEmail: "", billDate: today(), dueDate: today(),
    apAccountId: 0, expenseAccountId: 0, notes: "",
    lines: [{ description: "", quantity: 1, unitPrice: 0, taxRate: 0 }],
  });

  const reload = async () => {
    setLoading(true);
    try {
      const [b, a] = await Promise.all([
        apiGet<VendorBill[]>(`/restaurants/${restaurantId}/accounting-books/vendor-bills`),
        apiGet<Account[]>(`/restaurants/${restaurantId}/accounting-books/coa`),
      ]);
      setBills(b);
      setAccounts(a);
      if (a.length) {
        const ap = a.find((x) => x.code === "2000") ?? a.find((x) => x.type === "liability");
        const exp = a.find((x) => x.type === "expense");
        setDraft((d) => ({ ...d, apAccountId: d.apAccountId || ap?.id || 0, expenseAccountId: d.expenseAccountId || exp?.id || 0 }));
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [restaurantId]);
  useEffect(() => { if (openBillId) void apiGet<VendorBillDetail>(`/restaurants/${restaurantId}/accounting-books/vendor-bills/${openBillId}`).then(setOpenBill); else setOpenBill(null); }, [openBillId, restaurantId]);

  const subtotal = draft.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const tax = draft.lines.reduce((s, l) => s + (l.quantity * l.unitPrice * l.taxRate) / 100, 0);

  const createBill = async () => {
    try {
      await apiPost(`/restaurants/${restaurantId}/accounting-books/vendor-bills`, {
        ...draft, vendorEmail: draft.vendorEmail || null, apAccountId: draft.apAccountId || null, expenseAccountId: draft.expenseAccountId || null,
      });
      setShowNew(false);
      setDraft({ billNo: "", vendorName: "", vendorEmail: "", billDate: today(), dueDate: today(), apAccountId: draft.apAccountId, expenseAccountId: draft.expenseAccountId, notes: "", lines: [{ description: "", quantity: 1, unitPrice: 0, taxRate: 0 }] });
      await reload();
      toast({ title: "Bill created" });
    } catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };

  const action = async (id: number, op: string, body?: unknown) => {
    try {
      await apiPost(`/restaurants/${restaurantId}/accounting-books/vendor-bills/${id}/${op}`, body ?? {});
      await reload();
      if (openBillId === id) setOpenBill(await apiGet<VendorBillDetail>(`/restaurants/${restaurantId}/accounting-books/vendor-bills/${id}`));
      toast({ title: `Bill ${op}` });
    } catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{bills.length} vendor bills</h2>
        <Button onClick={() => setShowNew(!showNew)} size="sm"><Plus className="w-4 h-4 mr-1" /> New Bill</Button>
      </div>

      {showNew && (
        <div className="bg-white border rounded-lg p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div><Label>Bill #</Label><Input value={draft.billNo} onChange={(e) => setDraft({ ...draft, billNo: e.target.value })} /></div>
            <div><Label>Vendor</Label><Input value={draft.vendorName} onChange={(e) => setDraft({ ...draft, vendorName: e.target.value })} /></div>
            <div><Label>Bill Date</Label><Input type="date" value={draft.billDate} onChange={(e) => setDraft({ ...draft, billDate: e.target.value })} /></div>
            <div><Label>Due Date</Label><Input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></div>
            <div><Label>AP Account</Label>
              <select className="w-full border rounded h-10 px-2" value={draft.apAccountId} onChange={(e) => setDraft({ ...draft, apAccountId: Number(e.target.value) })}>
                <option value={0}>—</option>
                {accounts.filter((a) => a.type === "liability").map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div><Label>Expense Account</Label>
              <select className="w-full border rounded h-10 px-2" value={draft.expenseAccountId} onChange={(e) => setDraft({ ...draft, expenseAccountId: Number(e.target.value) })}>
                <option value={0}>—</option>
                {accounts.filter((a) => a.type === "expense").map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2"><Label>Email (optional)</Label><Input value={draft.vendorEmail} onChange={(e) => setDraft({ ...draft, vendorEmail: e.target.value })} /></div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500"><th className="text-left">Description</th><th className="text-right w-20">Qty</th><th className="text-right w-28">Unit Price</th><th className="text-right w-20">Tax %</th><th className="text-right w-32">Total</th><th></th></tr></thead>
            <tbody>
              {draft.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2"><Input value={l.description} onChange={(e) => { const v = [...draft.lines]; v[i] = { ...v[i], description: e.target.value }; setDraft({ ...draft, lines: v }); }} /></td>
                  <td className="py-1 pr-2"><Input type="number" step="0.001" value={l.quantity} onChange={(e) => { const v = [...draft.lines]; v[i] = { ...v[i], quantity: Number(e.target.value) }; setDraft({ ...draft, lines: v }); }} className="text-right" /></td>
                  <td className="py-1 pr-2"><Input type="number" step="0.01" value={l.unitPrice} onChange={(e) => { const v = [...draft.lines]; v[i] = { ...v[i], unitPrice: Number(e.target.value) }; setDraft({ ...draft, lines: v }); }} className="text-right" /></td>
                  <td className="py-1 pr-2"><Input type="number" step="0.01" value={l.taxRate} onChange={(e) => { const v = [...draft.lines]; v[i] = { ...v[i], taxRate: Number(e.target.value) }; setDraft({ ...draft, lines: v }); }} className="text-right" /></td>
                  <td className="py-1 pr-2 text-right font-mono">{((l.quantity * l.unitPrice) * (1 + l.taxRate / 100)).toFixed(2)}</td>
                  <td className="w-8"><button onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4 text-gray-400" /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t text-sm"><td className="py-1" colSpan={4}>Subtotal</td><td className="text-right font-mono">{subtotal.toFixed(2)}</td><td></td></tr>
              <tr><td className="py-1" colSpan={4}>Tax</td><td className="text-right font-mono">{tax.toFixed(2)}</td><td></td></tr>
              <tr className="font-semibold"><td className="py-2" colSpan={4}>Total</td><td className="text-right font-mono">{(subtotal + tax).toFixed(2)}</td><td></td></tr>
            </tfoot>
          </table>
          <div className="flex items-center justify-between mt-3">
            <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { description: "", quantity: 1, unitPrice: 0, taxRate: 0 }] })}><Plus className="w-4 h-4 mr-1" /> Add line</Button>
            <Button onClick={createBill}>Create Bill</Button>
          </div>
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr>
            <th className="text-left px-4 py-2">Bill #</th><th className="text-left px-4 py-2">Vendor</th><th className="text-left px-4 py-2">Bill Date</th><th className="text-left px-4 py-2">Due</th><th className="text-right px-4 py-2">Total</th><th className="text-right px-4 py-2">Paid</th><th className="text-left px-4 py-2">Status</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="text-center py-6 text-gray-500">Loading…</td></tr> :
              bills.length === 0 ? <tr><td colSpan={7} className="text-center py-6 text-gray-500">No bills yet</td></tr> :
              bills.map((b) => (
                <tr key={b.id} className="border-t cursor-pointer hover:bg-gray-50" onClick={() => setOpenBillId(b.id)}>
                  <td className="px-4 py-2 font-mono">{b.billNo}</td>
                  <td className="px-4 py-2">{b.vendorName}</td>
                  <td className="px-4 py-2">{b.billDate}</td>
                  <td className="px-4 py-2">{b.dueDate}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtMoney(b.totalAmount)}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtMoney(b.amountPaid)}</td>
                  <td className="px-4 py-2"><StatusBadge status={b.status} /></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {openBill && <BillDetailModal bill={openBill} accounts={accounts} onClose={() => setOpenBillId(null)} onAction={action} />}
    </div>
  );
}

function BillDetailModal({ bill, accounts, onClose, onAction }: { bill: VendorBillDetail; accounts: Account[]; onClose: () => void; onAction: (id: number, op: string, body?: unknown) => void }) {
  const [payAmount, setPayAmount] = useState(Number(bill.totalAmount) - Number(bill.amountPaid));
  const [payDate, setPayDate] = useState(today());
  const [bankId, setBankId] = useState(0);
  const [schedDate, setSchedDate] = useState(today());
  const bankOpts = accounts.filter((a) => a.type === "asset");

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <div><h3 className="text-lg font-semibold">{bill.billNo} — {bill.vendorName}</h3><div className="text-sm text-gray-500">{bill.billDate} • Due {bill.dueDate}</div></div>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-2 mb-4"><StatusBadge status={bill.status} /><span className="text-sm text-gray-500">Total {fmtMoney(bill.totalAmount)} • Paid {fmtMoney(bill.amountPaid)}</span></div>
          <table className="w-full text-sm mb-4">
            <thead className="text-xs text-gray-500"><tr><th className="text-left">Description</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Tax%</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {bill.lines.map((l, i) => <tr key={i} className="border-t"><td className="py-1">{l.description}</td><td className="text-right">{l.quantity}</td><td className="text-right">{fmtMoney(l.unitPrice)}</td><td className="text-right">{l.taxRate}%</td><td className="text-right font-mono">{fmtMoney(l.lineTotal)}</td></tr>)}
            </tbody>
          </table>

          <div className="flex flex-wrap gap-2 mb-4">
            {bill.status === "draft" && <Button size="sm" onClick={() => onAction(bill.id, "submit")}><Send className="w-4 h-4 mr-1" />Submit for Approval</Button>}
            {(bill.status === "pending_approval" || bill.status === "draft") && <Button size="sm" onClick={() => onAction(bill.id, "approve")}><CheckCircle2 className="w-4 h-4 mr-1" />Approve & Post</Button>}
            {bill.status !== "paid" && bill.status !== "void" && <Button variant="outline" size="sm" onClick={() => onAction(bill.id, "void")}><X className="w-4 h-4 mr-1" />Void</Button>}
          </div>

          {bill.status === "approved" && (
            <div className="bg-gray-50 border rounded p-3 mb-4">
              <Label className="text-xs">Schedule payment date</Label>
              <div className="flex gap-2 mt-1"><Input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} /><Button size="sm" onClick={() => onAction(bill.id, "schedule", { scheduledPayDate: schedDate })}><Calendar className="w-4 h-4 mr-1" />Schedule</Button></div>
            </div>
          )}

          {(bill.status === "approved" || bill.status === "scheduled") && (
            <div className="bg-blue-50 border rounded p-3 mb-4">
              <div className="font-medium mb-2">Record payment</div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div><Label className="text-xs">Date</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
                <div><Label className="text-xs">Amount</Label><Input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} /></div>
                <div><Label className="text-xs">Bank Account</Label>
                  <select className="w-full border rounded h-10 px-2" value={bankId} onChange={(e) => setBankId(Number(e.target.value))}>
                    <option value={0}>—</option>
                    {bankOpts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
              </div>
              <Button size="sm" onClick={() => onAction(bill.id, "pay", { paymentDate: payDate, amount: payAmount, bankAccountId: bankId || null })}><Wallet className="w-4 h-4 mr-1" />Pay</Button>
            </div>
          )}

          {bill.payments.length > 0 && (
            <div className="mb-2"><div className="font-medium text-sm mb-1">Payments</div>
              <table className="w-full text-sm"><thead><tr className="text-xs text-gray-500"><th className="text-left">Date</th><th className="text-left">Method</th><th className="text-right">Amount</th></tr></thead>
                <tbody>{bill.payments.map((p) => <tr key={p.id} className="border-t"><td className="py-1">{p.paymentDate}</td><td>{p.paymentMethod}</td><td className="text-right font-mono">{fmtMoney(p.amount)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AR Invoices Tab ──────────────────────────────────────────────────
function ArInvoicesTab({ restaurantId }: { restaurantId: number }) {
  const { toast } = useToast();
  const [invs, setInvs] = useState<ArInvoice[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ invoiceNo: "", customerName: "", invoiceDate: today(), dueDate: today(), subtotal: 0, taxAmount: 0, arAccountId: 0, incomeAccountId: 0 });

  const reload = async () => {
    setLoading(true);
    try {
      const [i, a] = await Promise.all([
        apiGet<ArInvoice[]>(`/restaurants/${restaurantId}/accounting-books/ar-invoices`),
        apiGet<Account[]>(`/restaurants/${restaurantId}/accounting-books/coa`),
      ]);
      setInvs(i);
      setAccounts(a);
      if (a.length) {
        const ar = a.find((x) => x.code === "1100") ?? a.find((x) => x.type === "asset");
        const inc = a.find((x) => x.type === "income");
        setDraft((d) => ({ ...d, arAccountId: d.arAccountId || ar?.id || 0, incomeAccountId: d.incomeAccountId || inc?.id || 0 }));
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [restaurantId]);

  const create = async () => {
    try {
      await apiPost(`/restaurants/${restaurantId}/accounting-books/ar-invoices`, { ...draft, arAccountId: draft.arAccountId || null, incomeAccountId: draft.incomeAccountId || null });
      setShowNew(false);
      setDraft({ ...draft, invoiceNo: "", customerName: "", subtotal: 0, taxAmount: 0 });
      await reload();
      toast({ title: "Invoice created" });
    } catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };

  const receive = async (inv: ArInvoice) => {
    const amount = Number(prompt(`Amount received (outstanding ₹${(Number(inv.totalAmount) - Number(inv.amountReceived)).toFixed(2)})`, String(Number(inv.totalAmount) - Number(inv.amountReceived))));
    if (!amount || amount <= 0) return;
    const bankCode = prompt("Bank account code (e.g. 1010)", "1010");
    const bank = accounts.find((a) => a.code === bankCode);
    if (!bank) { toast({ title: "Bank account not found", variant: "destructive" }); return; }
    try {
      await apiPost(`/restaurants/${restaurantId}/accounting-books/ar-invoices/${inv.id}/receive`, { amount, paymentDate: today(), bankAccountId: bank.id });
      await reload();
      toast({ title: "Receipt recorded" });
    } catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{invs.length} AR invoices</h2>
        <Button onClick={() => setShowNew(!showNew)} size="sm"><Plus className="w-4 h-4 mr-1" />New Invoice</Button>
      </div>
      {showNew && (
        <div className="bg-white border rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><Label>Invoice #</Label><Input value={draft.invoiceNo} onChange={(e) => setDraft({ ...draft, invoiceNo: e.target.value })} /></div>
          <div><Label>Customer</Label><Input value={draft.customerName} onChange={(e) => setDraft({ ...draft, customerName: e.target.value })} /></div>
          <div><Label>Invoice Date</Label><Input type="date" value={draft.invoiceDate} onChange={(e) => setDraft({ ...draft, invoiceDate: e.target.value })} /></div>
          <div><Label>Due Date</Label><Input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></div>
          <div><Label>Subtotal</Label><Input type="number" step="0.01" value={draft.subtotal} onChange={(e) => setDraft({ ...draft, subtotal: Number(e.target.value) })} /></div>
          <div><Label>Tax</Label><Input type="number" step="0.01" value={draft.taxAmount} onChange={(e) => setDraft({ ...draft, taxAmount: Number(e.target.value) })} /></div>
          <div><Label>AR Account</Label>
            <select className="w-full border rounded h-10 px-2" value={draft.arAccountId} onChange={(e) => setDraft({ ...draft, arAccountId: Number(e.target.value) })}>
              <option value={0}>—</option>{accounts.filter((a) => a.type === "asset").map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div><Label>Income Account</Label>
            <select className="w-full border rounded h-10 px-2" value={draft.incomeAccountId} onChange={(e) => setDraft({ ...draft, incomeAccountId: Number(e.target.value) })}>
              <option value={0}>—</option>{accounts.filter((a) => a.type === "income").map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button><Button onClick={create}>Create</Button></div>
        </div>
      )}
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-4 py-2">Invoice #</th><th className="text-left px-4 py-2">Customer</th><th className="text-left px-4 py-2">Date</th><th className="text-left px-4 py-2">Due</th><th className="text-right px-4 py-2">Total</th><th className="text-right px-4 py-2">Received</th><th className="text-left px-4 py-2">Status</th><th className="px-4 py-2"></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="text-center py-6 text-gray-500">Loading…</td></tr> :
              invs.length === 0 ? <tr><td colSpan={8} className="text-center py-6 text-gray-500">No invoices yet</td></tr> :
              invs.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="px-4 py-2 font-mono">{i.invoiceNo}</td>
                  <td className="px-4 py-2">{i.customerName}</td>
                  <td className="px-4 py-2">{i.invoiceDate}</td>
                  <td className="px-4 py-2">{i.dueDate}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtMoney(i.totalAmount)}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtMoney(i.amountReceived)}</td>
                  <td className="px-4 py-2"><StatusBadge status={i.status} /></td>
                  <td className="px-4 py-2 text-right">{i.status !== "paid" && <button onClick={() => receive(i)} className="text-xs text-blue-600 hover:underline">Record receipt</button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Rules Tab ────────────────────────────────────────────────────────
function RulesTab({ restaurantId }: { restaurantId: number }) {
  const { toast } = useToast();
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ source: "pos_sales", matchKey: "*", debitAccountId: 0, creditAccountId: 0, notes: "" });

  const reload = async () => {
    setLoading(true);
    try {
      const [r, a] = await Promise.all([
        apiGet<Rule[]>(`/restaurants/${restaurantId}/accounting-books/rules`),
        apiGet<Account[]>(`/restaurants/${restaurantId}/accounting-books/coa`),
      ]);
      setRules(r); setAccounts(a);
    } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [restaurantId]);

  const accLabel = (id: number | null) => { const a = accounts.find((x) => x.id === id); return a ? `${a.code} ${a.name}` : "—"; };

  const save = async () => {
    try {
      await apiPost(`/restaurants/${restaurantId}/accounting-books/rules`, { ...draft, debitAccountId: draft.debitAccountId || null, creditAccountId: draft.creditAccountId || null });
      await reload();
      toast({ title: "Rule saved" });
    } catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };

  const remove = async (id: number) => { if (!confirm("Delete rule?")) return; await apiDelete(`/restaurants/${restaurantId}/accounting-books/rules/${id}`); await reload(); };

  return (
    <div>
      <div className="bg-white border rounded-lg p-4 mb-4">
        <h3 className="font-semibold mb-3">Add / Update Auto-Posting Rule</h3>
        <p className="text-xs text-gray-500 mb-3">These rules drive automatic journal entries from POS sales, payroll, inventory, refunds, etc. Use match key <code className="bg-gray-100 px-1">*</code> for the default rule, or specific keys like <code className="bg-gray-100 px-1">payment_method=cash</code>.</p>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div><Label>Source</Label>
            <select className="w-full border rounded h-10 px-2" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}>
              {RULE_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div><Label>Match Key</Label><Input value={draft.matchKey} onChange={(e) => setDraft({ ...draft, matchKey: e.target.value })} /></div>
          <div><Label>Debit Account</Label>
            <select className="w-full border rounded h-10 px-2" value={draft.debitAccountId} onChange={(e) => setDraft({ ...draft, debitAccountId: Number(e.target.value) })}>
              <option value={0}>—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </div>
          <div><Label>Credit Account</Label>
            <select className="w-full border rounded h-10 px-2" value={draft.creditAccountId} onChange={(e) => setDraft({ ...draft, creditAccountId: Number(e.target.value) })}>
              <option value={0}>—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </div>
          <div className="flex items-end"><Button onClick={save}><Plus className="w-4 h-4 mr-1" />Save Rule</Button></div>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-4 py-2">Source</th><th className="text-left px-4 py-2">Match Key</th><th className="text-left px-4 py-2">Debit</th><th className="text-left px-4 py-2">Credit</th><th className="text-left px-4 py-2">Active</th><th className="px-4 py-2"></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-6 text-gray-500">Loading…</td></tr> :
              rules.length === 0 ? <tr><td colSpan={6} className="text-center py-6 text-gray-500">No rules — auto-posting disabled until rules are set</td></tr> :
              rules.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2">{r.source}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.matchKey}</td>
                  <td className="px-4 py-2 text-xs">{accLabel(r.debitAccountId)}</td>
                  <td className="px-4 py-2 text-xs">{accLabel(r.creditAccountId)}</td>
                  <td className="px-4 py-2">{r.isActive ? "Yes" : "No"}</td>
                  <td className="px-4 py-2 text-right"><button onClick={() => remove(r.id)} className="text-red-500"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Periods Tab ──────────────────────────────────────────────────────
function PeriodsTab({ restaurantId }: { restaurantId: number }) {
  const { toast } = useToast();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ periodStart: "", periodEnd: "", notes: "" });

  const reload = async () => {
    setLoading(true);
    try { setPeriods(await apiGet<Period[]>(`/restaurants/${restaurantId}/accounting-books/periods`)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [restaurantId]);

  const close = async () => {
    if (!form.periodStart || !form.periodEnd) { toast({ title: "Pick dates" }); return; }
    if (!confirm(`Lock all journals between ${form.periodStart} and ${form.periodEnd}? This prevents further postings in that range.`)) return;
    try {
      await apiPost(`/restaurants/${restaurantId}/accounting-books/periods/close`, form);
      setForm({ periodStart: "", periodEnd: "", notes: "" });
      await reload();
      toast({ title: "Period closed & locked" });
    } catch (err: unknown) { toast({ title: "Failed", description: String((err as Error).message), variant: "destructive" }); }
  };

  const reopen = async (id: number) => {
    if (!confirm("Reopen this period? Postings will be allowed again.")) return;
    await apiPost(`/restaurants/${restaurantId}/accounting-books/periods/${id}/reopen`);
    await reload();
    toast({ title: "Period reopened" });
  };

  return (
    <div>
      <div className="bg-white border rounded-lg p-4 mb-4">
        <h3 className="font-semibold mb-3 flex items-center"><Lock className="w-4 h-4 mr-1" />Lock a period</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><Label>Start</Label><Input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></div>
          <div><Label>End</Label><Input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={close}><Lock className="w-4 h-4 mr-1" />Close Period</Button></div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-4 py-2">Start</th><th className="text-left px-4 py-2">End</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Closed At</th><th className="text-left px-4 py-2">Notes</th><th className="px-4 py-2"></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-6 text-gray-500">Loading…</td></tr> :
              periods.length === 0 ? <tr><td colSpan={6} className="text-center py-6 text-gray-500">No periods locked</td></tr> :
              periods.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2">{p.periodStart}</td>
                  <td className="px-4 py-2">{p.periodEnd}</td>
                  <td className="px-4 py-2"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-2 text-gray-500">{p.closedAt?.slice(0, 10) ?? "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{p.notes ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{p.status === "closed" && <button onClick={() => reopen(p.id)} className="text-xs text-blue-600 hover:underline flex items-center justify-end"><Unlock className="w-3 h-3 mr-1" />Reopen</button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Statements Tab ───────────────────────────────────────────────────
function StatementsTab({ restaurantId }: { restaurantId: number }) {
  const [view, setView] = useState<"trial" | "balance" | "cash">("trial");
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [tb, setTb] = useState<TrialBalanceRow[] | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [cf, setCf] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      if (view === "trial") {
        const r = await apiGet<{ rows: TrialBalanceRow[] }>(`/restaurants/${restaurantId}/accounting-books/statements/trial-balance?from=${from}&to=${to}`);
        setTb(r.rows);
      } else if (view === "balance") {
        setBs(await apiGet<BalanceSheet>(`/restaurants/${restaurantId}/accounting-books/statements/balance-sheet?asOf=${to}`));
      } else {
        setCf(await apiGet<CashFlow>(`/restaurants/${restaurantId}/accounting-books/statements/cash-flow?from=${from}&to=${to}`));
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [restaurantId, view, from, to]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex border rounded overflow-hidden">
          <button onClick={() => setView("trial")} className={`px-3 py-1 text-sm ${view === "trial" ? "bg-orange-500 text-white" : "bg-white"}`}>Trial Balance</button>
          <button onClick={() => setView("balance")} className={`px-3 py-1 text-sm ${view === "balance" ? "bg-orange-500 text-white" : "bg-white"}`}>Balance Sheet</button>
          <button onClick={() => setView("cash")} className={`px-3 py-1 text-sm ${view === "cash" ? "bg-orange-500 text-white" : "bg-white"}`}>Cash Flow</button>
        </div>
        {view !== "balance" && <><div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div></>}
        <div><Label className="text-xs">{view === "balance" ? "As of" : "To"}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {loading && <div className="text-gray-500">Loading…</div>}

      {!loading && view === "trial" && tb && (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-4 py-2 w-20">Code</th><th className="text-left px-4 py-2">Account</th><th className="text-left px-4 py-2 w-24">Type</th><th className="text-right px-4 py-2">Debit</th><th className="text-right px-4 py-2">Credit</th><th className="text-right px-4 py-2">Balance</th></tr></thead>
            <tbody>
              {tb.map((r) => (
                <tr key={r.accountId} className="border-t">
                  <td className="px-4 py-2 font-mono">{r.code}</td>
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 capitalize">{r.type}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.debit ? fmtMoney(r.debit) : "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.credit ? fmtMoney(r.credit) : "—"}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{fmtMoney(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold">
              <tr><td colSpan={3} className="px-4 py-2">Totals</td>
                <td className="px-4 py-2 text-right font-mono">{fmtMoney(tb.reduce((s, r) => s + r.debit, 0))}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtMoney(tb.reduce((s, r) => s + r.credit, 0))}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && view === "balance" && bs && (
        <div className="space-y-4">
          {!bs.balanced && <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded text-sm">Warning: Balance sheet does not balance. Some entries may not have offsetting postings.</div>}
          {[
            { title: "Assets", group: bs.assets, sign: "" },
            { title: "Liabilities", group: bs.liabilities, sign: "" },
            { title: `Equity (incl. net income ${fmtMoney(bs.equity.netIncome)})`, group: bs.equity, sign: "" },
          ].map((g) => (
            <div key={g.title} className="bg-white border rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b font-semibold">{g.title}</div>
              <table className="w-full text-sm">
                <tbody>
                  {g.group.rows.filter((r) => Math.abs(r.balance) > 0.001).map((r) => (
                    <tr key={r.accountId} className="border-t"><td className="px-4 py-1 font-mono w-20">{r.code}</td><td className="px-4 py-1">{r.name}</td><td className="px-4 py-1 text-right font-mono">{fmtMoney(r.balance)}</td></tr>
                  ))}
                  <tr className="border-t font-semibold bg-gray-50"><td className="px-4 py-2" colSpan={2}>Total {g.title.split(" ")[0]}</td><td className="px-4 py-2 text-right font-mono">{fmtMoney(g.group.total + (g.title.startsWith("Equity") ? bs.equity.netIncome : 0))}</td></tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {!loading && view === "cash" && cf && (
        <div className="bg-white border rounded-lg overflow-hidden">
          {cf.note && <div className="p-3 bg-yellow-50 text-yellow-800 text-sm">{cf.note}</div>}
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Account</th><th className="text-right px-4 py-2">Inflow</th><th className="text-right px-4 py-2">Outflow</th><th className="text-right px-4 py-2">Net</th></tr></thead>
            <tbody>
              {cf.rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2 font-mono">{r.code}</td>
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-4 py-2 text-right font-mono text-green-600">{fmtMoney(r.inflow)}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-600">{fmtMoney(r.outflow)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{fmtMoney(r.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold"><tr><td colSpan={4} className="px-4 py-2">Net change in cash</td><td className="px-4 py-2 text-right font-mono">{fmtMoney(cf.net)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
