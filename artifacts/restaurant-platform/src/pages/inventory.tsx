import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useInventory, useCreateInventoryItem, useAdjustInventory } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, AlertTriangle, Search, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const { data: items } = useInventory({ lowStock: lowStockOnly || undefined, search: search || undefined });
  const itemsArr = (items as any[]) ?? [];
  const createItem = useCreateInventoryItem();
  const adjustInventory = useAdjustInventory();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [adjustItem, setAdjustItem] = useState<any>(null);
  const [form, setForm] = useState({ name: "", unit: "kg", currentStock: "0", minStockLevel: "0", costPerUnit: "0", category: "general" });
  const [adjustForm, setAdjustForm] = useState({ type: "add", quantity: "", notes: "" });

  const lowStockCount = itemsArr.filter(i => i.isLowStock).length;

  const handleAdd = async () => {
    try {
      await createItem.mutateAsync(form);
      toast({ title: "Item added!" });
      setShowAdd(false);
      setForm({ name: "", unit: "kg", currentStock: "0", minStockLevel: "0", costPerUnit: "0", category: "general" });
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  };

  const handleAdjust = async () => {
    if (!adjustItem || !adjustForm.quantity) return;
    try {
      await adjustInventory.mutateAsync({ id: adjustItem.id, ...adjustForm });
      toast({ title: "Stock adjusted!" });
      setAdjustItem(null);
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  };

  const stockPercent = (item: any) => {
    const cur = Number(item.currentStock);
    const min = Number(item.minStockLevel);
    const max = min * 3 || 10;
    return Math.min(100, (cur / max) * 100);
  };

  return (
    <Layout>
      <PageHeader
        title="Inventory"
        subtitle={`${itemsArr.length} items · ${lowStockCount} low stock alerts`}
        actions={
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Item
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-5 flex-wrap items-center">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search inventory..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-56" />
          </div>
          <button onClick={() => setLowStockOnly(!lowStockOnly)} className={cn("flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors", lowStockOnly ? "bg-red-100 border-red-300 text-red-700" : "border-border text-muted-foreground hover:bg-muted")}>
            <AlertTriangle className="w-3.5 h-3.5" /> Low Stock Only
          </button>
          {lowStockCount > 0 && !lowStockOnly && (
            <span className="text-sm text-red-600 font-medium flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" /> {lowStockCount} items need restocking
            </span>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Item</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Category</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Stock</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Min Level</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Cost/Unit</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {itemsArr.map((item: any) => (
                <tr key={item.id} className={cn("border-b border-border last:border-0", item.isLowStock && "bg-red-50/50")}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {item.isLowStock && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                      <div>
                        <p className="text-sm font-medium text-foreground">{item.name}</p>
                        <div className="w-24 h-1.5 bg-muted rounded-full mt-1">
                          <div className={cn("h-full rounded-full", item.isLowStock ? "bg-red-500" : stockPercent(item) < 50 ? "bg-yellow-500" : "bg-green-500")} style={{ width: `${stockPercent(item)}%` }} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell"><span className="text-xs text-muted-foreground capitalize">{item.category}</span></td>
                  <td className="px-4 py-3">
                    <span className={cn("text-sm font-semibold", item.isLowStock ? "text-red-600" : "text-foreground")}>
                      {Number(item.currentStock).toFixed(1)} {item.unit}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell"><span className="text-sm text-muted-foreground">{Number(item.minStockLevel).toFixed(1)} {item.unit}</span></td>
                  <td className="px-4 py-3 hidden lg:table-cell"><span className="text-sm text-muted-foreground">₹{item.costPerUnit}/{item.unit}</span></td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setAdjustItem(item)}>Adjust</Button>
                  </td>
                </tr>
              ))}
              {itemsArr.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No inventory items</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Add Inventory Item</h2>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Chicken" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Unit</Label><Input value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} placeholder="kg, litre, pcs" /></div>
                <div><Label>Category</Label><Input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} /></div>
                <div><Label>Current Stock</Label><Input type="number" value={form.currentStock} onChange={e => setForm(p => ({ ...p, currentStock: e.target.value }))} /></div>
                <div><Label>Min Level</Label><Input type="number" value={form.minStockLevel} onChange={e => setForm(p => ({ ...p, minStockLevel: e.target.value }))} /></div>
                <div className="col-span-2"><Label>Cost per Unit (₹)</Label><Input type="number" value={form.costPerUnit} onChange={e => setForm(p => ({ ...p, costPerUnit: e.target.value }))} /></div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAdd} disabled={createItem.isPending}>Add</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {adjustItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-semibold mb-1">Adjust Stock</h2>
            <p className="text-sm text-muted-foreground mb-4">{adjustItem.name} — Current: {Number(adjustItem.currentStock).toFixed(1)} {adjustItem.unit}</p>
            <div className="space-y-3">
              <div>
                <Label>Type</Label>
                <div className="flex gap-2 mt-1">
                  {["add", "remove", "set"].map(t => (
                    <button key={t} onClick={() => setAdjustForm(p => ({ ...p, type: t }))} className={cn("flex-1 text-sm py-1.5 rounded-lg border capitalize", adjustForm.type === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground")}>{t}</button>
                  ))}
                </div>
              </div>
              <div><Label>Quantity ({adjustItem.unit})</Label><Input type="number" value={adjustForm.quantity} onChange={e => setAdjustForm(p => ({ ...p, quantity: e.target.value }))} placeholder="0" /></div>
              <div><Label>Notes (optional)</Label><Input value={adjustForm.notes} onChange={e => setAdjustForm(p => ({ ...p, notes: e.target.value }))} /></div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setAdjustItem(null)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAdjust} disabled={adjustInventory.isPending}>Apply</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
