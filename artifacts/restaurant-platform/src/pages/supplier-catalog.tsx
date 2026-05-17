import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Pencil, Truck, Award, ArrowRight, Link as LinkIcon } from "lucide-react";
import { Link } from "wouter";
import {
  useSuppliers, useInventory,
  useSupplierCatalog, useCreateSupplierCatalogItem, useUpdateSupplierCatalogItem, useDeleteSupplierCatalogItem,
  useBestVendorsForItem, useUpdateSupplierNetworkInfo,
} from "@/lib/hooks";
import type { SupplierCatalogItem } from "@/lib/types";

const blank = { supplierId: 0, inventoryItemId: null as number | null, name: "", sku: "", category: "", unit: "kg", packSize: "1", pricePerUnit: "0", minOrderQuantity: "0", leadTimeDays: "" as string | number, isAvailable: true };

export default function SupplierCatalogPage() {
  const { toast } = useToast();
  const { data: suppliers = [] } = useSuppliers();
  const { data: inventoryItems = [] } = useInventory();
  const [filterSupplier, setFilterSupplier] = useState<string>("all");
  const [filterItem, setFilterItem] = useState<string>("all");
  const [search, setSearch] = useState("");
  const { data: catalog = [] } = useSupplierCatalog({
    supplierId: filterSupplier === "all" ? undefined : Number(filterSupplier),
    inventoryItemId: filterItem === "all" ? undefined : Number(filterItem),
    q: search || undefined,
  });
  const createCat = useCreateSupplierCatalogItem();
  const updateCat = useUpdateSupplierCatalogItem();
  const deleteCat = useDeleteSupplierCatalogItem();
  const updateSupplier = useUpdateSupplierNetworkInfo();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SupplierCatalogItem | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [bestForItem, setBestForItem] = useState<number | null>(null);
  const [supplierConfigId, setSupplierConfigId] = useState<number | null>(null);

  const supplierLabel = (id: number) => suppliers.find((s) => s.id === id)?.name ?? `Supplier #${id}`;
  const inventoryLabel = (id: number | null) => id == null ? "—" : (inventoryItems.find((i) => i.id === id)?.name ?? `Item #${id}`);

  function openCreate() { setEditing(null); setForm({ ...blank, supplierId: suppliers[0]?.id ?? 0 }); setShowForm(true); }
  function openEdit(row: SupplierCatalogItem) {
    setEditing(row);
    setForm({
      supplierId: row.supplierId, inventoryItemId: row.inventoryItemId, name: row.name,
      sku: row.sku ?? "", category: row.category ?? "", unit: row.unit,
      packSize: row.packSize, pricePerUnit: row.pricePerUnit, minOrderQuantity: row.minOrderQuantity,
      leadTimeDays: row.leadTimeDays ?? "", isAvailable: row.isAvailable,
    });
    setShowForm(true);
  }
  async function submit() {
    if (!form.supplierId || !form.name) { toast({ title: "Supplier and name required", variant: "destructive" }); return; }
    const payload: any = {
      supplierId: Number(form.supplierId),
      inventoryItemId: form.inventoryItemId ? Number(form.inventoryItemId) : null,
      name: form.name, sku: form.sku || null, category: form.category || null,
      unit: form.unit, packSize: form.packSize, pricePerUnit: form.pricePerUnit,
      minOrderQuantity: form.minOrderQuantity,
      leadTimeDays: form.leadTimeDays === "" ? null : Number(form.leadTimeDays),
      isAvailable: form.isAvailable,
    };
    try {
      if (editing) await updateCat.mutateAsync({ id: editing.id, ...payload });
      else await createCat.mutateAsync(payload);
      toast({ title: editing ? "Catalog item updated" : "Catalog item added" });
      setShowForm(false);
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    }
  }
  async function remove(id: number) {
    if (!confirm("Remove this catalog item?")) return;
    try { await deleteCat.mutateAsync(id); toast({ title: "Removed" }); } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  return (
    <Layout>
      <PageHeader title="Supplier Catalog & Network" description="Vendor pricing, lead times and best-vendor suggestions for your inventory." actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/marketplace/purchase-requests"><Truck className="h-4 w-4 mr-2" />Bulk RFQs</Link></Button>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Catalog Item</Button>
        </div>
      } />

      <Tabs defaultValue="catalog" className="space-y-4">
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="best">Best Vendor</TabsTrigger>
          <TabsTrigger value="suppliers">Vendor Profiles</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog">
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-xs" placeholder="Search name / SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={filterSupplier} onValueChange={setFilterSupplier}>
                <SelectTrigger className="w-56"><SelectValue placeholder="All suppliers" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All suppliers</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterItem} onValueChange={setFilterItem}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Any linked item" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any linked item</SelectItem>
                  {inventoryItems.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Linked Inventory</TableHead>
                  <TableHead className="text-right">Price / unit</TableHead>
                  <TableHead>Pack</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalog.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No catalog entries yet. Add your first vendor product.</TableCell></TableRow>
                )}
                {catalog.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}{row.category ? <div className="text-xs text-muted-foreground">{row.category}</div> : null}</TableCell>
                    <TableCell className="font-mono text-xs">{row.sku ?? "—"}</TableCell>
                    <TableCell>{row.supplierName ?? supplierLabel(row.supplierId)}</TableCell>
                    <TableCell>{row.inventoryItemName ?? inventoryLabel(row.inventoryItemId)}</TableCell>
                    <TableCell className="text-right">₹{Number(row.pricePerUnit).toFixed(2)} / {row.unit}</TableCell>
                    <TableCell>{Number(row.packSize).toFixed(2)} {row.unit}</TableCell>
                    <TableCell>{row.leadTimeDays != null ? `${row.leadTimeDays}d` : "—"}</TableCell>
                    <TableCell>{row.isAvailable ? <Badge>Available</Badge> : <Badge variant="secondary">Unavailable</Badge>}</TableCell>
                    <TableCell className="flex gap-1 justify-end">
                      {row.inventoryItemId != null && (
                        <Button size="sm" variant="ghost" onClick={() => setBestForItem(row.inventoryItemId)}><Award className="h-4 w-4" /></Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openEdit(row)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(row.id)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="best">
          <Card className="p-4 space-y-3">
            <Label>Pick an inventory item</Label>
            <Select value={bestForItem ? String(bestForItem) : ""} onValueChange={(v) => setBestForItem(Number(v))}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Select item" /></SelectTrigger>
              <SelectContent>
                {inventoryItems.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <BestVendorPanel inventoryItemId={bestForItem} />
          </Card>
        </TabsContent>

        <TabsContent value="suppliers">
          <Card className="p-4 space-y-3">
            <Table>
              <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Lead time</TableHead><TableHead>Reliability</TableHead><TableHead>Payment terms</TableHead><TableHead>Portal</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {suppliers.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.leadTimeDays != null ? `${s.leadTimeDays}d` : "—"}</TableCell>
                    <TableCell>{s.reliabilityScore ? `${Number(s.reliabilityScore).toFixed(2)} / 5` : "—"}</TableCell>
                    <TableCell>{s.paymentTerms ?? "—"}</TableCell>
                    <TableCell>{s.portalToken ? <Badge variant="outline">Enabled</Badge> : <span className="text-xs text-muted-foreground">Off</span>}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => setSupplierConfigId(s.id)}><Pencil className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit catalog item" : "Add catalog item"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Supplier</Label>
              <Select value={String(form.supplierId || "")} onValueChange={(v) => setForm({ ...form, supplierId: Number(v) })}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>Product name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
            <div><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            <div><Label>Pack size</Label><Input value={form.packSize} onChange={(e) => setForm({ ...form, packSize: e.target.value })} /></div>
            <div><Label>Price / unit (₹)</Label><Input value={form.pricePerUnit} onChange={(e) => setForm({ ...form, pricePerUnit: e.target.value })} /></div>
            <div><Label>Min order qty</Label><Input value={form.minOrderQuantity} onChange={(e) => setForm({ ...form, minOrderQuantity: e.target.value })} /></div>
            <div><Label>Lead time (days)</Label><Input value={String(form.leadTimeDays)} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} /></div>
            <div className="col-span-2">
              <Label>Linked inventory item (optional)</Label>
              <Select value={form.inventoryItemId ? String(form.inventoryItemId) : "none"} onValueChange={(v) => setForm({ ...form, inventoryItemId: v === "none" ? null : Number(v) })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked</SelectItem>
                  {inventoryItems.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex items-center gap-2"><Switch checked={form.isAvailable} onCheckedChange={(v) => setForm({ ...form, isAvailable: v })} /><Label>Available</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button><Button onClick={submit}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <SupplierConfigDialog supplierId={supplierConfigId} suppliers={suppliers as any} onClose={() => setSupplierConfigId(null)} onSave={updateSupplier.mutateAsync} />
    </Layout>
  );
}

function BestVendorPanel({ inventoryItemId }: { inventoryItemId: number | null }) {
  const { data } = useBestVendorsForItem(inventoryItemId);
  if (!inventoryItemId) return <div className="text-sm text-muted-foreground">Pick an item to compare vendors.</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!data.vendors.length) return <div className="text-sm text-muted-foreground">No vendor catalog entries linked to this item yet.</div>;
  return (
    <div className="space-y-2">
      {data.recommended && (
        <Card className="p-3 border-primary/40 bg-primary/5">
          <div className="flex items-center gap-2"><Award className="h-4 w-4 text-primary" /><span className="font-medium">Recommended:</span> {data.recommended.supplierName ?? `Supplier #${data.recommended.supplierId}`}</div>
          <div className="text-sm text-muted-foreground mt-1">₹{Number(data.recommended.pricePerUnit).toFixed(2)} / {data.recommended.unit} · {data.recommended.leadTimeDays ?? "?"}d lead · reliability {data.recommended.supplierReliability ?? "n/a"}</div>
        </Card>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead className="text-right">Price</TableHead><TableHead>Lead</TableHead><TableHead>Reliability</TableHead><TableHead>Payment terms</TableHead><TableHead className="text-right">Score</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.vendors.map((v) => (
            <TableRow key={v.id}>
              <TableCell className="font-medium">{v.supplierName ?? `#${v.supplierId}`}</TableCell>
              <TableCell className="text-right">₹{Number(v.pricePerUnit).toFixed(2)} / {v.unit}</TableCell>
              <TableCell>{v.leadTimeDays ?? "—"}d</TableCell>
              <TableCell>{v.supplierReliability ?? "—"}</TableCell>
              <TableCell>{v.supplierPaymentTerms ?? "—"}</TableCell>
              <TableCell className="text-right font-mono text-xs">{v._score.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SupplierConfigDialog({ supplierId, suppliers, onClose, onSave }: {
  supplierId: number | null; suppliers: any[]; onClose: () => void;
  onSave: (data: any) => Promise<unknown>;
}) {
  const { toast } = useToast();
  const supplier = supplierId ? suppliers.find((s) => s.id === supplierId) : null;
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [reliabilityScore, setReliabilityScore] = useState("");
  const [minOrderValue, setMinOrderValue] = useState("");
  const [isCatalogPublic, setIsCatalogPublic] = useState(false);
  const [regen, setRegen] = useState(false);

  useMemo(() => {
    if (supplier) {
      setLeadTimeDays(supplier.leadTimeDays != null ? String(supplier.leadTimeDays) : "");
      setPaymentTerms(supplier.paymentTerms ?? "");
      setReliabilityScore(supplier.reliabilityScore ?? "");
      setMinOrderValue(supplier.minOrderValue ?? "");
      setIsCatalogPublic(Boolean(supplier.isCatalogPublic));
      setRegen(false);
    }
  }, [supplierId]);

  if (!supplier) return null;
  async function submit() {
    try {
      await onSave({
        id: supplier.id,
        leadTimeDays: leadTimeDays === "" ? null : Number(leadTimeDays),
        paymentTerms: paymentTerms || null,
        reliabilityScore: reliabilityScore || null,
        minOrderValue: minOrderValue || null,
        isCatalogPublic,
        regeneratePortalToken: regen,
      });
      toast({ title: "Supplier updated" });
      onClose();
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  }
  const portalUrl = supplier.portalToken ? `${window.location.origin}/supplier-portal/${supplier.portalToken}` : null;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{supplier.name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Lead time (days)</Label><Input value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} /></div>
          <div><Label>Reliability (1–5)</Label><Input value={reliabilityScore} onChange={(e) => setReliabilityScore(e.target.value)} /></div>
          <div><Label>Min order value (₹)</Label><Input value={minOrderValue} onChange={(e) => setMinOrderValue(e.target.value)} /></div>
          <div><Label>Payment terms</Label><Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Net 30" /></div>
          <div className="col-span-2 flex items-center gap-2"><Switch checked={isCatalogPublic} onCheckedChange={setIsCatalogPublic} /><Label>Allow vendor portal access</Label></div>
          <div className="col-span-2 flex items-center gap-2"><Switch checked={regen} onCheckedChange={setRegen} /><Label>{supplier.portalToken ? "Regenerate portal link" : "Generate portal link"}</Label></div>
          {portalUrl && (
            <div className="col-span-2 text-xs bg-muted rounded p-2 flex items-center gap-2 break-all">
              <LinkIcon className="h-3 w-3 shrink-0" />
              <a href={portalUrl} target="_blank" rel="noreferrer" className="underline">{portalUrl}</a>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={submit}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
