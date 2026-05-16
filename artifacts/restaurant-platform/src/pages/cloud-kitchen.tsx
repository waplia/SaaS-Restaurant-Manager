import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from "@/lib/api";
import { useRestaurantId, useMenuItems } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ChefHat, Plus, Pencil, Trash2, Pause, Play, Package, Timer,
  TrendingUp, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  "Brands", "Brand Menus", "Packaging", "Channels & Throttle",
  "SLA Targets", "Live Orders", "Performance",
] as const;
type Tab = typeof TABS[number];

interface Brand {
  id: number;
  name: string;
  slug: string;
  branchId: number | null;
  logoUrl: string | null;
  primaryColor: string;
  fssaiNumber: string | null;
  gstNumber: string | null;
  channelConfig: Record<string, { externalId?: string; commissionPct?: number; enabled?: boolean }>;
  isActive: boolean;
}
interface PackagingItem {
  id: number; name: string; unit: string;
  currentStock: string; minStockLevel: string; costPerUnit: string;
  isActive: boolean; isLow: boolean;
}
interface BranchRow {
  id: number; name: string; cloudKitchenEnabled: boolean; isActive: boolean;
}
interface ThrottleRule {
  id: number; brandId: number | null; channelKey: string | null;
  isPaused: boolean; pauseUntil: string | null;
  maxOrdersPerHour: number | null; note: string | null;
}
interface SlaTarget {
  id: number; brandId: number; channelKey: string;
  prepMinutes: number; handoverMinutes: number;
}
interface CkOrder {
  id: number; orderNumber: string; status: string; totalAmount: string;
  brandId: number | null; channelKey: string | null;
  channelExternalOrderId: string | null;
  customerName: string | null; customerPhone: string | null;
  slaTargetAt: string | null; slaCountdownSec: number | null;
  createdAt: string;
  items: Array<{ menuItemName: string; quantity: number; totalPrice: string }>;
}
interface ChannelDef { key: string; label: string }
interface BrandMenuLink {
  id: number; brandId: number; menuItemId: number;
  priceOverride: string | null; taxRateOverride: string | null; isAvailable: boolean;
  item: { id: number; name: string; price: string; taxRate: string | null };
}
interface DashboardResp {
  window: { from: string; to: string };
  consolidated: { revenue: string; orders: number; aov: string; grossProfit: string; slaBreaches: number; slaBreachPct: number };
  brands: Array<{
    brandId: number | null; brandName: string; brandColor: string | null;
    revenue: string; orders: number; aov: string;
    ingredientCost: string; packagingCost: string; commissionCost: string; discounts: string;
    grossProfit: string; avgPrepMinutes: number | null; slaBreaches: number; slaBreachPct: number;
    channelMix: Array<{ channel: string; revenue: string }>;
    topItems: Array<{ name: string; qty: number; revenue: string }>;
  }>;
}

function fmtMoney(n: string | number) {
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtChannelLabel(k: string) {
  return k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function CloudKitchenPage() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("Brands");
  const base = `/restaurants/${RID}/cloud-kitchen`;

  const branches = useQuery<BranchRow[]>({ queryKey: ["ck-branches", RID], queryFn: () => apiGet(`${base}/branches`) });
  const channels = useQuery<ChannelDef[]>({ queryKey: ["ck-channels", RID], queryFn: () => apiGet(`${base}/channels`) });
  const brands = useQuery<Brand[]>({ queryKey: ["ck-brands", RID], queryFn: () => apiGet(`${base}/brands`) });

  const toggleBranchCK = useMutation({
    mutationFn: ({ branchId, enabled }: { branchId: number; enabled: boolean }) =>
      apiPatch(`${base}/branches/${branchId}`, { cloudKitchenEnabled: enabled }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-branches", RID] }); toast({ title: "Branch updated" }); },
  });

  return (
    <Layout>
      <PageHeader
        title="Cloud Kitchen Command Center"
        subtitle="Run multiple virtual brands from one branch — shared stock, separate menus, channels, KOTs, packaging and reports."
      />

      {/* Branch enablement strip */}
      <div className="mb-4 rounded-lg border bg-card p-4">
        <div className="text-sm font-medium mb-2">Cloud Kitchen mode by branch</div>
        <div className="flex flex-wrap gap-3">
          {(branches.data ?? []).map(b => (
            <div key={b.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-sm">{b.name}</span>
              <Switch
                checked={b.cloudKitchenEnabled}
                onCheckedChange={(v) => toggleBranchCK.mutate({ branchId: b.id, enabled: v })}
                data-testid={`switch-branch-ck-${b.id}`}
              />
            </div>
          ))}
          {branches.isLoading && <span className="text-sm text-muted-foreground">Loading branches…</span>}
        </div>
      </div>

      <div className="border-b mb-4 flex flex-wrap gap-1">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-testid={`tab-${t.replace(/\s+/g, "-").toLowerCase()}`}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >{t}</button>
        ))}
      </div>

      {tab === "Brands" && <BrandsTab base={base} brands={brands.data ?? []} branches={branches.data ?? []} channels={channels.data ?? []} />}
      {tab === "Brand Menus" && <BrandMenuTab base={base} brands={brands.data ?? []} />}
      {tab === "Packaging" && <PackagingTab base={base} />}
      {tab === "Channels & Throttle" && <ThrottleTab base={base} brands={brands.data ?? []} channels={channels.data ?? []} />}
      {tab === "SLA Targets" && <SlaTab base={base} brands={brands.data ?? []} channels={channels.data ?? []} />}
      {tab === "Live Orders" && <OrdersTab base={base} brands={brands.data ?? []} channels={channels.data ?? []} />}
      {tab === "Performance" && <PerformanceTab base={base} />}
    </Layout>
  );
}

