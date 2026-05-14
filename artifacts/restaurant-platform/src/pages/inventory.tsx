import { useState, Fragment } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useInventory, useCreateInventoryItem, useUpdateInventoryItem, useDeleteInventoryItem,
  useAdjustInventory, useInventoryTransactions, useWasteLog,
  useSuppliers, useCreateSupplier, useUpdateSupplier, useDeleteSupplier,
  usePurchaseOrders, useCreatePurchaseOrder, useUpdatePurchaseOrder, useUpdatePurchaseOrderItems, useDeletePurchaseOrder,
  useRestaurantInfo, useUpdateRestaurant, useRunAutoReorder,
  useAggregateInventory,
} from "@/lib/hooks";
import { useBranchContext } from "@/lib/branch";
import { BranchSwitcher } from "@/components/layout/BranchSwitcher";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, AlertTriangle, Search, Pencil, Trash2, X,
  Package, Truck, ClipboardList, ArrowUpCircle, ArrowDownCircle,
  Building2, Phone, Mail, MapPin, RefreshCw, Flame, Sparkles, Settings, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { InventoryItem, Supplier, PurchaseOrder, InventoryTransaction } from "@/lib/types";

const TABS = ["Stock", "Suppliers", "Purchase Orders", "Waste Log", "Settings"] as const;
type Tab = typeof TABS[number];

const CATEGORIES = ["general", "produce", "meat", "dairy", "dry goods", "beverages", "spices", "oils", "packaging"];
const UNITS = ["kg", "g", "litre", "ml", "pcs", "dozen", "box", "bag"];

function stockColor(item: InventoryItem) {
  const cur = Number(item.currentStock);
  const min = Number(item.minStockLevel);
  if (cur <= min) return "text-red-600 bg-red-50";
  if (cur <= min * 1.5) return "text-yellow-700 bg-yellow-50";
  return "text-green-700 bg-green-50";
}

function stockBarColor(item: InventoryItem) {
  const cur = Number(item.currentStock);
  const min = Number(item.minStockLevel);
  if (cur <= min) return "bg-red-500";
  if (cur <= min * 1.5) return "bg-yellow-400";
  return "bg-green-500";
}

function stockPercent(item: InventoryItem): number {
  const cur = Number(item.currentStock);
  const min = Number(item.minStockLevel);
  const max = Math.max(min * 3, 1);
  return Math.min(100, (cur / max) * 100);
}

