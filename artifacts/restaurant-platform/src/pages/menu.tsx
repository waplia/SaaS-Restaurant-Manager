import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useMenus, useMenuCategories, useMenuItems, useCreateMenuItem, useUpdateMenuItem, useDeleteMenuItem } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import type { Menu, MenuCategory, MenuItem } from "@/lib/types";

function ItemBadge({ isVeg }: { isVeg: boolean }) {
  return (
    <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded border", isVeg ? "border-green-400 text-green-600" : "border-red-400 text-red-600")}>
      ●
    </span>
  );
}

export default function MenuPage() {
  const { data: menus = [] } = useMenus();
  const firstMenu: Menu | undefined = menus[0];
  const { data: categories = [] } = useMenuCategories(firstMenu?.id);
  const [selectedCat, setSelectedCat] = useState<number | undefined>();
  const [search, setSearch] = useState("");
  const { data: items = [] } = useMenuItems({ categoryId: selectedCat, search: search || undefined });
  const updateItem = useUpdateMenuItem();
  const deleteItem = useDeleteMenuItem();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const createItem = useCreateMenuItem();
  const [form, setForm] = useState({ name: "", price: "", description: "", categoryId: "", isVeg: true, preparationTime: "15" });

  const handleToggleAvailable = async (item: MenuItem) => {
    try {
      await updateItem.mutateAsync({ id: item.id, isAvailable: !item.isAvailable });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this item?")) return;
    try {
      await deleteItem.mutateAsync(id);
      toast({ title: "Item deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.price || !form.categoryId) return;
    try {
      if (editItem) {
        await updateItem.mutateAsync({ id: editItem.id, ...form, price: form.price, categoryId: Number(form.categoryId), preparationTime: Number(form.preparationTime) });
        toast({ title: "Item updated!" });
      } else {
        await createItem.mutateAsync({ ...form, price: form.price, categoryId: Number(form.categoryId), preparationTime: Number(form.preparationTime) });
        toast({ title: "Item created!" });
      }
      setShowAdd(false);
      setEditItem(null);
      setForm({ name: "", price: "", description: "", categoryId: "", isVeg: true, preparationTime: "15" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Menu Management"
        subtitle={`${items.length} items`}
        actions={
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Item
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-5 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-56" />
          </div>
          <Button size="sm" variant={!selectedCat ? "default" : "outline"} onClick={() => setSelectedCat(undefined)}>All</Button>
          {categories.map((c: MenuCategory) => (
            <Button key={c.id} size="sm" variant={selectedCat === c.id ? "default" : "outline"} onClick={() => setSelectedCat(c.id)}>{c.name}</Button>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Item</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Category</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Price</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Prep</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: MenuItem) => (
                <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ItemBadge isVeg={item.isVeg} />
                      <div>
                        <p className="text-sm font-medium text-foreground">{item.name}</p>
                        {item.description && <p className="text-xs text-muted-foreground truncate max-w-48">{item.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-muted-foreground">{categories.find((c: MenuCategory) => c.id === item.categoryId)?.name ?? "–"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-semibold text-foreground">₹{item.price}</span>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-xs text-muted-foreground">{item.preparationTime}m</span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggleAvailable(item)} className={cn("text-xs font-medium px-2 py-1 rounded-full transition-colors", item.isAvailable ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-red-100 text-red-600 hover:bg-red-200")}>
                      {item.isAvailable ? "Available" : "Unavailable"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditItem(item); setForm({ name: item.name, price: item.price, description: item.description ?? "", categoryId: String(item.categoryId), isVeg: item.isVeg, preparationTime: String(item.preparationTime) }); setShowAdd(true); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(item.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No items found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{editItem ? "Edit Item" : "Add Menu Item"}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label>Name</Label><Input placeholder="Item name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                <div><Label>Price (₹)</Label><Input placeholder="0.00" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} /></div>
                <div><Label>Prep Time (min)</Label><Input type="number" value={form.preparationTime} onChange={e => setForm(p => ({ ...p, preparationTime: e.target.value }))} /></div>
                <div className="col-span-2"><Label>Description</Label><Input placeholder="Brief description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
                <div className="col-span-2">
                  <Label>Category</Label>
                  <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.categoryId} onChange={e => setForm(p => ({ ...p, categoryId: e.target.value }))}>
                    <option value="">Select category</option>
                    {categories.map((c: MenuCategory) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2 flex items-center gap-3">
                  <Label>Type:</Label>
                  <button onClick={() => setForm(p => ({ ...p, isVeg: true }))} className={cn("text-xs px-3 py-1 rounded-full border", form.isVeg ? "bg-green-100 border-green-400 text-green-700" : "border-border text-muted-foreground")}>Veg</button>
                  <button onClick={() => setForm(p => ({ ...p, isVeg: false }))} className={cn("text-xs px-3 py-1 rounded-full border", !form.isVeg ? "bg-red-100 border-red-400 text-red-700" : "border-border text-muted-foreground")}>Non-Veg</button>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => { setShowAdd(false); setEditItem(null); }}>Cancel</Button>
                <Button className="flex-1" onClick={handleSave} disabled={createItem.isPending || updateItem.isPending}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
