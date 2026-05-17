import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Soup, Minus } from "lucide-react";
import {
  useCondimentItems, useCreateCondimentItem, useUpdateCondimentItem, useDeleteCondimentItem, useAdjustCondimentItem,
  useCondimentRecipes, useCreateCondimentRecipe, useDeleteCondimentRecipe,
  useMenuItems,
  type KindItem,
} from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

interface ItemForm { id?: number; name: string; unit: string; currentStock: string; minStockLevel: string; parLevel: string; costPerUnit: string }
const emptyForm: ItemForm = { name: "", unit: "ml", currentStock: "0", minStockLevel: "0", parLevel: "", costPerUnit: "0" };

export default function CondimentsPage() {
  const { toast } = useToast();
  const itemsQ = useCondimentItems();
  const recipesQ = useCondimentRecipes();
  const createItem = useCreateCondimentItem();
  const updateItem = useUpdateCondimentItem();
  const deleteItem = useDeleteCondimentItem();
  const adjustItem = useAdjustCondimentItem();
  const createRecipe = useCreateCondimentRecipe();
  const deleteRecipe = useDeleteCondimentRecipe();
  const menuItems = useMenuItems();

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [recipeOpen, setRecipeOpen] = useState<{ item: KindItem } | null>(null);
  const [recipeMenuItem, setRecipeMenuItem] = useState<string>("");
  const [recipeQty, setRecipeQty] = useState<string>("10");

  const openCreate = () => { setForm(emptyForm); setEditOpen(true); };
  const openEdit = (it: KindItem) => {
    setForm({ id: it.id, name: it.name, unit: it.unit, currentStock: it.currentStock, minStockLevel: it.minStockLevel, parLevel: it.parLevel ?? "", costPerUnit: it.costPerUnit });
    setEditOpen(true);
  };
  const onSubmit = async () => {
    if (!form.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    const payload = {
      name: form.name.trim(), unit: form.unit, currentStock: form.currentStock,
      minStockLevel: form.minStockLevel, parLevel: form.parLevel || undefined, costPerUnit: form.costPerUnit,
    };
    try {
      if (form.id) await updateItem.mutateAsync({ id: form.id, ...payload });
      else await createItem.mutateAsync(payload);
      setEditOpen(false); toast({ title: form.id ? "Updated" : "Created" });
    } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  const recipesByItem = new Map<number, any[]>();
  for (const r of recipesQ.data ?? []) {
    const arr = recipesByItem.get(r.inventoryItemId) ?? [];
    arr.push(r); recipesByItem.set(r.inventoryItemId, arr);
  }

  // Aggregate cost-per-dish leak indicator
  const totalCondimentCost = (recipesQ.data ?? []).reduce((s, r) => s + Number(r.quantity) * Number(r.costPerUnit ?? 0), 0);

  return (
    <Layout>
      <PageHeader title="Condiment Tracking" subtitle="Track ketchup, sauces, oils per dish — plug a major waste source." icon={Soup}>
        <Button onClick={openCreate} data-testid="button-create-item"><Plus className="w-4 h-4 mr-1" /> Add condiment</Button>
      </PageHeader>

      <Card className="mb-4">
        <CardContent className="pt-4 text-sm">
          Tracking {itemsQ.data?.length ?? 0} condiments • Total recipe cost ₹{totalCondimentCost.toFixed(2)} across {recipesQ.data?.length ?? 0} dish-links.
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {itemsQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
        {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            No condiments yet. Click <strong>Add condiment</strong> to start.
          </CardContent></Card>
        )}
        {(itemsQ.data ?? []).map(item => {
          const stock = Number(item.currentStock); const min = Number(item.minStockLevel);
          const low = stock <= min;
          const linked = recipesByItem.get(item.id) ?? [];
          return (
            <Card key={item.id} className={low ? "border-orange-400" : ""}>
              <CardHeader className="pb-2 flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base">{item.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">{item.unit} • ₹{Number(item.costPerUnit).toFixed(2)}/{item.unit}</p>
                </div>
                {low && <Badge variant="destructive">LOW</Badge>}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-semibold">{stock.toFixed(stock < 100 ? 1 : 0)}</p>
                    <p className="text-xs text-muted-foreground">Min: {min}{item.parLevel ? ` • Par: ${item.parLevel}` : ""}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => adjustItem.mutate({ id: item.id, delta: -10 })} data-testid={`button-decrement-${item.id}`}><Minus className="w-3 h-3"/></Button>
                    <Button size="sm" variant="outline" onClick={() => adjustItem.mutate({ id: item.id, delta: 10 })} data-testid={`button-increment-${item.id}`}><Plus className="w-3 h-3"/></Button>
                  </div>
                </div>
                <div className="text-xs">
                  <p className="font-medium text-muted-foreground">Used in {linked.length} dish{linked.length === 1 ? "" : "es"}</p>
                  {linked.slice(0, 3).map((r: any) => <p key={r.id} className="truncate">• {r.menuItemName} ({r.quantity} {r.unit})</p>)}
                </div>
                <div className="flex gap-1 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setRecipeOpen({ item })} data-testid={`button-link-${item.id}`}>Link to dish</Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(item)} data-testid={`button-edit-${item.id}`}><Pencil className="w-3 h-3"/></Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete ${item.name}?`)) deleteItem.mutate(item.id); }} data-testid={`button-delete-${item.id}`}><Trash2 className="w-3 h-3 text-destructive"/></Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Edit" : "Add"} condiment</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="input-name" /></div>
            <div><Label>Unit</Label><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="ml / g / unit" /></div>
            <div><Label>Cost / unit (₹)</Label><Input type="number" step="0.01" value={form.costPerUnit} onChange={e => setForm({ ...form, costPerUnit: e.target.value })} /></div>
            <div><Label>Current stock</Label><Input type="number" step="0.001" value={form.currentStock} onChange={e => setForm({ ...form, currentStock: e.target.value })} /></div>
            <div><Label>Min stock</Label><Input type="number" step="0.001" value={form.minStockLevel} onChange={e => setForm({ ...form, minStockLevel: e.target.value })} /></div>
            <div className="col-span-2"><Label>Par level</Label><Input type="number" step="0.001" value={form.parLevel} onChange={e => setForm({ ...form, parLevel: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={onSubmit} data-testid="button-save">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!recipeOpen} onOpenChange={(o) => !o && setRecipeOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Link {recipeOpen?.item.name} to dishes</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Menu item</Label>
              <Select value={recipeMenuItem} onValueChange={setRecipeMenuItem}>
                <SelectTrigger data-testid="select-menu-item"><SelectValue placeholder="Choose dish…" /></SelectTrigger>
                <SelectContent>
                  {(menuItems.data ?? []).map(mi => <SelectItem key={mi.id} value={String(mi.id)}>{mi.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Quantity per order ({recipeOpen?.item.unit})</Label><Input type="number" step="0.001" value={recipeQty} onChange={e => setRecipeQty(e.target.value)} data-testid="input-qty" /></div>
            <Button onClick={async () => {
              if (!recipeOpen || !recipeMenuItem) return;
              try {
                await createRecipe.mutateAsync({ menuItemId: Number(recipeMenuItem), inventoryItemId: recipeOpen.item.id, quantity: recipeQty, unit: recipeOpen.item.unit });
                setRecipeMenuItem(""); setRecipeQty("10");
                toast({ title: "Linked — will auto-deduct per order" });
              } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
            }} disabled={!recipeMenuItem} data-testid="button-add-recipe">Add link</Button>

            <div className="border-t pt-3">
              <p className="text-sm font-medium mb-2">Current links</p>
              {(recipesByItem.get(recipeOpen?.item.id ?? -1) ?? []).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between py-1 text-sm">
                  <span>{r.menuItemName} — {r.quantity} {r.unit}</span>
                  <Button size="sm" variant="ghost" onClick={() => deleteRecipe.mutate(r.id)}><Trash2 className="w-3 h-3 text-destructive"/></Button>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
