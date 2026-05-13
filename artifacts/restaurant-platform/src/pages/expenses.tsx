import { useState, useMemo } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useExpenses, useCreateExpense, useUpdateExpense, useDeleteExpense,
  useExpenseCategories, useCreateExpenseCategory, useUpdateExpenseCategory, useDeleteExpenseCategory,
  useRecurringExpenses, useCreateRecurringExpense, useUpdateRecurringExpense, useDeleteRecurringExpense,
  useExpenseSummary,
} from "@/lib/hooks";
import { Plus, Pencil, Trash2, X, Receipt, RefreshCw, Tag, Search, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Expense, ExpenseCategory, RecurringExpense } from "@/lib/types";

const TABS = ["Expenses", "Recurring", "Categories"] as const;
type Tab = typeof TABS[number];

const PALETTE = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#ec4899", "#64748b"];
const FREQUENCIES = ["weekly", "monthly", "yearly"];
const PAYMENT_METHODS = ["cash", "card", "upi", "bank transfer", "cheque", "other"];

function fmtMoney(v: string | number) {
  return `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthAgoStr() { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); }

function ExpensesTab() {
  const { toast } = useToast();
  const [from, setFrom] = useState(monthAgoStr());
  const [to, setTo] = useState(todayStr());
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  const { data: cats = [] } = useExpenseCategories();
  const { data: exp } = useExpenses({ from, to, categoryId: categoryId || undefined, search: search || undefined });
  const { data: summary } = useExpenseSummary({ from, to });
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const del = useDeleteExpense();

  const catMap = useMemo(() => new Map(cats.map(c => [c.id, c])), [cats]);
  const items = exp?.data ?? [];

  const [form, setForm] = useState({
    categoryId: "", amount: "", expenseDate: todayStr(),
    payee: "", paymentMethod: "cash", notes: "", receiptUrl: "",
  });

  const resetForm = () => setForm({ categoryId: "", amount: "", expenseDate: todayStr(), payee: "", paymentMethod: "cash", notes: "", receiptUrl: "" });

  const handleSubmit = async () => {
    if (!form.categoryId || !form.amount) {
      toast({ title: "Category and amount required", variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          categoryId: Number(form.categoryId),
          amount: form.amount,
          expenseDate: form.expenseDate,
          payee: form.payee || undefined,
          paymentMethod: form.paymentMethod || undefined,
          notes: form.notes || undefined,
          receiptUrl: form.receiptUrl || undefined,
        });
        toast({ title: "Expense updated" });
      } else {
        await create.mutateAsync({
          categoryId: Number(form.categoryId),
          amount: form.amount,
          expenseDate: form.expenseDate,
          payee: form.payee || undefined,
          paymentMethod: form.paymentMethod || undefined,
          notes: form.notes || undefined,
          receiptUrl: form.receiptUrl || undefined,
        });
        toast({ title: "Expense recorded" });
      }
      setShowAdd(false); setEditing(null); resetForm();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    }
  };

  const startEdit = (e: Expense) => {
    setEditing(e);
    setForm({
      categoryId: String(e.categoryId), amount: e.amount, expenseDate: e.expenseDate,
      payee: e.payee ?? "", paymentMethod: e.paymentMethod ?? "cash",
      notes: e.notes ?? "", receiptUrl: e.receiptUrl ?? "",
    });
    setShowAdd(true);
  };

  const handleDelete = async (e: Expense) => {
    if (!confirm(`Delete this expense of ${fmtMoney(e.amount)}?`)) return;
    try { await del.mutateAsync(e.id); toast({ title: "Expense deleted" }); }
    catch { toast({ title: "Failed to delete", variant: "destructive" }); }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm text-muted-foreground">Total in Range</p>
          <p className="text-2xl font-bold text-foreground mt-1">{fmtMoney(exp?.totalAmount ?? "0")}</p>
          <p className="text-xs text-muted-foreground mt-1">{exp?.total ?? 0} entries</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 sm:col-span-2">
          <p className="text-sm text-muted-foreground mb-2">By Category</p>
          {summary?.byCategory.length ? (
            <div className="flex flex-wrap gap-2">
              {summary.byCategory.map(c => (
                <div key={c.categoryId} className="flex items-center gap-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                  <span className="text-foreground font-medium">{c.categoryName}</span>
                  <span className="text-muted-foreground">{fmtMoney(c.total)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">No expenses yet</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40 h-9" />
          <span className="text-muted-foreground text-sm">to</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40 h-9" />
        </div>
        <select value={categoryId} onChange={e => setCategoryId(e.target.value ? Number(e.target.value) : "")}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm">
          <option value="">All Categories</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search payee or notes…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Button size="sm" onClick={() => { setEditing(null); resetForm(); setShowAdd(true); }}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Expense
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Date</th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Category</th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Payee</th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Method</th>
              <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Amount</th>
              <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(e => {
              const cat = catMap.get(e.categoryId);
              return (
                <tr key={e.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-2.5 text-foreground">{fmtDate(e.expenseDate)}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{ background: `${cat?.color ?? "#64748b"}20`, color: cat?.color ?? "#64748b" }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cat?.color ?? "#64748b" }} />
                      {cat?.name ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-foreground">{e.payee ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground capitalize">{e.paymentMethod ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-foreground">{fmtMoney(e.amount)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => startEdit(e)} className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(e)} className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-destructive/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No expenses in this range</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setShowAdd(false); setEditing(null); }}>
          <div className="bg-card rounded-xl border border-border w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">{editing ? "Edit Expense" : "Record Expense"}</h3>
              <button onClick={() => { setShowAdd(false); setEditing(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Category</Label>
                  <select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}
                    className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm mt-1">
                    <option value="">Select…</option>
                    {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Amount (₹)</Label>
                  <Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={form.expenseDate} onChange={e => setForm({ ...form, expenseDate: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <Label>Payment Method</Label>
                  <select value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })}
                    className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm mt-1 capitalize">
                    {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <Label>Payee / Vendor</Label>
                <Input value={form.payee} onChange={e => setForm({ ...form, payee: e.target.value })} className="mt-1" placeholder="e.g. ABC Suppliers" />
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>Receipt URL (optional)</Label>
                <Input value={form.receiptUrl} onChange={e => setForm({ ...form, receiptUrl: e.target.value })} className="mt-1" placeholder="https://…" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>
                {editing ? "Save" : "Record"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecurringTab() {
  const { toast } = useToast();
  const { data: cats = [] } = useExpenseCategories();
  const { data: templates = [] } = useRecurringExpenses();
  const create = useCreateRecurringExpense();
  const update = useUpdateRecurringExpense();
  const del = useDeleteRecurringExpense();

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [form, setForm] = useState({
    name: "", categoryId: "", amount: "", frequency: "monthly",
    dayOfMonth: "1", payee: "", paymentMethod: "cash", notes: "", nextRunDate: todayStr(),
  });

  const catMap = useMemo(() => new Map(cats.map(c => [c.id, c])), [cats]);

  const resetForm = () => setForm({ name: "", categoryId: "", amount: "", frequency: "monthly", dayOfMonth: "1", payee: "", paymentMethod: "cash", notes: "", nextRunDate: todayStr() });

  const handleSubmit = async () => {
    if (!form.name || !form.categoryId || !form.amount) {
      toast({ title: "Name, category, amount required", variant: "destructive" }); return;
    }
    try {
      const data = {
        name: form.name,
        categoryId: Number(form.categoryId),
        amount: form.amount,
        frequency: form.frequency,
        dayOfMonth: Number(form.dayOfMonth) || 1,
        payee: form.payee || undefined,
        paymentMethod: form.paymentMethod,
        notes: form.notes || undefined,
        nextRunDate: form.nextRunDate,
      };
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...data });
        toast({ title: "Template updated" });
      } else {
        await create.mutateAsync(data);
        toast({ title: "Template created" });
      }
      setShowAdd(false); setEditing(null); resetForm();
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
  };

  const startEdit = (t: RecurringExpense) => {
    setEditing(t);
    setForm({
      name: t.name, categoryId: String(t.categoryId), amount: t.amount,
      frequency: t.frequency, dayOfMonth: String(t.dayOfMonth),
      payee: t.payee ?? "", paymentMethod: t.paymentMethod ?? "cash",
      notes: t.notes ?? "", nextRunDate: t.nextRunDate,
    });
    setShowAdd(true);
  };

  const handleToggle = async (t: RecurringExpense) => {
    await update.mutateAsync({ id: t.id, isActive: !t.isActive });
  };

  const handleDelete = async (t: RecurringExpense) => {
    if (!confirm(`Delete recurring template "${t.name}"?`)) return;
    try { await del.mutateAsync(t.id); toast({ title: "Template deleted" }); }
    catch { toast({ title: "Failed to delete", variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Templates auto-generate expense entries on schedule.</p>
        <Button size="sm" onClick={() => { setEditing(null); resetForm(); setShowAdd(true); }}>
          <Plus className="w-4 h-4 mr-1.5" /> New Template
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {templates.map(t => {
          const cat = catMap.get(t.categoryId);
          return (
            <div key={t.id} className={cn("bg-card border rounded-xl p-4", t.isActive ? "border-border" : "border-border opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                    <h4 className="font-semibold text-foreground truncate">{t.name}</h4>
                  </div>
                  <p className="text-xs text-muted-foreground capitalize">{t.frequency} · day {t.dayOfMonth}</p>
                </div>
                <p className="text-lg font-bold text-foreground">{fmtMoney(t.amount)}</p>
              </div>
              <div className="flex items-center gap-2 mt-3 text-xs">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full"
                  style={{ background: `${cat?.color ?? "#64748b"}20`, color: cat?.color ?? "#64748b" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: cat?.color ?? "#64748b" }} />
                  {cat?.name ?? "—"}
                </span>
                <span className="text-muted-foreground">Next: {fmtDate(t.nextRunDate)}</span>
              </div>
              <div className="flex justify-between items-center mt-3 pt-3 border-t border-border">
                <button onClick={() => handleToggle(t)} className={cn("text-xs font-medium px-2 py-1 rounded", t.isActive ? "text-green-600 bg-green-50" : "text-muted-foreground bg-muted")}>
                  {t.isActive ? "● Active" : "○ Paused"}
                </button>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(t)} className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(t)} className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-destructive/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {templates.length === 0 && (
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
            No recurring templates yet
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setShowAdd(false); setEditing(null); }}>
          <div className="bg-card rounded-xl border border-border w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">{editing ? "Edit Template" : "New Recurring Template"}</h3>
              <button onClick={() => { setShowAdd(false); setEditing(null); }} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1" placeholder="e.g. Monthly Rent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Category</Label>
                  <select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })} className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm mt-1">
                    <option value="">Select…</option>
                    {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Amount (₹)</Label>
                  <Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Frequency</Label>
                  <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm mt-1 capitalize">
                    {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Day of Month</Label>
                  <Input type="number" min="1" max="31" value={form.dayOfMonth} onChange={e => setForm({ ...form, dayOfMonth: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <Label>Next Run</Label>
                  <Input type="date" value={form.nextRunDate} onChange={e => setForm({ ...form, nextRunDate: e.target.value })} className="mt-1" />
                </div>
              </div>
              <div>
                <Label>Payee</Label>
                <Input value={form.payee} onChange={e => setForm({ ...form, payee: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>{editing ? "Save" : "Create"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoriesTab() {
  const { toast } = useToast();
  const { data: cats = [] } = useExpenseCategories();
  const create = useCreateExpenseCategory();
  const update = useUpdateExpenseCategory();
  const del = useDeleteExpenseCategory();

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [form, setForm] = useState({ name: "", color: PALETTE[0] });

  const handleSubmit = async () => {
    if (!form.name) { toast({ title: "Name required", variant: "destructive" }); return; }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, name: form.name, color: form.color });
        toast({ title: "Category updated" });
      } else {
        await create.mutateAsync({ name: form.name, color: form.color });
        toast({ title: "Category created" });
      }
      setShowAdd(false); setEditing(null); setForm({ name: "", color: PALETTE[0] });
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
  };

  const handleDelete = async (c: ExpenseCategory) => {
    if (!confirm(`Archive category "${c.name}"?`)) return;
    try { await del.mutateAsync(c.id); toast({ title: "Category archived" }); }
    catch { toast({ title: "Failed", variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Group your expenses for clearer reporting.</p>
        <Button size="sm" onClick={() => { setEditing(null); setForm({ name: "", color: PALETTE[0] }); setShowAdd(true); }}>
          <Plus className="w-4 h-4 mr-1.5" /> New Category
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {cats.filter(c => c.isActive).map(c => (
          <div key={c.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${c.color}20` }}>
              <Tag className="w-5 h-5" style={{ color: c.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{c.name}</p>
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={() => { setEditing(c); setForm({ name: c.name, color: c.color }); setShowAdd(true); }} className="p-1 text-muted-foreground hover:text-foreground">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(c)} className="p-1 text-muted-foreground hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setShowAdd(false); setEditing(null); }}>
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">{editing ? "Edit Category" : "New Category"}</h3>
              <button onClick={() => { setShowAdd(false); setEditing(null); }} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex gap-2 mt-2">
                  {PALETTE.map(c => (
                    <button key={c} onClick={() => setForm({ ...form, color: c })}
                      className={cn("w-7 h-7 rounded-full border-2 transition-all", form.color === c ? "border-foreground scale-110" : "border-transparent")}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</Button>
              <Button onClick={handleSubmit}>{editing ? "Save" : "Create"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExpensesPage() {
  const [tab, setTab] = useState<Tab>("Expenses");
  return (
    <Layout>
      <PageHeader title="Expenses" subtitle="Track everything you spend money on" />
      <div className="p-6 space-y-5">
        <div className="flex gap-1 border-b border-border">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t === "Expenses" && <Receipt className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}
              {t === "Recurring" && <RefreshCw className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}
              {t === "Categories" && <Tag className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}
              {t}
            </button>
          ))}
        </div>
        {tab === "Expenses" && <ExpensesTab />}
        {tab === "Recurring" && <RecurringTab />}
        {tab === "Categories" && <CategoriesTab />}
      </div>
    </Layout>
  );
}
