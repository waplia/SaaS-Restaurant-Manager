import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Wine, Plus, Settings as SettingsIcon, Beer, Banknote, BarChart3, Trash2 } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from "@/lib/api";
import { useRestaurantId, useRestaurantInfo, useMenuItems } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ServiceMode = "restaurant" | "bar" | "hybrid";
type LiquorRow = {
  profile: { id: number; inventoryItemId: number; liquorCategory: string; bottleSizeMl: number; bottlesOnHand: number; openBottleMlRemaining: number; brand: string | null; notes: string | null; isActive: boolean };
  inventoryItem: { id: number; name: string; unit: string };
};
type Variant = { id: number; menuItemId: number; kind: string; label: string; mlPerSale: number; price: string; linkedInventoryItemId: number | null; sortOrder: number; isActive: boolean };
type Shift = { id: number; bartenderUserId: number; status: string; openedAt: string; closedAt: string | null; expectedCash: string | null; countedCash: string | null; cashVariance: string | null; tipsTotal: string | null; totalSales: string | null; notes: string | null; closeNotes: string | null };
type ShiftDetail = { shift: Shift; counts: Array<{ id: number; inventoryItemId: number; phase: string; bottlesCount: number; openBottleMl: number; expectedBottles: number | null; expectedOpenBottleMl: number | null; varianceMl: number | null }>; sales: Array<{ id: number; mlPoured: number; saleAmount: string; liquorCategory: string | null; createdAt: string }> };
type Report = { from: string; to: string; totals: { mlPoured: string; saleAmount: string; qty: number }; byCategory: Array<{ liquorCategory: string | null; mlPoured: string; saleAmount: string; qty: number }>; bySku: Array<{ inventoryItemId: number | null; name: string | null; liquorCategory: string | null; mlPoured: string; saleAmount: string; qty: number }> };
type Station = { id: number; name: string; isBar: boolean };
type InventoryItem = { id: number; name: string; unit: string };

type Tab = "setup" | "skus" | "variants" | "shift" | "report";

const LIQUOR_CATEGORIES: string[] = ["whisky", "vodka", "rum", "gin", "tequila", "brandy", "wine", "beer", "liqueur", "other"];
const VARIANT_KINDS: string[] = ["peg", "bottle", "shot", "glass", "pint", "pitcher"];