const PO_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  ordered: { label: "Ordered", color: "bg-blue-100 text-blue-700 border-blue-200" },
  received: { label: "Received", color: "bg-green-100 text-green-700 border-green-200" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-600 border-gray-200" },
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function StockTab() {
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);

  const { data: items = [] } = useInventory({ lowStock: lowStockOnly || undefined, search: search || undefined });
  const { data: suppliers = [] } = useSuppliers();
  const createItem = useCreateInventoryItem();
  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();
  const adjustInventory = useAdjustInventory();
  const { toast } = useToast();

  const [form, setForm] = useState({ name: "", unit: "kg", currentStock: "0", minStockLevel: "1", costPerUnit: "0", category: "general", supplierId: "", parLevel: "", reorderQuantity: "", autoReorderEnabled: true });
  const [adjustForm, setAdjustForm] = useState({ type: "add", quantity: "", notes: "" });

  const { data: transactions = [] } = useInventoryTransactions(historyItem?.id ?? null);

  const lowStockCount = items.filter((i: InventoryItem) => i.isLowStock).length;

  const handleAdd = async () => {
    if (!form.name) return;
    try {
      await createItem.mutateAsync({
        name: form.name, unit: form.unit, currentStock: form.currentStock,
        minStockLevel: form.minStockLevel, costPerUnit: form.costPerUnit, category: form.category,
        supplierId: form.supplierId ? Number(form.supplierId) : undefined,
        parLevel: form.parLevel ? form.parLevel : null,
        reorderQuantity: form.reorderQuantity ? form.reorderQuantity : null,
        autoReorderEnabled: form.autoReorderEnabled,
      });
      toast({ title: "Item added!" });
      setShowAdd(false);
      setForm({ name: "", unit: "kg", currentStock: "0", minStockLevel: "1", costPerUnit: "0", category: "general", supplierId: "", parLevel: "", reorderQuantity: "", autoReorderEnabled: true });
    } catch {
      toast({ title: "Failed to add item", variant: "destructive" });
    }
  };

  const handleEdit = async () => {
    if (!editItem) return;
    try {
      await updateItem.mutateAsync({
        id: editItem.id, name: editItem.name, unit: editItem.unit,
        minStockLevel: editItem.minStockLevel, costPerUnit: editItem.costPerUnit,
        category: editItem.category ?? "general",
        supplierId: editItem.supplierId,
        parLevel: editItem.parLevel,
        reorderQuantity: editItem.reorderQuantity,
        autoReorderEnabled: editItem.autoReorderEnabled,
      });
      toast({ title: "Item updated!" });
      setEditItem(null);
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const handleToggleAutoReorder = async (item: InventoryItem) => {
    try {
      await updateItem.mutateAsync({ id: item.id, autoReorderEnabled: !item.autoReorderEnabled });
      toast({ title: item.autoReorderEnabled ? "Auto-reorder paused" : "Auto-reorder enabled" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const handleDelete = async (item: InventoryItem) => {
    if (!confirm(`Remove "${item.name}" from inventory?`)) return;
    try {
      await deleteItem.mutateAsync(item.id);
      toast({ title: "Item removed" });
    } catch {
      toast({ title: "Failed to remove", variant: "destructive" });
    }
  };

  const handleAdjust = async () => {
    if (!adjustItem || !adjustForm.quantity) return;
    try {
      await adjustInventory.mutateAsync({ id: adjustItem.id, ...adjustForm });
      toast({ title: "Stock adjusted!" });
      setAdjustItem(null);
    } catch {
      toast({ title: "Failed to adjust stock", variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex gap-3 mb-5 flex-wrap items-center justify-between">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-52" />
          </div>
          <button onClick={() => setLowStockOnly(!lowStockOnly)} className={cn("flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors", lowStockOnly ? "bg-red-100 border-red-300 text-red-700" : "border-border text-muted-foreground hover:bg-muted/50")}>
            <AlertTriangle className="w-3.5 h-3.5" /> Low Stock Only
          </button>
          {lowStockCount > 0 && <span className="text-sm text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {lowStockCount} items need restocking</span>}
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Item
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Item</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Category</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Stock Level</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Min / Cost</th>
              <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: InventoryItem) => (
              <tr key={item.id} className={cn("border-b border-border last:border-0 hover:bg-muted/10 transition-colors", item.isLowStock && "bg-red-50/40")}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {item.isLowStock && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium">{item.name}</p>
                        {item.autoReorderEnabled && item.supplierId && (
                          <span title="Auto-reorder enabled" className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                            <Sparkles className="w-2.5 h-2.5" /> Auto
                          </span>
                        )}
                      </div>
                      <div className="w-28 h-1.5 bg-muted rounded-full mt-1.5">
                        <div className={cn("h-full rounded-full transition-all", stockBarColor(item))} style={{ width: `${stockPercent(item)}%` }} />
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-xs capitalize bg-muted/50 px-2 py-0.5 rounded-full text-muted-foreground">{item.category ?? "general"}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("text-sm font-semibold px-2 py-0.5 rounded-md", stockColor(item))}>
                    {Number(item.currentStock).toFixed(1)} {item.unit}
                  </span>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>Min: {Number(item.minStockLevel).toFixed(1)} {item.unit}</p>
                    <p>₹{Number(item.costPerUnit).toFixed(2)}/{item.unit}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <Button size="sm" variant="ghost" className={cn("h-7 px-2", item.autoReorderEnabled ? "text-emerald-600" : "text-muted-foreground")} onClick={() => handleToggleAutoReorder(item)} title={item.autoReorderEnabled ? "Disable auto-reorder" : "Enable auto-reorder"}>
                      <Sparkles className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setHistoryItem(item)} title="View history">
                      <ClipboardList className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditItem({ ...item })} title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAdjustItem(item)}>Adjust</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(item)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-2 opacity-20" />
                No inventory items yet
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Inventory Item</h2>
              <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><Label>Item Name *</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Chicken Breast" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Unit</Label>
                  <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Category</Label>
                  <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><Label>Current Stock</Label><Input type="number" min="0" value={form.currentStock} onChange={e => setForm(p => ({ ...p, currentStock: e.target.value }))} /></div>
                <div><Label>Min Level</Label><Input type="number" min="0" value={form.minStockLevel} onChange={e => setForm(p => ({ ...p, minStockLevel: e.target.value }))} /></div>
                <div className="col-span-2"><Label>Cost per Unit (₹)</Label><Input type="number" min="0" step="0.01" value={form.costPerUnit} onChange={e => setForm(p => ({ ...p, costPerUnit: e.target.value }))} /></div>
              </div>
              <div>
                <Label>Preferred Supplier (for auto-reorder)</Label>
                <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.supplierId} onChange={e => setForm(p => ({ ...p, supplierId: e.target.value }))}>
                  <option value="">None</option>
                  {(suppliers as Supplier[]).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Par Level (optional)</Label><Input type="number" min="0" step="0.001" value={form.parLevel} onChange={e => setForm(p => ({ ...p, parLevel: e.target.value }))} placeholder="e.g. 10" /></div>
                <div><Label>Reorder Qty (optional)</Label><Input type="number" min="0" step="0.001" value={form.reorderQuantity} onChange={e => setForm(p => ({ ...p, reorderQuantity: e.target.value }))} placeholder="defaults to par − stock" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm pt-1 cursor-pointer">
                <input type="checkbox" checked={form.autoReorderEnabled} onChange={e => setForm(p => ({ ...p, autoReorderEnabled: e.target.checked }))} />
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> Auto-draft a PO when this item drops below min
              </label>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAdd} disabled={createItem.isPending || !form.name}>Add Item</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Edit Item</h2>
              <button onClick={() => setEditItem(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={editItem.name} onChange={e => setEditItem(p => p && ({ ...p, name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Unit</Label>
                  <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={editItem.unit} onChange={e => setEditItem(p => p && ({ ...p, unit: e.target.value }))}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Category</Label>
                  <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={editItem.category ?? "general"} onChange={e => setEditItem(p => p && ({ ...p, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><Label>Min Level</Label><Input type="number" value={editItem.minStockLevel} onChange={e => setEditItem(p => p && ({ ...p, minStockLevel: e.target.value }))} /></div>
                <div><Label>Cost/Unit (₹)</Label><Input type="number" value={editItem.costPerUnit} onChange={e => setEditItem(p => p && ({ ...p, costPerUnit: e.target.value }))} /></div>
                <div><Label>Par Level</Label><Input type="number" step="0.001" value={editItem.parLevel ?? ""} onChange={e => setEditItem(p => p && ({ ...p, parLevel: e.target.value || null }))} placeholder="optional" /></div>
                <div><Label>Reorder Qty</Label><Input type="number" step="0.001" value={editItem.reorderQuantity ?? ""} onChange={e => setEditItem(p => p && ({ ...p, reorderQuantity: e.target.value || null }))} placeholder="optional" /></div>
              </div>
              <div>
                <Label>Preferred Supplier</Label>
                <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={editItem.supplierId ?? ""} onChange={e => setEditItem(p => p && ({ ...p, supplierId: e.target.value ? Number(e.target.value) : null }))}>
                  <option value="">None</option>
                  {(suppliers as Supplier[]).filter(s => s.isActive).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm pt-1 cursor-pointer">
                <input type="checkbox" checked={editItem.autoReorderEnabled} onChange={e => setEditItem(p => p && ({ ...p, autoReorderEnabled: e.target.checked }))} />
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> Auto-draft a PO when this item drops below min
              </label>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setEditItem(null)}>Cancel</Button>
                <Button className="flex-1" onClick={handleEdit} disabled={updateItem.isPending}>Save Changes</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {adjustItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold">Adjust Stock</h2>
              <button onClick={() => setAdjustItem(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{adjustItem.name} — Current: <span className="font-semibold text-foreground">{Number(adjustItem.currentStock).toFixed(1)} {adjustItem.unit}</span></p>
            <div className="space-y-3">
              <div>
                <Label>Adjustment Type</Label>
                <div className="flex gap-2 mt-1">
                  {[{ key: "add", icon: ArrowUpCircle, label: "Add" }, { key: "remove", icon: ArrowDownCircle, label: "Remove" }, { key: "set", icon: RefreshCw, label: "Set To" }].map(({ key, icon: Icon, label }) => (
                    <button key={key} onClick={() => setAdjustForm(p => ({ ...p, type: key }))} className={cn("flex-1 flex flex-col items-center gap-1 text-xs py-2 rounded-lg border", adjustForm.type === key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted/50")}>
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div><Label>Quantity ({adjustItem.unit})</Label><Input type="number" min="0" step="0.001" value={adjustForm.quantity} onChange={e => setAdjustForm(p => ({ ...p, quantity: e.target.value }))} placeholder="0" /></div>
              <div><Label>Notes (optional)</Label><Input value={adjustForm.notes} onChange={e => setAdjustForm(p => ({ ...p, notes: e.target.value }))} placeholder="Reason for adjustment" /></div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setAdjustItem(null)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAdjust} disabled={adjustInventory.isPending || !adjustForm.quantity}>Apply</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {historyItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Stock History</h2>
                <p className="text-sm text-muted-foreground">{historyItem.name}</p>
              </div>
              <button onClick={() => setHistoryItem(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2">
              {(transactions as InventoryTransaction[]).length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No transactions yet</p>
              ) : (transactions as InventoryTransaction[]).map(tx => (
                <div key={tx.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className={cn("w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5", tx.type === "add" || tx.type === "receive" ? "bg-green-100 text-green-600" : tx.type === "remove" || tx.type === "use" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600")}>
                    {tx.type === "add" || tx.type === "receive" ? <ArrowUpCircle className="w-4 h-4" /> : tx.type === "remove" || tx.type === "use" ? <ArrowDownCircle className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium capitalize">{tx.type}</span>
                      <span className={cn("text-sm font-semibold", tx.type === "add" || tx.type === "receive" ? "text-green-600" : "text-red-600")}>
                        {tx.type === "add" || tx.type === "receive" ? "+" : "-"}{Number(tx.quantity).toFixed(1)} {historyItem.unit}
                      </span>
                    </div>
                    {tx.notes && <p className="text-xs text-muted-foreground mt-0.5">{tx.notes}</p>}
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDate(tx.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SuppliersTab() {
  const { data: suppliers = [] } = useSuppliers();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: "", contactPerson: "", phone: "", email: "", address: "" });

  const handleAdd = async () => {
    if (!form.name) return;
    try {
      await createSupplier.mutateAsync(form);
      toast({ title: "Supplier added!" });
      setShowAdd(false);
      setForm({ name: "", contactPerson: "", phone: "", email: "", address: "" });
    } catch {
      toast({ title: "Failed to add supplier", variant: "destructive" });
    }
  };

  const handleEdit = async () => {
    if (!editSupplier) return;
    try {
      await updateSupplier.mutateAsync({ id: editSupplier.id, name: editSupplier.name, contactPerson: editSupplier.contactPerson ?? "", phone: editSupplier.phone ?? "", email: editSupplier.email ?? "", address: editSupplier.address ?? "" });
      toast({ title: "Supplier updated!" });
      setEditSupplier(null);
    } catch {
      toast({ title: "Failed to update supplier", variant: "destructive" });
    }
  };

  const handleDelete = async (s: Supplier) => {
    if (!confirm(`Remove supplier "${s.name}"?`)) return;
    try {
      await deleteSupplier.mutateAsync(s.id);
      toast({ title: "Supplier removed" });
    } catch {
      toast({ title: "Failed to remove", variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Supplier
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(suppliers as Supplier[]).filter(s => s.isActive).map((s: Supplier) => (
          <div key={s.id} className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold">
                {s.name[0].toUpperCase()}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditSupplier({ ...s })}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(s)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <h3 className="font-semibold text-sm mb-2">{s.name}</h3>
            <div className="space-y-1">
              {s.contactPerson && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Building2 className="w-3 h-3 flex-shrink-0" />{s.contactPerson}
                </p>
              )}
              {s.phone && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Phone className="w-3 h-3 flex-shrink-0" />{s.phone}
                </p>
              )}
              {s.email && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Mail className="w-3 h-3 flex-shrink-0" />{s.email}
                </p>
              )}
              {s.address && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 flex-shrink-0" />{s.address}
                </p>
              )}
            </div>
          </div>
        ))}
        {(suppliers as Supplier[]).filter(s => s.isActive).length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <Truck className="w-10 h-10 mx-auto mb-2 opacity-20" />
            No suppliers yet. Add your first supplier.
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Supplier</h2>
              <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><Label>Company Name *</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Fresh Foods Co." /></div>
              <div><Label>Contact Person</Label><Input value={form.contactPerson} onChange={e => setForm(p => ({ ...p, contactPerson: e.target.value }))} placeholder="Sales representative name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
                <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              </div>
              <div><Label>Address</Label><Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAdd} disabled={createSupplier.isPending || !form.name}>Add Supplier</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editSupplier && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Edit Supplier</h2>
              <button onClick={() => setEditSupplier(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><Label>Company Name *</Label><Input value={editSupplier.name} onChange={e => setEditSupplier(p => p && ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Contact Person</Label><Input value={editSupplier.contactPerson ?? ""} onChange={e => setEditSupplier(p => p && ({ ...p, contactPerson: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={editSupplier.phone ?? ""} onChange={e => setEditSupplier(p => p && ({ ...p, phone: e.target.value }))} /></div>
                <div><Label>Email</Label><Input value={editSupplier.email ?? ""} onChange={e => setEditSupplier(p => p && ({ ...p, email: e.target.value }))} /></div>
              </div>
              <div><Label>Address</Label><Input value={editSupplier.address ?? ""} onChange={e => setEditSupplier(p => p && ({ ...p, address: e.target.value }))} /></div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setEditSupplier(null)}>Cancel</Button>
                <Button className="flex-1" onClick={handleEdit} disabled={updateSupplier.isPending}>Save Changes</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PurchaseOrdersTab() {
  const { data: orders = [] } = usePurchaseOrders();
  const { data: suppliers = [] } = useSuppliers();
  const createPO = useCreatePurchaseOrder();
  const updatePO = useUpdatePurchaseOrder();
  const deletePO = useDeletePurchaseOrder();
  const runAutoReorder = useRunAutoReorder();
  const updateItems = useUpdatePurchaseOrderItems();
  const { data: inventoryItems = [] } = useInventory();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ supplierId: "", totalAmount: "", notes: "" });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingPoId, setEditingPoId] = useState<number | null>(null);
  const [editLines, setEditLines] = useState<Array<{ inventoryItemId: number | null; name: string; unit: string; quantity: string; costPerUnit: string }>>([]);

  const beginEdit = (po: PurchaseOrder) => {
    setEditingPoId(po.id);
    setExpandedId(po.id);
    setEditLines((po.items ?? []).map(li => ({
      inventoryItemId: li.inventoryItemId,
      name: li.name,
      unit: li.unit,
      quantity: String(li.quantity),
      costPerUnit: String(li.costPerUnit),
    })));
  };

  const saveEdit = async () => {
    if (editingPoId === null) return;
    try {
      await updateItems.mutateAsync({ id: editingPoId, items: editLines.filter(l => l.name && Number(l.quantity) > 0) });
      toast({ title: "Order updated" });
      setEditingPoId(null);
    } catch {
      toast({ title: "Failed to save changes", variant: "destructive" });
    }
  };

  const editTotal = editLines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.costPerUnit || 0), 0);

  const handleRunAuto = async () => {
    try {
      const res = await runAutoReorder.mutateAsync();
      if (res.draftsCreated > 0) toast({ title: `Created ${res.draftsCreated} auto-draft${res.draftsCreated === 1 ? "" : "s"}` });
      else toast({ title: "No new drafts needed", description: `${res.itemsConsidered} item(s) below min` });
    } catch {
      toast({ title: "Failed to run auto-reorder", variant: "destructive" });
    }
  };

  const handleCreate = async () => {
    try {
      await createPO.mutateAsync({ supplierId: form.supplierId ? Number(form.supplierId) : undefined, totalAmount: form.totalAmount || "0.00", notes: form.notes });
      toast({ title: "Purchase order created!" });
      setShowAdd(false);
      setForm({ supplierId: "", totalAmount: "", notes: "" });
    } catch {
      toast({ title: "Failed to create order", variant: "destructive" });
    }
  };

  const handleStatusChange = async (po: PurchaseOrder, newStatus: string) => {
    try {
      await updatePO.mutateAsync({ id: po.id, status: newStatus });
      toast({ title: `Order marked as ${newStatus}` });
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleDelete = async (po: PurchaseOrder) => {
    if (!confirm("Delete this purchase order?")) return;
    try {
      await deletePO.mutateAsync(po.id);
      toast({ title: "Order deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const supplierName = (supplierId: number | null) => {
    if (!supplierId) return "—";
    return (suppliers as Supplier[]).find(s => s.id === supplierId)?.name ?? "Unknown";
  };

  const filtered = statusFilter === "all" ? (orders as PurchaseOrder[]) : (orders as PurchaseOrder[]).filter(po => po.status === statusFilter);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex gap-2">
          {["all", "pending", "ordered", "received", "cancelled"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={cn("text-sm px-3 py-1.5 rounded-lg border capitalize transition-colors", statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted/50")}>
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleRunAuto} disabled={runAutoReorder.isPending} title="Scan inventory now and auto-draft POs for low-stock items">
            <Zap className={cn("w-4 h-4 mr-1.5", runAutoReorder.isPending && "animate-pulse")} /> {runAutoReorder.isPending ? "Running…" : "Run auto-reorder"}
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Order
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Order #</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Supplier</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Amount</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Ordered</th>
              <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((po: PurchaseOrder) => {
              const statusCfg = PO_STATUS[po.status] ?? { label: po.status, color: "bg-gray-100 text-gray-600 border-gray-200" };
              const lineItems = po.items ?? [];
              const isExpanded = expandedId === po.id;
              return (
                <Fragment key={po.id}>
                  <tr className={cn("border-b border-border last:border-0 hover:bg-muted/10", isExpanded && "bg-muted/10")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">PO-{String(po.id).padStart(4, "0")}</span>
                        {po.isAutoDrafted && (
                          <span title="Auto-drafted by the system" className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                            <Sparkles className="w-2.5 h-2.5" /> Auto-drafted
                          </span>
                        )}
                      </div>
                      {po.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[180px]">{po.notes}</p>}
                      {lineItems.length > 0 && (
                        <button onClick={() => setExpandedId(isExpanded ? null : po.id)} className="text-[11px] text-primary hover:underline mt-0.5">
                          {isExpanded ? "Hide items" : `${lineItems.length} item${lineItems.length === 1 ? "" : "s"}`}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1.5 text-sm">
                        <Truck className="w-3.5 h-3.5 text-muted-foreground" />
                        {supplierName(po.supplierId)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", statusCfg.color)}>{statusCfg.label}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-sm font-semibold">₹{Number(po.totalAmount).toLocaleString()}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-sm text-muted-foreground">{formatDate(po.orderedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {po.status === "pending" && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => beginEdit(po)} title="Edit line items">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {po.status === "pending" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => handleStatusChange(po, "ordered")}>{po.isAutoDrafted ? "Send" : "Mark Ordered"}</Button>
                        )}
                        {po.status === "ordered" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-green-600 border-green-200 hover:bg-green-50" onClick={() => handleStatusChange(po, "received")}>Mark Received</Button>
                        )}
                        {(po.status === "pending" || po.status === "ordered") && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => handleStatusChange(po, "cancelled")}>Cancel</Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(po)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && editingPoId === po.id && (
                    <tr className="bg-amber-50/40 border-b border-border">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="pl-2 space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Edit line items</p>
                          <div className="space-y-1.5">
                            {editLines.map((l, idx) => (
                              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                                <select
                                  className="col-span-5 border border-input rounded-md px-2 py-1 text-sm bg-background"
                                  value={l.inventoryItemId ?? ""}
                                  onChange={e => {
                                    const v = e.target.value ? Number(e.target.value) : null;
                                    const inv = (inventoryItems as InventoryItem[]).find(i => i.id === v);
                                    setEditLines(p => p.map((x, i) => i === idx ? { ...x, inventoryItemId: v, name: inv?.name ?? x.name, unit: inv?.unit ?? x.unit, costPerUnit: inv ? String(inv.costPerUnit) : x.costPerUnit } : x));
                                  }}
                                >
                                  <option value="">— custom —</option>
                                  {(inventoryItems as InventoryItem[]).filter(i => i.isActive).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                </select>
                                <Input className="col-span-2 h-8 text-sm" type="number" step="0.001" min="0" placeholder="Qty" value={l.quantity} onChange={e => setEditLines(p => p.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} />
                                <span className="col-span-1 text-xs text-muted-foreground">{l.unit}</span>
                                <Input className="col-span-2 h-8 text-sm" type="number" step="0.01" min="0" placeholder="Cost" value={l.costPerUnit} onChange={e => setEditLines(p => p.map((x, i) => i === idx ? { ...x, costPerUnit: e.target.value } : x))} />
                                <span className="col-span-1 text-xs text-right">₹{(Number(l.quantity || 0) * Number(l.costPerUnit || 0)).toFixed(2)}</span>
                                <Button size="sm" variant="ghost" className="col-span-1 h-7 px-2 text-red-500" onClick={() => setEditLines(p => p.filter((_, i) => i !== idx))}>
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t border-border">
                            <Button size="sm" variant="outline" onClick={() => setEditLines(p => [...p, { inventoryItemId: null, name: "New item", unit: "kg", quantity: "1", costPerUnit: "0" }])}>
                              <Plus className="w-3.5 h-3.5 mr-1" /> Add item
                            </Button>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold">Total ₹{editTotal.toFixed(2)}</span>
                              <Button size="sm" variant="ghost" onClick={() => setEditingPoId(null)}>Cancel</Button>
                              <Button size="sm" onClick={saveEdit} disabled={updateItems.isPending}>{updateItems.isPending ? "Saving…" : "Save"}</Button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {isExpanded && editingPoId !== po.id && lineItems.length > 0 && (
                    <tr className="bg-muted/5 border-b border-border">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="pl-2">
                          <p className="text-xs font-medium text-muted-foreground mb-2">Line items</p>
                          <div className="space-y-1">
                            {lineItems.map(li => {
                              const lineTotal = Number(li.quantity) * Number(li.costPerUnit);
                              return (
                                <div key={li.id} className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-muted/20">
                                  <span>{li.name}</span>
                                  <span className="text-muted-foreground">{Number(li.quantity).toFixed(2)} {li.unit} × ₹{Number(li.costPerUnit).toFixed(2)} = <span className="font-medium text-foreground">₹{lineTotal.toFixed(2)}</span></span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">
                <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-20" />
                {statusFilter === "all" ? "No purchase orders yet" : `No ${statusFilter} orders`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">New Purchase Order</h2>
              <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Supplier</Label>
                <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.supplierId} onChange={e => setForm(p => ({ ...p, supplierId: e.target.value }))}>
                  <option value="">Select supplier (optional)</option>
                  {(suppliers as Supplier[]).filter(s => s.isActive).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div><Label>Total Amount (₹)</Label><Input type="number" min="0" step="0.01" value={form.totalAmount} onChange={e => setForm(p => ({ ...p, totalAmount: e.target.value }))} placeholder="0.00" /></div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Items ordered, delivery instructions..." /></div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleCreate} disabled={createPO.isPending}>Create Order</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WasteLogTab() {
  const { data: wasteLogs = [] } = useWasteLog();
  const { data: items = [] } = useInventory();
  const adjustInventory = useAdjustInventory();
  const { toast } = useToast();

  const [showLog, setShowLog] = useState(false);
  const [form, setForm] = useState({ itemId: "", quantity: "", notes: "" });

  const handleLog = async () => {
    if (!form.itemId || !form.quantity) return;
    try {
      await adjustInventory.mutateAsync({ id: Number(form.itemId), type: "waste", quantity: form.quantity, notes: form.notes || "Waste logged" });
      toast({ title: "Waste logged!" });
      setShowLog(false);
      setForm({ itemId: "", quantity: "", notes: "" });
    } catch {
      toast({ title: "Failed to log waste", variant: "destructive" });
    }
  };

  const selectedItem = items.find((i: InventoryItem) => i.id === Number(form.itemId)) as InventoryItem | undefined;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm text-muted-foreground">Track spoilage and discarded inventory to reduce waste and improve cost control.</p>
        </div>
        <Button size="sm" onClick={() => setShowLog(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Log Waste
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Item</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Quantity Wasted</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Reason</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Date</th>
            </tr>
          </thead>
          <tbody>
            {(wasteLogs as (InventoryTransaction & { itemName: string; unit: string })[]).map(log => (
              <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center">
                      <Flame className="w-3.5 h-3.5 text-red-500" />
                    </div>
                    <span className="text-sm font-medium">{log.itemName}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-semibold text-red-600">-{Number(log.quantity).toFixed(1)} {log.unit}</span>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-sm text-muted-foreground">{log.notes || "—"}</span>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell text-sm text-muted-foreground">{formatDate(log.createdAt)}</td>
              </tr>
            ))}
            {(wasteLogs as InventoryTransaction[]).length === 0 && (
              <tr><td colSpan={4} className="text-center py-12 text-muted-foreground">
                <Flame className="w-10 h-10 mx-auto mb-2 opacity-20" />
                No waste logged yet
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showLog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Log Waste</h2>
              <button onClick={() => setShowLog(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Ingredient *</Label>
                <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.itemId} onChange={e => setForm(p => ({ ...p, itemId: e.target.value }))}>
                  <option value="">Select item...</option>
                  {(items as InventoryItem[]).map(i => <option key={i.id} value={i.id}>{i.name} ({Number(i.currentStock).toFixed(1)} {i.unit} available)</option>)}
                </select>
              </div>
              <div>
                <Label>Quantity Wasted {selectedItem ? `(${selectedItem.unit})` : ""} *</Label>
                <Input type="number" min="0" step="0.001" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Reason / Notes *</Label>
                <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="e.g. Expired, Dropped, Spoiled..." />
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowLog(false)}>Cancel</Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={handleLog} disabled={adjustInventory.isPending || !form.itemId || !form.quantity}>Log Waste</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const { data: restaurant } = useRestaurantInfo();
  const { data: items = [] } = useInventory();
  const updateRestaurant = useUpdateRestaurant();
  const runAutoReorder = useRunAutoReorder();
  const { toast } = useToast();
  const [cron, setCron] = useState("");

  const enabled = restaurant?.autoReorderEnabled ?? true;
  const currentCron = restaurant?.autoReorderCron ?? "0 6 * * *";
  const effectiveCron = cron || currentCron;

  const lowStockItems = (items as InventoryItem[]).filter(i => i.isLowStock);
  const eligibleAutoItems = lowStockItems.filter(i => i.autoReorderEnabled && i.supplierId);
  const skippedNoSupplier = lowStockItems.filter(i => i.autoReorderEnabled && !i.supplierId);
  const pausedItems = (items as InventoryItem[]).filter(i => !i.autoReorderEnabled);

  const handleToggle = async (next: boolean) => {
    try {
      await updateRestaurant.mutateAsync({ autoReorderEnabled: next });
      toast({ title: next ? "Auto-reorder enabled" : "Auto-reorder paused" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const handleSaveCron = async () => {
    if (!cron || cron === currentCron) return;
    try {
      await updateRestaurant.mutateAsync({ autoReorderCron: cron });
      toast({ title: "Schedule updated" });
      setCron("");
    } catch {
      toast({ title: "Failed to update schedule", variant: "destructive" });
    }
  };

  const handleRunNow = async () => {
    try {
      const res = await runAutoReorder.mutateAsync();
      if (res.draftsCreated > 0) toast({ title: `Created ${res.draftsCreated} auto-draft${res.draftsCreated === 1 ? "" : "s"}` });
      else toast({ title: "No new drafts needed", description: `${res.itemsConsidered} item(s) below min` });
    } catch {
      toast({ title: "Failed to run auto-reorder", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" /> Auto-reorder
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              When an ingredient drops at or below its minimum, the system can automatically draft a Purchase Order grouped by your preferred supplier. You'll get a notification and email so you can review and send.
            </p>
          </div>
          <button
            onClick={() => handleToggle(!enabled)}
            disabled={updateRestaurant.isPending}
            className={cn("relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors", enabled ? "bg-emerald-500" : "bg-muted")}
            aria-label="Toggle auto-reorder"
          >
            <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5", enabled ? "translate-x-5" : "translate-x-0.5")} />
          </button>
        </div>

        <div className="border-t border-border pt-4 space-y-4">
          <div>
            <Label>Daily run schedule (cron, IST)</Label>
            <div className="flex gap-2 mt-1">
              <Input value={effectiveCron} onChange={e => setCron(e.target.value)} placeholder="0 6 * * *" className="font-mono text-sm" />
              <Button variant="outline" onClick={handleSaveCron} disabled={!cron || cron === currentCron || updateRestaurant.isPending}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Default <code className="bg-muted px-1 py-0.5 rounded">0 6 * * *</code> runs every morning at 6:00 AM IST.</p>
          </div>

          <div>
            <Button onClick={handleRunNow} disabled={runAutoReorder.isPending || !enabled}>
              <Zap className={cn("w-4 h-4 mr-1.5", runAutoReorder.isPending && "animate-pulse")} />
              {runAutoReorder.isPending ? "Scanning…" : "Run auto-reorder now"}
            </Button>
            {!enabled && <p className="text-xs text-muted-foreground mt-1.5">Enable auto-reorder above to run a scan.</p>}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6">
        <h3 className="text-base font-semibold mb-4">Current state</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="border border-border rounded-xl p-3">
            <p className="text-2xl font-semibold text-red-600">{lowStockItems.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Low stock items</p>
          </div>
          <div className="border border-border rounded-xl p-3">
            <p className="text-2xl font-semibold text-emerald-600">{eligibleAutoItems.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Will auto-draft</p>
          </div>
          <div className="border border-border rounded-xl p-3">
            <p className="text-2xl font-semibold text-amber-600">{skippedNoSupplier.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Missing supplier</p>
          </div>
          <div className="border border-border rounded-xl p-3">
            <p className="text-2xl font-semibold text-muted-foreground">{pausedItems.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Paused items</p>
          </div>
        </div>

        {skippedNoSupplier.length > 0 && (
          <div className="mt-4 border border-amber-200 bg-amber-50 rounded-xl p-3">
            <p className="text-xs font-medium text-amber-800 mb-1.5">These low-stock items can't be auto-ordered (no preferred supplier):</p>
            <p className="text-xs text-amber-900">{skippedNoSupplier.map(i => i.name).join(", ")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AggregateStockTab() {
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data: rows = [], isLoading } = useAggregateInventory();

  const filtered = rows.filter(r => {
    if (lowStockOnly && !r.isLowStock) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const lowCount = rows.filter(r => r.isLowStock).length;

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items…"
            className="pl-9"
          />
        </div>
        <button
          onClick={() => setLowStockOnly(v => !v)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5",
            lowStockOnly ? "bg-red-50 border-red-200 text-red-700" : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Low stock only
          {lowCount > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{lowCount}</span>}
        </button>
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} of {rows.length} items aggregated across branches
        </span>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            {rows.length === 0 ? "No inventory items across any branch yet." : "No items match the current filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="w-8"></th>
                  <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Item</th>
                  <th className="text-left px-5 py-2.5 text-muted-foreground font-medium">Category</th>
                  <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Total Stock</th>
                  <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Total Min</th>
                  <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Branches</th>
                  <th className="text-right px-5 py-2.5 text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const isOpen = expanded.has(item.key);
                  return (
                    <Fragment key={item.key}>
                      <tr
                        className="border-t border-border hover:bg-muted/20 cursor-pointer"
                        onClick={() => toggle(item.key)}
                      >
                        <td className="pl-4 w-8">
                          <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                        </td>
                        <td className="px-5 py-2.5 font-medium text-foreground">{item.name}</td>
                        <td className="px-5 py-2.5 text-muted-foreground capitalize">{item.category}</td>
                        <td className="px-5 py-2.5 text-right font-medium text-foreground tabular-nums">
                          {Number(item.totalStock).toLocaleString("en-IN", { maximumFractionDigits: 2 })} {item.unit}
                        </td>
                        <td className="px-5 py-2.5 text-right text-muted-foreground tabular-nums">
                          {Number(item.totalMin).toLocaleString("en-IN", { maximumFractionDigits: 2 })} {item.unit}
                        </td>
                        <td className="px-5 py-2.5 text-right text-muted-foreground tabular-nums">{item.branchCount}</td>
                        <td className="px-5 py-2.5 text-right">
                          {item.lowStockBranches > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                              <AlertTriangle className="w-3 h-3" />
                              {item.lowStockBranches} low
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">OK</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/10 border-t border-border">
                          <td></td>
                          <td colSpan={6} className="px-5 py-3">
                            <div className="rounded-lg border border-border overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="bg-muted/30">
                                  <tr>
                                    <th className="text-left px-3 py-1.5 text-muted-foreground font-medium">Branch</th>
                                    <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Current</th>
                                    <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Min</th>
                                    <th className="text-right px-3 py-1.5 text-muted-foreground font-medium">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {item.branches.map(b => (
                                    <tr key={b.restaurantId} className="border-t border-border">
                                      <td className="px-3 py-1.5 font-medium text-foreground">{b.restaurantName}</td>
                                      <td className="px-3 py-1.5 text-right tabular-nums text-foreground">
                                        {Number(b.currentStock).toLocaleString("en-IN", { maximumFractionDigits: 2 })} {item.unit}
                                      </td>
                                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                        {Number(b.minStockLevel).toLocaleString("en-IN", { maximumFractionDigits: 2 })} {item.unit}
                                      </td>
                                      <td className="px-3 py-1.5 text-right">
                                        {b.isLowStock ? (
                                          <span className="text-red-600 dark:text-red-400 font-medium">Low</span>
                                        ) : (
                                          <span className="text-green-700 dark:text-green-400">OK</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>("Stock");
  const { hasMultipleBranches, isAllBranches, branches, selectedBranchId } = useBranchContext();
  const { data: items = [] } = useInventory();
  const { data: aggregateRows = [] } = useAggregateInventory();
  const lowStockCount = items.filter((i: InventoryItem) => i.isLowStock).length;
  const aggregateLow = aggregateRows.filter(r => r.isLowStock).length;
  const showAggregate = hasMultipleBranches && isAllBranches && tab === "Stock";
  const selectedBranchName = selectedBranchId == null ? null : branches.find(b => b.id === selectedBranchId)?.name ?? null;
  const subtitle = showAggregate
    ? `${aggregateRows.length} items across ${branches.length} branches${aggregateLow > 0 ? ` · ${aggregateLow} low somewhere` : ""}`
    : hasMultipleBranches && !isAllBranches
      ? `${selectedBranchName ?? ""} · ${items.length} items${lowStockCount > 0 ? ` · ${lowStockCount} low stock` : ""}`
      : `${items.length} items tracked${lowStockCount > 0 ? ` · ${lowStockCount} low stock` : ""}`;

  return (
    <Layout>
      <PageHeader
        title="Inventory"
        subtitle={subtitle}
        actions={hasMultipleBranches ? <BranchSwitcher /> : undefined}
      />
      <div className="p-6">
        <div className="flex gap-1 mb-6 bg-muted/40 rounded-xl p-1 w-fit flex-wrap">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "Stock" && <Package className="w-3.5 h-3.5" />}
              {t === "Suppliers" && <Truck className="w-3.5 h-3.5" />}
              {t === "Purchase Orders" && <ClipboardList className="w-3.5 h-3.5" />}
              {t === "Waste Log" && <Flame className="w-3.5 h-3.5" />}
              {t === "Settings" && <Settings className="w-3.5 h-3.5" />}
              {t}
              {t === "Stock" && (showAggregate ? aggregateLow : lowStockCount) > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {showAggregate ? aggregateLow : lowStockCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "Stock" && (showAggregate ? <AggregateStockTab /> : <StockTab />)}
        {tab === "Suppliers" && <SuppliersTab />}
        {tab === "Purchase Orders" && <PurchaseOrdersTab />}
        {tab === "Waste Log" && <WasteLogTab />}
        {tab === "Settings" && <SettingsTab />}
      </div>
    </Layout>
  );
}