// ───────── Brands tab ─────────
function BrandsTab({ base, brands, branches, channels }: { base: string; brands: Brand[]; branches: BranchRow[]; channels: ChannelDef[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Brand | null>(null);
  const [open, setOpen] = useState(false);

  const save = useMutation({
    mutationFn: (b: Partial<Brand> & { id?: number }) =>
      b.id ? apiPatch(`${base}/brands/${b.id}`, b) : apiPost(`${base}/brands`, b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-brands"] }); setOpen(false); toast({ title: "Brand saved" }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`${base}/brands/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-brands"] }); toast({ title: "Brand deleted" }); },
  });

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button onClick={() => { setEditing(null); setOpen(true); }} data-testid="button-new-brand">
          <Plus className="h-4 w-4 mr-1" /> New brand
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {brands.map(b => {
          const branch = branches.find(x => x.id === b.branchId);
          return (
            <div key={b.id} className="rounded-lg border bg-card p-4" data-testid={`card-brand-${b.id}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded" style={{ background: b.primaryColor }} />
                  <div>
                    <div className="font-semibold">{b.name}</div>
                    <div className="text-xs text-muted-foreground">/{b.slug}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(b); setOpen(true); }} data-testid={`button-edit-brand-${b.id}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete brand ${b.name}?`)) del.mutate(b.id); }} data-testid={`button-delete-brand-${b.id}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Branch: {branch?.name ?? "All / unassigned"}</div>
                <div>FSSAI: {b.fssaiNumber || "—"} · GST: {b.gstNumber || "—"}</div>
                <div>Channels: {Object.keys(b.channelConfig ?? {}).filter(k => b.channelConfig[k]?.enabled).map(fmtChannelLabel).join(", ") || "None enabled"}</div>
              </div>
            </div>
          );
        })}
        {brands.length === 0 && <div className="text-sm text-muted-foreground col-span-full text-center py-8">No brands yet. Create your first virtual brand.</div>}
      </div>

      <BrandDialog open={open} onOpenChange={setOpen} brand={editing} branches={branches} channels={channels} onSave={(b) => save.mutate(b)} />
    </div>
  );
}