export default function BarPage() {
  const [tab, setTab] = useState<Tab>("setup");
  const { data: info } = useRestaurantInfo();
  const serviceMode = (info as { serviceMode?: ServiceMode } | undefined)?.serviceMode ?? "restaurant";
  const enabled = serviceMode !== "restaurant";

  return (
    <Layout>
      <PageHeader title="Bar / Pub" subtitle="Liquor SKUs, peg & bottle variants, bartender settlement and the liquor report" />
      <div className="p-6">
        {!enabled ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-sm space-y-3">
            <p className="font-medium text-amber-900">Bar mode is disabled</p>
            <p className="text-amber-800">Switch this outlet to <strong>Bar</strong> or <strong>Hybrid</strong> mode in the Setup tab below to unlock liquor SKUs, peg/bottle variants, bar tickets, bartender settlement and liquor reports.</p>
            <SetupTab serviceMode={serviceMode} onlyMode />
          </div>
        ) : (
          <>
            <div className="flex gap-1 border-b mb-4 overflow-x-auto">
              {([
                ["setup", "Setup", SettingsIcon],
                ["skus", "Liquor SKUs", Wine],
                ["variants", "Menu Variants", Beer],
                ["shift", "Bartender Shift", Banknote],
                ["report", "Liquor Report", BarChart3],
              ] as const).map(([k, label, Icon]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={cn(
                    "px-3 py-2 text-sm font-medium flex items-center gap-2 border-b-2 -mb-px",
                    tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="w-4 h-4" />{label}
                </button>
              ))}
            </div>
            {tab === "setup" && <SetupTab serviceMode={serviceMode} />}
            {tab === "skus" && <SkusTab />}
            {tab === "variants" && <VariantsTab />}
            {tab === "shift" && <ShiftTab />}
            {tab === "report" && <ReportTab />}
          </>
        )}
      </div>
    </Layout>
  );
}

// ─────────────────────── Setup ───────────────────────

function SetupTab({ serviceMode, onlyMode = false }: { serviceMode: ServiceMode; onlyMode?: boolean }) {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<ServiceMode>(serviceMode);

  const stationsQ = useQuery<Station[]>({
    queryKey: ["bar", "stations", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/bar/stations`),
    enabled: !onlyMode && serviceMode !== "restaurant",
  });

  const saveMode = useMutation({
    mutationFn: () => apiPut(`/restaurants/${restaurantId}/bar/mode`, { serviceMode: mode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["restaurant", restaurantId] });
      toast.toast({ title: "Service mode updated" });
    },
    onError: (e) => toast.toast({ title: "Failed to update mode", description: (e as Error).message, variant: "destructive" }),
  });

  const addStation = useMutation({
    mutationFn: (name: string) => apiPost(`/restaurants/${restaurantId}/bar/stations`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bar", "stations", restaurantId] });
      toast.toast({ title: "Bar station created" });
    },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h3 className="font-semibold text-sm">Service Mode</h3>
        <div className="flex items-center gap-2">
          <Select value={mode} onValueChange={(v) => setMode(v as ServiceMode)}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="restaurant">Restaurant only</SelectItem>
              <SelectItem value="bar">Bar / Pub only</SelectItem>
              <SelectItem value="hybrid">Hybrid (Restaurant + Bar)</SelectItem>
            </SelectContent>
          </Select>
          <Button disabled={mode === serviceMode || saveMode.isPending} onClick={() => saveMode.mutate()}>Save</Button>
        </div>
        <p className="text-xs text-muted-foreground">Bar / Hybrid mode enables liquor SKUs, peg & bottle variants, bar tickets and bartender settlement.</p>
      </div>

      {!onlyMode && serviceMode !== "restaurant" && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Bar Stations</h3>
            <Button size="sm" onClick={() => addStation.mutate("Bar")}><Plus className="w-3 h-3 mr-1" />Add Bar Station</Button>
          </div>
          {(stationsQ.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No bar stations yet. Add one to route Bar Order Tickets (BOT) separately from kitchen tickets.</p>
          ) : (
            <ul className="text-sm divide-y">
              {(stationsQ.data ?? []).map(s => (
                <li key={s.id} className="py-2">{s.name}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── Liquor SKUs ───────────────────────

function SkusTab() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const toast = useToast();
  const [openCreate, setOpenCreate] = useState(false);

  const skusQ = useQuery<LiquorRow[]>({
    queryKey: ["bar", "skus", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/bar/liquor-skus`),
  });
  const inventoryQ = useQuery<InventoryItem[]>({
    queryKey: ["inventory", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/inventory`),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiPatch(`/restaurants/${restaurantId}/bar/liquor-skus/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bar", "skus", restaurantId] });
      toast.toast({ title: "Updated" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Liquor SKUs</h3>
        <Button onClick={() => setOpenCreate(true)}><Plus className="w-4 h-4 mr-1" />Add Liquor SKU</Button>
      </div>
      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2">SKU</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-right px-3 py-2">Bottle (ml)</th>
              <th className="text-right px-3 py-2">Sealed</th>
              <th className="text-right px-3 py-2">Open ml</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(skusQ.data ?? []).map(row => (
              <tr key={row.profile.id}>
                <td className="px-3 py-2 font-medium">
                  {row.inventoryItem.name}
                  {row.profile.brand && <span className="ml-2 text-xs text-muted-foreground">({row.profile.brand})</span>}
                </td>
                <td className="px-3 py-2">
                  <Select value={row.profile.liquorCategory} onValueChange={v => update.mutate({ id: row.profile.id, body: { liquorCategory: v } })}>
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LIQUOR_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2 text-right">
                  <Input className="h-8 w-24 text-right ml-auto" type="number" defaultValue={row.profile.bottleSizeMl}
                    onBlur={e => { const v = Number(e.target.value); if (v && v !== row.profile.bottleSizeMl) update.mutate({ id: row.profile.id, body: { bottleSizeMl: v } }); }} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Input className="h-8 w-20 text-right ml-auto" type="number" defaultValue={row.profile.bottlesOnHand}
                    onBlur={e => { const v = Number(e.target.value); if (v !== row.profile.bottlesOnHand) update.mutate({ id: row.profile.id, body: { bottlesOnHand: v } }); }} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Input className="h-8 w-24 text-right ml-auto" type="number" defaultValue={row.profile.openBottleMlRemaining}
                    onBlur={e => { const v = Number(e.target.value); if (v !== row.profile.openBottleMlRemaining) update.mutate({ id: row.profile.id, body: { openBottleMlRemaining: v } }); }} />
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                  {(row.profile.bottlesOnHand * row.profile.bottleSizeMl + row.profile.openBottleMlRemaining)} ml total
                </td>
              </tr>
            ))}
            {(skusQ.data ?? []).length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No liquor SKUs yet. Click <em>Add Liquor SKU</em> to track a bottle.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CreateSkuDialog open={openCreate} onOpenChange={setOpenCreate} inventory={inventoryQ.data ?? []} />
    </div>
  );
}

function CreateSkuDialog({ open, onOpenChange, inventory }: { open: boolean; onOpenChange: (v: boolean) => void; inventory: InventoryItem[] }) {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ inventoryItemId: "", liquorCategory: "whisky", bottleSizeMl: 750, bottlesOnHand: 0, openBottleMlRemaining: 0, brand: "" });

  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/bar/liquor-skus`, {
      inventoryItemId: Number(form.inventoryItemId),
      liquorCategory: form.liquorCategory,
      bottleSizeMl: form.bottleSizeMl,
      bottlesOnHand: form.bottlesOnHand,
      openBottleMlRemaining: form.openBottleMlRemaining,
      brand: form.brand || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bar", "skus", restaurantId] });
      toast.toast({ title: "Liquor SKU created" });
      onOpenChange(false);
    },
    onError: (e) => toast.toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Liquor SKU</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Inventory item</Label>
            <Select value={form.inventoryItemId} onValueChange={v => setForm(f => ({ ...f, inventoryItemId: v }))}>
              <SelectTrigger><SelectValue placeholder="Pick an inventory item" /></SelectTrigger>
              <SelectContent>
                {inventory.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.unit})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={form.liquorCategory} onValueChange={v => setForm(f => ({ ...f, liquorCategory: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LIQUOR_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Bottle size (ml)</Label>
              <Input type="number" value={form.bottleSizeMl} onChange={e => setForm(f => ({ ...f, bottleSizeMl: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Sealed bottles</Label>
              <Input type="number" value={form.bottlesOnHand} onChange={e => setForm(f => ({ ...f, bottlesOnHand: Number(e.target.value) }))} />
            </div>
            <div>
              <Label>Open bottle (ml)</Label>
              <Input type="number" value={form.openBottleMlRemaining} onChange={e => setForm(f => ({ ...f, openBottleMlRemaining: Number(e.target.value) }))} />
            </div>
          </div>
          <div>
            <Label>Brand (optional)</Label>
            <Input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!form.inventoryItemId || create.isPending} onClick={() => create.mutate()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────── Variants ───────────────────────

function VariantsTab() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const toast = useToast();
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const menuItems = useMenuItems() as { data?: Array<{ id: number; name: string; price: string; isBarItem?: boolean }> };

  const variantsQ = useQuery<Variant[]>({
    queryKey: ["bar", "variants", restaurantId, selectedItem],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/bar/menu-items/${selectedItem}/variants`),
    enabled: !!selectedItem,
  });
  const skusQ = useQuery<LiquorRow[]>({
    queryKey: ["bar", "skus", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/bar/liquor-skus`),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost(`/restaurants/${restaurantId}/bar/menu-items/${selectedItem}/variants`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bar", "variants", restaurantId, selectedItem] }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/bar/variants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bar", "variants", restaurantId, selectedItem] }),
  });

  const [draft, setDraft] = useState({ kind: "peg", label: "30 ml Peg", mlPerSale: 30, price: "", linkedInventoryItemId: "" });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-1">
        <h3 className="font-semibold mb-2 text-sm">Bar menu items</h3>
        <ul className="border rounded divide-y max-h-[60vh] overflow-auto">
          {(menuItems.data ?? []).map(mi => (
            <li key={mi.id}>
              <button
                onClick={() => setSelectedItem(mi.id)}
                className={cn("w-full text-left px-3 py-2 text-sm hover:bg-muted/50", selectedItem === mi.id && "bg-primary/10 font-medium")}
              >
                {mi.name}
                {mi.isBarItem && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">bar</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="md:col-span-2">
        {!selectedItem ? (
          <p className="text-sm text-muted-foreground">Select a menu item to define peg / bottle variants.</p>
        ) : (
          <>
            <div className="border rounded p-3 mb-3 space-y-2 bg-muted/20">
              <h4 className="text-sm font-semibold">Add variant</h4>
              <div className="grid grid-cols-5 gap-2">
                <Select value={draft.kind} onValueChange={v => setDraft(d => ({ ...d, kind: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{VARIANT_KINDS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Label" value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
                <Input type="number" placeholder="ml" value={draft.mlPerSale} onChange={e => setDraft(d => ({ ...d, mlPerSale: Number(e.target.value) }))} />
                <Input type="number" placeholder="price" value={draft.price} onChange={e => setDraft(d => ({ ...d, price: e.target.value }))} />
                <Select value={draft.linkedInventoryItemId} onValueChange={v => setDraft(d => ({ ...d, linkedInventoryItemId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Bottle SKU" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">— None —</SelectItem>
                    {(skusQ.data ?? []).map(s => <SelectItem key={s.profile.id} value={String(s.inventoryItem.id)}>{s.inventoryItem.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" disabled={!draft.label || !draft.price} onClick={() => {
                create.mutate({
                  kind: draft.kind, label: draft.label, mlPerSale: draft.mlPerSale, price: Number(draft.price),
                  linkedInventoryItemId: draft.linkedInventoryItemId && draft.linkedInventoryItemId !== "0" ? Number(draft.linkedInventoryItemId) : null,
                }, { onSuccess: () => { setDraft({ kind: "peg", label: "30 ml Peg", mlPerSale: 30, price: "", linkedInventoryItemId: "" }); toast.toast({ title: "Variant added" }); } });
              }}><Plus className="w-3 h-3 mr-1" />Add</Button>
            </div>
            <div className="border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Kind</th>
                    <th className="text-left px-3 py-2">Label</th>
                    <th className="text-right px-3 py-2">ml</th>
                    <th className="text-right px-3 py-2">Price</th>
                    <th className="text-left px-3 py-2">Linked SKU</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(variantsQ.data ?? []).map(v => (
                    <tr key={v.id}>
                      <td className="px-3 py-2">{v.kind}</td>
                      <td className="px-3 py-2">{v.label}</td>
                      <td className="px-3 py-2 text-right">{v.mlPerSale}</td>
                      <td className="px-3 py-2 text-right">{Number(v.price).toFixed(2)}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{v.linkedInventoryItemId ? `#${v.linkedInventoryItemId}` : "—"}</td>
                      <td className="px-3 py-2"><Button size="icon" variant="ghost" onClick={() => del.mutate(v.id)}><Trash2 className="w-3 h-3" /></Button></td>
                    </tr>
                  ))}
                  {(variantsQ.data ?? []).length === 0 && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No variants yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────── Bartender Shift ───────────────────────

function ShiftTab() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const toast = useToast();

  const currentQ = useQuery<Shift | null>({
    queryKey: ["bar", "shift", "current", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/bar/shifts/current`),
  });
  const skusQ = useQuery<LiquorRow[]>({
    queryKey: ["bar", "skus", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/bar/liquor-skus`),
  });
  const historyQ = useQuery<Shift[]>({
    queryKey: ["bar", "shifts", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/bar/shifts`),
  });

  const [openingCounts, setOpeningCounts] = useState<Record<number, { bottles: number; openMl: number }>>({});
  const [closingCounts, setClosingCounts] = useState<Record<number, { bottles: number; openMl: number }>>({});
  const [countedCash, setCountedCash] = useState("");
  const [tipsTotal, setTipsTotal] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  const openShift = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/bar/shifts/open`, {
      openingCounts: Object.entries(openingCounts).map(([invId, v]) => ({
        inventoryItemId: Number(invId), bottlesCount: v.bottles, openBottleMl: v.openMl,
      })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bar", "shift", "current", restaurantId] });
      qc.invalidateQueries({ queryKey: ["bar", "shifts", restaurantId] });
      toast.toast({ title: "Shift opened" });
    },
    onError: e => toast.toast({ title: "Failed to open shift", description: (e as Error).message, variant: "destructive" }),
  });

  const closeShift = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/bar/shifts/${currentQ.data?.id}/close`, {
      closingCounts: Object.entries(closingCounts).map(([invId, v]) => ({
        inventoryItemId: Number(invId), bottlesCount: v.bottles, openBottleMl: v.openMl,
      })),
      countedCash: Number(countedCash) || 0,
      tipsTotal: Number(tipsTotal) || 0,
      closeNotes,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bar", "shift", "current", restaurantId] });
      qc.invalidateQueries({ queryKey: ["bar", "shifts", restaurantId] });
      toast.toast({ title: "Shift closed" });
      setClosingCounts({}); setCountedCash(""); setTipsTotal(""); setCloseNotes("");
    },
    onError: e => toast.toast({ title: "Failed to close shift", description: (e as Error).message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${restaurantId}/bar/shifts/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bar", "shifts", restaurantId] });
      toast.toast({ title: "Shift approved" });
    },
  });

  const skus = skusQ.data ?? [];
  const current = currentQ.data;

  return (
    <div className="space-y-6">
      {!current ? (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <h3 className="font-semibold">Open new bartender shift</h3>
          <p className="text-xs text-muted-foreground">Record opening bottle counts so the closing variance can be calculated.</p>
          <BottleCountTable skus={skus} value={openingCounts} onChange={setOpeningCounts} />
          <Button onClick={() => openShift.mutate()} disabled={openShift.isPending}>Open shift</Button>
        </div>
      ) : (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Open shift #{current.id}</h3>
              <p className="text-xs text-muted-foreground">Opened {new Date(current.openedAt).toLocaleString()}</p>
            </div>
            <span className="text-xs uppercase tracking-wide rounded bg-emerald-100 text-emerald-800 px-2 py-1">Open</span>
          </div>
          <h4 className="font-medium text-sm mt-3">Closing bottle counts</h4>
          <BottleCountTable skus={skus} value={closingCounts} onChange={setClosingCounts} />
          <div className="grid grid-cols-3 gap-3 max-w-2xl">
            <div><Label>Counted cash</Label><Input type="number" value={countedCash} onChange={e => setCountedCash(e.target.value)} /></div>
            <div><Label>Tips total</Label><Input type="number" value={tipsTotal} onChange={e => setTipsTotal(e.target.value)} /></div>
            <div className="col-span-3"><Label>Notes</Label><Textarea value={closeNotes} onChange={e => setCloseNotes(e.target.value)} /></div>
          </div>
          <Button onClick={() => closeShift.mutate()} disabled={closeShift.isPending}>Close shift</Button>
        </div>
      )}

      <div>
        <h3 className="font-semibold text-sm mb-2">Recent shifts</h3>
        <div className="border rounded overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Opened</th>
                <th className="px-3 py-2 text-left">Closed</th>
                <th className="px-3 py-2 text-right">Sales</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Counted</th>
                <th className="px-3 py-2 text-right">Variance</th>
                <th className="px-3 py-2">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(historyQ.data ?? []).map(s => (
                <tr key={s.id}>
                  <td className="px-3 py-2">#{s.id}</td>
                  <td className="px-3 py-2">{new Date(s.openedAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{s.closedAt ? new Date(s.closedAt).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2 text-right">{s.totalSales ? Number(s.totalSales).toFixed(2) : "—"}</td>
                  <td className="px-3 py-2 text-right">{s.expectedCash ? Number(s.expectedCash).toFixed(2) : "—"}</td>
                  <td className="px-3 py-2 text-right">{s.countedCash ? Number(s.countedCash).toFixed(2) : "—"}</td>
                  <td className={cn("px-3 py-2 text-right", s.cashVariance && Number(s.cashVariance) < 0 && "text-rose-600", s.cashVariance && Number(s.cashVariance) > 0 && "text-emerald-600")}>
                    {s.cashVariance ? Number(s.cashVariance).toFixed(2) : "—"}
                  </td>
                  <td className="px-3 py-2">{s.status}</td>
                  <td className="px-3 py-2">
                    {s.status === "closed" && <Button size="sm" variant="outline" onClick={() => approve.mutate(s.id)}>Approve</Button>}
                  </td>
                </tr>
              ))}
              {(historyQ.data ?? []).length === 0 && <tr><td colSpan={9} className="text-center py-6 text-muted-foreground">No shifts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BottleCountTable({ skus, value, onChange }: { skus: LiquorRow[]; value: Record<number, { bottles: number; openMl: number }>; onChange: (v: Record<number, { bottles: number; openMl: number }>) => void }) {
  return (
    <div className="border rounded overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/30">
          <tr>
            <th className="text-left px-3 py-2">Liquor</th>
            <th className="text-right px-3 py-2">System bottles</th>
            <th className="text-right px-3 py-2">System open ml</th>
            <th className="text-right px-3 py-2">Counted bottles</th>
            <th className="text-right px-3 py-2">Counted open ml</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {skus.map(s => {
            const cur = value[s.inventoryItem.id] ?? { bottles: 0, openMl: 0 };
            return (
              <tr key={s.profile.id}>
                <td className="px-3 py-2">{s.inventoryItem.name}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{s.profile.bottlesOnHand}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{s.profile.openBottleMlRemaining}</td>
                <td className="px-3 py-2 text-right">
                  <Input type="number" className="h-8 w-20 text-right ml-auto" value={cur.bottles}
                    onChange={e => onChange({ ...value, [s.inventoryItem.id]: { ...cur, bottles: Number(e.target.value) } })} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Input type="number" className="h-8 w-24 text-right ml-auto" value={cur.openMl}
                    onChange={e => onChange({ ...value, [s.inventoryItem.id]: { ...cur, openMl: Number(e.target.value) } })} />
                </td>
              </tr>
            );
          })}
          {skus.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">Add liquor SKUs first.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────── Report ───────────────────────

function ReportTab() {
  const restaurantId = useRestaurantId();
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 3600 * 1000);
  const [from, setFrom] = useState(weekAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));

  const reportQ = useQuery<Report>({
    queryKey: ["bar", "report", restaurantId, from, to],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/bar/report?from=${from}&to=${to}T23:59:59`),
  });

  const r = reportQ.data;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end">
        <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      </div>
      {r && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card title="Total sales" value={`₹${Number(r.totals.saleAmount).toFixed(2)}`} />
            <Card title="Total ml poured" value={`${Number(r.totals.mlPoured).toLocaleString()} ml`} />
            <Card title="Pours" value={String(r.totals.qty)} />
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-2">By category</h3>
            <div className="border rounded overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40"><tr><th className="text-left px-3 py-2">Category</th><th className="text-right px-3 py-2">Pours</th><th className="text-right px-3 py-2">ml</th><th className="text-right px-3 py-2">Sales</th></tr></thead>
                <tbody className="divide-y">
                  {r.byCategory.map((c, i) => (
                    <tr key={i}><td className="px-3 py-2">{c.liquorCategory ?? "—"}</td><td className="px-3 py-2 text-right">{c.qty}</td><td className="px-3 py-2 text-right">{Number(c.mlPoured).toLocaleString()}</td><td className="px-3 py-2 text-right">{Number(c.saleAmount).toFixed(2)}</td></tr>
                  ))}
                  {r.byCategory.length === 0 && <tr><td colSpan={4} className="text-center py-4 text-muted-foreground">No data in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-2">By SKU</h3>
            <div className="border rounded overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40"><tr><th className="text-left px-3 py-2">SKU</th><th className="text-left px-3 py-2">Category</th><th className="text-right px-3 py-2">Pours</th><th className="text-right px-3 py-2">ml</th><th className="text-right px-3 py-2">Sales</th></tr></thead>
                <tbody className="divide-y">
                  {r.bySku.map((s, i) => (
                    <tr key={i}><td className="px-3 py-2">{s.name ?? "—"}</td><td className="px-3 py-2">{s.liquorCategory ?? "—"}</td><td className="px-3 py-2 text-right">{s.qty}</td><td className="px-3 py-2 text-right">{Number(s.mlPoured).toLocaleString()}</td><td className="px-3 py-2 text-right">{Number(s.saleAmount).toFixed(2)}</td></tr>
                  ))}
                  {r.bySku.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">No data.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="border rounded p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
    </div>
  );
}