function BrandDialog({ open, onOpenChange, brand, branches, channels, onSave }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  brand: Brand | null;
  branches: BranchRow[];
  channels: ChannelDef[];
  onSave: (b: Partial<Brand> & { id?: number }) => void;
}) {
  const [form, setForm] = useState<Partial<Brand>>(() => brand ?? { name: "", primaryColor: "#f97316", channelConfig: {} });
  const cfg = (form.channelConfig ?? {}) as Record<string, { externalId?: string; commissionPct?: number; enabled?: boolean }>;
  // reset when opening
  useMemo(() => { if (open) setForm(brand ?? { name: "", primaryColor: "#f97316", channelConfig: {} }); }, [open, brand]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{brand ? "Edit brand" : "New brand"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={form.name ?? ""} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="input-brand-name" /></div>
            <div><Label>Slug</Label><Input value={form.slug ?? ""} placeholder="auto" onChange={e => setForm({ ...form, slug: e.target.value })} /></div>
            <div>
              <Label>Branch</Label>
              <Select value={form.branchId ? String(form.branchId) : "all"} onValueChange={(v) => setForm({ ...form, branchId: v === "all" ? null : Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Primary color</Label><Input type="color" value={form.primaryColor ?? "#f97316"} onChange={e => setForm({ ...form, primaryColor: e.target.value })} /></div>
            <div><Label>FSSAI number</Label><Input value={form.fssaiNumber ?? ""} onChange={e => setForm({ ...form, fssaiNumber: e.target.value })} /></div>
            <div><Label>GST number</Label><Input value={form.gstNumber ?? ""} onChange={e => setForm({ ...form, gstNumber: e.target.value })} /></div>
            <div className="col-span-2"><Label>Logo URL</Label><Input value={form.logoUrl ?? ""} onChange={e => setForm({ ...form, logoUrl: e.target.value })} /></div>
          </div>
          <div>
            <Label className="mb-2 block">Channels</Label>
            <div className="space-y-2">
              {channels.map(ch => {
                const c = cfg[ch.key] ?? {};
                return (
                  <div key={ch.key} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-3 flex items-center gap-2">
                      <Switch
                        checked={Boolean(c.enabled)}
                        onCheckedChange={(v) => setForm({ ...form, channelConfig: { ...cfg, [ch.key]: { ...c, enabled: v } } })}
                        data-testid={`switch-channel-${ch.key}`}
                      />
                      <span className="text-sm capitalize">{ch.label}</span>
                    </div>
                    <Input className="col-span-5" placeholder="External ID (e.g. Swiggy outlet id)"
                      value={c.externalId ?? ""}
                      onChange={(e) => setForm({ ...form, channelConfig: { ...cfg, [ch.key]: { ...c, externalId: e.target.value } } })} />
                    <Input className="col-span-4" type="number" step="0.01" placeholder="Commission %"
                      value={c.commissionPct ?? ""}
                      onChange={(e) => setForm({ ...form, channelConfig: { ...cfg, [ch.key]: { ...c, commissionPct: e.target.value === "" ? undefined : Number(e.target.value) } } })} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave(form)} data-testid="button-save-brand">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────── Brand Menus tab ─────────
function BrandMenuTab({ base, brands }: { base: string; brands: Brand[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [brandId, setBrandId] = useState<number | null>(brands[0]?.id ?? null);
  const items = useMenuItems();
  const links = useQuery<BrandMenuLink[]>({
    queryKey: ["ck-brand-menu", brandId],
    queryFn: () => apiGet(`${base}/brands/${brandId}/menu`),
    enabled: !!brandId,
  });

  type Row = { menuItemId: number; priceOverride?: string | null; taxRateOverride?: string | null; isAvailable: boolean };
  const rows: Row[] = useMemo(() => (items.data ?? []).map(it => {
    const l = links.data?.find(x => x.menuItemId === it.id);
    return { menuItemId: it.id, priceOverride: l?.priceOverride ?? null, taxRateOverride: l?.taxRateOverride ?? null, isAvailable: l ? l.isAvailable : false };
  }), [items.data, links.data]);
  const [draft, setDraft] = useState<Row[] | null>(null);
  const effective = draft ?? rows;

  const save = useMutation({
    mutationFn: () => apiPut(`${base}/brands/${brandId}/menu`, { links: effective.filter(r => r.isAvailable || r.priceOverride != null || r.taxRateOverride != null) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-brand-menu", brandId] }); setDraft(null); toast({ title: "Menu saved" }); },
  });

  const update = (id: number, patch: Partial<Row>) => {
    const cur = draft ?? rows;
    setDraft(cur.map(r => r.menuItemId === id ? { ...r, ...patch } : r));
  };

  if (brands.length === 0) return <div className="text-sm text-muted-foreground">Create a brand first.</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Label>Brand</Label>
        <Select value={brandId ? String(brandId) : ""} onValueChange={(v) => { setBrandId(Number(v)); setDraft(null); }}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Pick a brand" /></SelectTrigger>
          <SelectContent>{brands.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button onClick={() => save.mutate()} disabled={!draft} data-testid="button-save-brand-menu">Save menu</Button>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2">Item</th>
              <th className="text-right p-2">Base price</th>
              <th className="text-right p-2">Override price</th>
              <th className="text-right p-2">Override tax %</th>
              <th className="text-center p-2">Available</th>
            </tr>
          </thead>
          <tbody>
            {(items.data ?? []).map(it => {
              const r = effective.find(x => x.menuItemId === it.id)!;
              return (
                <tr key={it.id} className="border-t">
                  <td className="p-2">{it.name}</td>
                  <td className="p-2 text-right">{fmtMoney(it.price)}</td>
                  <td className="p-2 text-right">
                    <Input className="w-28 ml-auto text-right" type="number" step="0.01" value={r.priceOverride ?? ""}
                      onChange={(e) => update(it.id, { priceOverride: e.target.value === "" ? null : e.target.value })} />
                  </td>
                  <td className="p-2 text-right">
                    <Input className="w-24 ml-auto text-right" type="number" step="0.01" value={r.taxRateOverride ?? ""}
                      onChange={(e) => update(it.id, { taxRateOverride: e.target.value === "" ? null : e.target.value })} />
                  </td>
                  <td className="p-2 text-center">
                    <Switch checked={r.isAvailable} onCheckedChange={(v) => update(it.id, { isAvailable: v })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────── Packaging tab ─────────
function PackagingTab({ base }: { base: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const items = useQuery<PackagingItem[]>({ queryKey: ["ck-packaging"], queryFn: () => apiGet(`${base}/packaging`) });
  const menu = useMenuItems();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PackagingItem | null>(null);
  const [form, setForm] = useState<Partial<PackagingItem>>({});

  const save = useMutation({
    mutationFn: () => editing
      ? apiPatch(`${base}/packaging/${editing.id}`, form)
      : apiPost(`${base}/packaging`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-packaging"] }); setOpen(false); toast({ title: "Saved" }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`${base}/packaging/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-packaging"] }); toast({ title: "Deleted" }); },
  });

  // requirements editor for a chosen menu item
  const [reqItemId, setReqItemId] = useState<number | null>(null);
  const reqs = useQuery<Array<{ packagingItemId: number; quantity: string }>>({
    queryKey: ["ck-item-pkg", reqItemId], enabled: !!reqItemId,
    queryFn: () => apiGet(`${base}/items/${reqItemId}/packaging`),
  });
  const [reqDraft, setReqDraft] = useState<Array<{ packagingItemId: number; quantity: string }> | null>(null);
  const effReq = reqDraft ?? reqs.data ?? [];
  const saveReq = useMutation({
    mutationFn: () => apiPut(`${base}/items/${reqItemId}/packaging`, { requirements: effReq.filter(r => Number(r.quantity) > 0) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-item-pkg", reqItemId] }); setReqDraft(null); toast({ title: "Requirements saved" }); },
  });

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="rounded-lg border bg-card">
        <div className="flex justify-between items-center p-3 border-b">
          <div className="font-semibold flex items-center gap-2"><Package className="h-4 w-4" /> Packaging items</div>
          <Button size="sm" onClick={() => { setEditing(null); setForm({ name: "", unit: "piece", currentStock: "0", minStockLevel: "0", costPerUnit: "0" }); setOpen(true); }} data-testid="button-new-packaging">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs">
            <tr><th className="text-left p-2">Item</th><th className="p-2 text-right">Stock</th><th className="p-2 text-right">Min</th><th className="p-2 text-right">Cost</th><th className="p-2"></th></tr>
          </thead>
          <tbody>
            {(items.data ?? []).map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{p.name} <span className="text-xs text-muted-foreground">/{p.unit}</span>
                  {p.isLow && <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3 w-3" /> low</span>}
                </td>
                <td className="p-2 text-right">{Number(p.currentStock).toFixed(2)}</td>
                <td className="p-2 text-right">{Number(p.minStockLevel).toFixed(2)}</td>
                <td className="p-2 text-right">{fmtMoney(p.costPerUnit)}</td>
                <td className="p-2 text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setForm(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete ${p.name}?`)) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {items.data?.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground text-sm">No packaging items yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="p-3 border-b font-semibold">Per-item packaging requirements</div>
        <div className="p-3 space-y-3">
          <Select value={reqItemId ? String(reqItemId) : ""} onValueChange={(v) => { setReqItemId(Number(v)); setReqDraft(null); }}>
            <SelectTrigger><SelectValue placeholder="Pick a menu item" /></SelectTrigger>
            <SelectContent>{(menu.data ?? []).map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
          {reqItemId && (
            <div className="space-y-2">
              {(items.data ?? []).map(p => {
                const r = effReq.find(x => x.packagingItemId === p.id);
                return (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm">{p.name}</span>
                    <Input className="w-24" type="number" step="0.01" value={r?.quantity ?? ""}
                      onChange={(e) => {
                        const cur = effReq.filter(x => x.packagingItemId !== p.id);
                        setReqDraft(e.target.value ? [...cur, { packagingItemId: p.id, quantity: e.target.value }] : cur);
                      }} placeholder="qty" />
                  </div>
                );
              })}
              <Button size="sm" onClick={() => saveReq.mutate()} disabled={!reqDraft}>Save requirements</Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit packaging" : "New packaging"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name</Label><Input value={form.name ?? ""} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Unit</Label><Input value={form.unit ?? "piece"} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
            <div><Label>Cost per unit</Label><Input type="number" step="0.01" value={form.costPerUnit ?? ""} onChange={e => setForm({ ...form, costPerUnit: e.target.value })} /></div>
            <div><Label>Current stock</Label><Input type="number" step="0.01" value={form.currentStock ?? ""} onChange={e => setForm({ ...form, currentStock: e.target.value })} /></div>
            <div><Label>Min stock level</Label><Input type="number" step="0.01" value={form.minStockLevel ?? ""} onChange={e => setForm({ ...form, minStockLevel: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────── Throttle tab ─────────
function ThrottleTab({ base, brands, channels }: { base: string; brands: Brand[]; channels: ChannelDef[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const rules = useQuery<ThrottleRule[]>({ queryKey: ["ck-throttle"], queryFn: () => apiGet(`${base}/throttle`) });
  const [form, setForm] = useState<{ brandId: string; channelKey: string; isPaused: boolean; pauseMinutes: string; maxOrdersPerHour: string; note: string }>(
    { brandId: "all", channelKey: "all", isPaused: false, pauseMinutes: "60", maxOrdersPerHour: "", note: "" });

  const save = useMutation({
    mutationFn: () => apiPost(`${base}/throttle`, {
      brandId: form.brandId === "all" ? null : Number(form.brandId),
      channelKey: form.channelKey === "all" ? null : form.channelKey,
      isPaused: form.isPaused,
      pauseMinutes: form.isPaused ? Number(form.pauseMinutes) : 0,
      maxOrdersPerHour: form.maxOrdersPerHour ? Number(form.maxOrdersPerHour) : null,
      note: form.note || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-throttle"] }); toast({ title: "Rule saved" }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`${base}/throttle/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-throttle"] }); toast({ title: "Deleted" }); },
  });

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="font-semibold mb-3 flex items-center gap-2"><Pause className="h-4 w-4" /> Pause / rate-limit a channel</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Brand</Label>
            <Select value={form.brandId} onValueChange={(v) => setForm({ ...form, brandId: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brands</SelectItem>
                {brands.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Channel</Label>
            <Select value={form.channelKey} onValueChange={(v) => setForm({ ...form, channelKey: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {channels.map(c => <SelectItem key={c.key} value={c.key}>{fmtChannelLabel(c.key)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Switch checked={form.isPaused} onCheckedChange={(v) => setForm({ ...form, isPaused: v })} data-testid="switch-throttle-paused" />
            <span className="text-sm">Pause new orders</span>
          </div>
          {form.isPaused && (
            <div><Label>Pause for (minutes)</Label><Input type="number" value={form.pauseMinutes} onChange={e => setForm({ ...form, pauseMinutes: e.target.value })} /></div>
          )}
          <div><Label>Max orders / hour</Label><Input type="number" placeholder="No limit" value={form.maxOrdersPerHour} onChange={e => setForm({ ...form, maxOrdersPerHour: e.target.value })} /></div>
          <div className="col-span-2"><Label>Note</Label><Textarea rows={2} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
        </div>
        <Button className="mt-3" onClick={() => save.mutate()} data-testid="button-save-throttle">Save rule</Button>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="p-3 border-b font-semibold">Active rules</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs"><tr><th className="text-left p-2">Scope</th><th className="text-left p-2">State</th><th className="text-left p-2">Note</th><th></th></tr></thead>
          <tbody>
            {(rules.data ?? []).map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{brands.find(b => b.id === r.brandId)?.name ?? "All brands"} · {r.channelKey ? fmtChannelLabel(r.channelKey) : "All channels"}</td>
                <td className="p-2">
                  {r.isPaused ? <span className="text-red-600 inline-flex items-center gap-1"><Pause className="h-3 w-3" />Paused{r.pauseUntil ? ` until ${new Date(r.pauseUntil).toLocaleTimeString()}` : ""}</span> :
                    r.maxOrdersPerHour ? <span className="text-amber-600">≤ {r.maxOrdersPerHour}/hr</span> :
                    <span className="text-green-600 inline-flex items-center gap-1"><Play className="h-3 w-3" />Active</span>}
                </td>
                <td className="p-2 text-xs">{r.note}</td>
                <td className="p-2"><Button size="icon" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button></td>
              </tr>
            ))}
            {rules.data?.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No rules.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────── SLA tab ─────────
function SlaTab({ base, brands, channels }: { base: string; brands: Brand[]; channels: ChannelDef[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const targets = useQuery<SlaTarget[]>({ queryKey: ["ck-sla"], queryFn: () => apiGet(`${base}/sla`) });
  const save = useMutation({
    mutationFn: (t: { brandId: number; channelKey: string; prepMinutes: number; handoverMinutes: number }) =>
      apiPut(`${base}/sla`, t),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-sla"] }); toast({ title: "SLA saved" }); },
  });

  const get = (brandId: number, channelKey: string) => targets.data?.find(t => t.brandId === brandId && t.channelKey === channelKey);

  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr><th className="p-2 text-left">Brand</th>{channels.map(c => <th key={c.key} className="p-2 text-center text-xs">{fmtChannelLabel(c.key)}<br /><span className="text-muted-foreground font-normal">prep + handover</span></th>)}</tr>
        </thead>
        <tbody>
          {brands.map(b => (
            <tr key={b.id} className="border-t">
              <td className="p-2 font-medium">{b.name}</td>
              {channels.map(c => {
                const t = get(b.id, c.key);
                return (
                  <td key={c.key} className="p-2">
                    <div className="flex gap-1 items-center justify-center">
                      <Input className="w-14 text-center" type="number" defaultValue={t?.prepMinutes ?? 20}
                        onBlur={(e) => {
                          const prep = Number(e.target.value);
                          save.mutate({ brandId: b.id, channelKey: c.key, prepMinutes: prep, handoverMinutes: t?.handoverMinutes ?? 10 });
                        }} />
                      <span>+</span>
                      <Input className="w-14 text-center" type="number" defaultValue={t?.handoverMinutes ?? 10}
                        onBlur={(e) => {
                          const ho = Number(e.target.value);
                          save.mutate({ brandId: b.id, channelKey: c.key, prepMinutes: t?.prepMinutes ?? 20, handoverMinutes: ho });
                        }} />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          {brands.length === 0 && <tr><td colSpan={channels.length + 1} className="p-4 text-center text-muted-foreground">Create brands first.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ───────── Live Orders tab ─────────
function OrdersTab({ base, brands, channels }: { base: string; brands: Brand[]; channels: ChannelDef[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<{ brandId: string; channelKey: string }>({ brandId: "all", channelKey: "all" });
  const items = useMenuItems();
  const orders = useQuery<CkOrder[]>({
    queryKey: ["ck-orders", filter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filter.brandId !== "all") p.set("brandId", filter.brandId);
      if (filter.channelKey !== "all") p.set("channelKey", filter.channelKey);
      return apiGet(`${base}/orders?${p}`);
    },
    refetchInterval: 15000,
  });

  // intake form
  const [open, setOpen] = useState(false);
  const [intake, setIntake] = useState<{ brandId: string; channelKey: string; channelExternalOrderId: string; customerName: string; customerPhone: string; notes: string; lines: Array<{ menuItemId: number; quantity: number }> }>(
    { brandId: brands[0]?.id?.toString() ?? "", channelKey: "swiggy", channelExternalOrderId: "", customerName: "", customerPhone: "", notes: "", lines: [] });
  const submit = useMutation({
    mutationFn: () => apiPost(`${base}/orders`, {
      brandId: Number(intake.brandId), channelKey: intake.channelKey,
      channelExternalOrderId: intake.channelExternalOrderId || undefined,
      customerName: intake.customerName || undefined, customerPhone: intake.customerPhone || undefined,
      notes: intake.notes || undefined, items: intake.lines.filter(l => l.quantity > 0),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ck-orders"] }); qc.invalidateQueries({ queryKey: ["ck-packaging"] }); setOpen(false); toast({ title: "Order created" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <Select value={filter.brandId} onValueChange={(v) => setFilter({ ...filter, brandId: v })}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All brands</SelectItem>
            {brands.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filter.channelKey} onValueChange={(v) => setFilter({ ...filter, channelKey: v })}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            {channels.map(c => <SelectItem key={c.key} value={c.key}>{fmtChannelLabel(c.key)}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button onClick={() => setOpen(true)} disabled={brands.length === 0} data-testid="button-new-ck-order"><Plus className="h-4 w-4 mr-1" /> New order</Button>
        </div>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs">
            <tr><th className="p-2 text-left">#</th><th className="p-2 text-left">Brand</th><th className="p-2 text-left">Channel</th><th className="p-2 text-left">Customer</th><th className="p-2 text-left">Items</th><th className="p-2 text-right">Total</th><th className="p-2 text-left">Status</th><th className="p-2 text-left">SLA</th></tr>
          </thead>
          <tbody>
            {(orders.data ?? []).map(o => {
              const brand = brands.find(b => b.id === o.brandId);
              const sec = o.slaCountdownSec ?? null;
              const breached = sec != null && sec < 0;
              return (
                <tr key={o.id} className="border-t" data-testid={`row-ck-order-${o.id}`}>
                  <td className="p-2 font-mono text-xs">{o.orderNumber}</td>
                  <td className="p-2">
                    {brand ? (<span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: brand.primaryColor }} />{brand.name}</span>) : "—"}
                  </td>
                  <td className="p-2 text-xs">{o.channelKey ? fmtChannelLabel(o.channelKey) : "—"}{o.channelExternalOrderId ? ` · ${o.channelExternalOrderId}` : ""}</td>
                  <td className="p-2 text-xs">{o.customerName || "—"}<br /><span className="text-muted-foreground">{o.customerPhone}</span></td>
                  <td className="p-2 text-xs">{o.items.map(i => `${i.menuItemName}×${i.quantity}`).join(", ")}</td>
                  <td className="p-2 text-right">{fmtMoney(o.totalAmount)}</td>
                  <td className="p-2"><span className="text-xs px-2 py-0.5 rounded bg-muted">{o.status}</span></td>
                  <td className="p-2 text-xs">
                    {sec == null ? "—" :
                      <span className={cn("inline-flex items-center gap-1", breached ? "text-red-600" : sec < 300 ? "text-amber-600" : "text-green-600")}>
                        <Timer className="h-3 w-3" />
                        {breached ? `${Math.round(-sec / 60)}m late` : `${Math.round(sec / 60)}m left`}
                      </span>}
                  </td>
                </tr>
              );
            })}
            {orders.data?.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No orders in last 24h.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New cloud-kitchen order</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Brand</Label>
              <Select value={intake.brandId} onValueChange={(v) => setIntake({ ...intake, brandId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{brands.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Channel</Label>
              <Select value={intake.channelKey} onValueChange={(v) => setIntake({ ...intake, channelKey: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{channels.map(c => <SelectItem key={c.key} value={c.key}>{fmtChannelLabel(c.key)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>External order ID</Label><Input value={intake.channelExternalOrderId} onChange={e => setIntake({ ...intake, channelExternalOrderId: e.target.value })} /></div>
            <div><Label>Customer name</Label><Input value={intake.customerName} onChange={e => setIntake({ ...intake, customerName: e.target.value })} /></div>
            <div><Label>Customer phone</Label><Input value={intake.customerPhone} onChange={e => setIntake({ ...intake, customerPhone: e.target.value })} /></div>
            <div className="col-span-2"><Label>Notes</Label><Textarea rows={2} value={intake.notes} onChange={e => setIntake({ ...intake, notes: e.target.value })} /></div>
          </div>
          <div className="mt-3">
            <Label className="mb-2 block">Items</Label>
            <div className="space-y-1 max-h-64 overflow-y-auto border rounded p-2">
              {(items.data ?? []).map(it => {
                const line = intake.lines.find(l => l.menuItemId === it.id);
                return (
                  <div key={it.id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm">{it.name} <span className="text-xs text-muted-foreground">{fmtMoney(it.price)}</span></span>
                    <Input className="w-20 text-right" type="number" min={0} value={line?.quantity ?? ""}
                      onChange={(e) => {
                        const qty = Number(e.target.value);
                        const others = intake.lines.filter(l => l.menuItemId !== it.id);
                        setIntake({ ...intake, lines: qty > 0 ? [...others, { menuItemId: it.id, quantity: qty }] : others });
                      }} />
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => submit.mutate()} disabled={!intake.brandId || intake.lines.length === 0}>Create order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────── Performance tab ─────────
function PerformanceTab({ base }: { base: string }) {
  const [days, setDays] = useState(30);
  const data = useQuery<DashboardResp>({
    queryKey: ["ck-dashboard", days],
    queryFn: () => {
      const to = new Date();
      const from = new Date(Date.now() - days * 86400000);
      return apiGet(`${base}/dashboard?from=${from.toISOString()}&to=${to.toISOString()}`);
    },
  });

  const c = data.data?.consolidated;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label>Window</Label>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Today</SelectItem>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {c && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Revenue" value={fmtMoney(c.revenue)} icon={TrendingUp} />
          <Stat label="Orders" value={String(c.orders)} icon={ChefHat} />
          <Stat label="AOV" value={fmtMoney(c.aov)} />
          <Stat label="Gross profit" value={fmtMoney(c.grossProfit)} />
          <Stat label="SLA breaches" value={`${c.slaBreaches} (${c.slaBreachPct}%)`} icon={AlertTriangle} accent={c.slaBreaches > 0 ? "amber" : "green"} />
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {(data.data?.brands ?? []).map(b => (
          <div key={b.brandId ?? "none"} className="rounded-lg border bg-card p-4" data-testid={`card-brand-perf-${b.brandId ?? "none"}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: b.brandColor ?? "#888" }} />
                <span className="font-semibold">{b.brandName}</span>
              </div>
              <div className="text-sm text-muted-foreground">{b.orders} orders · AOV {fmtMoney(b.aov)}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs mb-2">
              <Mini label="Revenue" v={fmtMoney(b.revenue)} />
              <Mini label="Profit" v={fmtMoney(b.grossProfit)} />
              <Mini label="Avg prep" v={b.avgPrepMinutes != null ? `${b.avgPrepMinutes}m` : "—"} />
              <Mini label="Ingredients" v={fmtMoney(b.ingredientCost)} />
              <Mini label="Packaging" v={fmtMoney(b.packagingCost)} />
              <Mini label="Commission" v={fmtMoney(b.commissionCost)} />
            </div>
            <div className="text-xs text-muted-foreground mb-1">SLA breaches: {b.slaBreaches} ({b.slaBreachPct}%)</div>
            <div className="text-xs">
              <div className="font-medium mt-2">Channel mix</div>
              <div className="flex flex-wrap gap-2 mt-1">
                {b.channelMix.map(cm => <span key={cm.channel} className="px-2 py-0.5 rounded bg-muted">{fmtChannelLabel(cm.channel)}: {fmtMoney(cm.revenue)}</span>)}
              </div>
              <div className="font-medium mt-2">Top items</div>
              <ul className="mt-1 space-y-0.5">
                {b.topItems.map((t, i) => <li key={i}>{t.name} — {t.qty}× ({fmtMoney(t.revenue)})</li>)}
              </ul>
            </div>
          </div>
        ))}
        {data.data?.brands.length === 0 && <div className="col-span-full text-sm text-muted-foreground text-center py-8">No order data in this window.</div>}
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, accent }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }>; accent?: "amber" | "green" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground flex items-center gap-1">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className={cn("text-xl font-semibold", accent === "amber" && "text-amber-600", accent === "green" && "text-green-600")}>{value}</div>
    </div>
  );
}
function Mini({ label, v }: { label: string; v: string }) {
  return <div><div className="text-muted-foreground">{label}</div><div className="font-medium">{v}</div></div>;
}
