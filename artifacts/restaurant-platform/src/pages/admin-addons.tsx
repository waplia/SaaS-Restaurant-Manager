import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout as Layout } from "@/components/layout/AdminLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiAction, ApiError } from "@/lib/api";
import { format } from "date-fns";

type AdminAddonRow = {
  addon: {
    id: number; key: string; name: string; description: string; longDescription: string;
    icon: string; category: string;
    pricing: { mode: string; monthlyPrice?: number; yearlyPrice?: number; currency?: string };
    trialDays: number; comingSoon: boolean; isEnabled: boolean;
    includedInPlanIds: number[]; eligiblePlanIds: number[]; featureFlags: string[];
    sortOrder: number;
  };
  activeInstalls: number;
  trialInstalls: number;
  totalInstalls: number;
};

type EventRow = {
  id: number; tenantId: number; addonKey: string; eventType: string;
  source: string; amount: string | null; currency: string | null;
  notes: string | null; createdAt: string;
};

export default function AdminAddonsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"catalogue" | "events" | "tenant">("catalogue");
  const [editing, setEditing] = useState<AdminAddonRow | null>(null);
  const [tenantInput, setTenantInput] = useState("");
  const [tenantId, setTenantId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-addons"],
    queryFn: () => apiFetch<{ addons: AdminAddonRow[] }>("/admin/addons"),
  });

  const { data: eventsData } = useQuery({
    queryKey: ["admin-addon-events"],
    queryFn: () => apiFetch<{ events: EventRow[] }>("/admin/addons/events?limit=200"),
    enabled: tab === "events",
  });

  const { data: tenantData, refetch: refetchTenant } = useQuery({
    queryKey: ["admin-tenant-addons", tenantId],
    queryFn: () => apiFetch<{ addons: any[] }>(`/admin/tenants/${tenantId}/addons`),
    enabled: tab === "tenant" && tenantId != null,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-addons"] });
    qc.invalidateQueries({ queryKey: ["admin-addon-events"] });
    if (tenantId) refetchTenant();
  };

  const toggleEnabled = async (row: AdminAddonRow, isEnabled: boolean) => {
    try {
      const r = await apiAction<{ killed: number }>(`/admin/addons/${row.addon.id}`, "PATCH", { isEnabled });
      toast({
        title: isEnabled ? "Add-on enabled" : "Add-on disabled",
        description: !isEnabled && r.killed ? `Force-uninstalled from ${r.killed} tenants` : undefined,
      });
      refresh();
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof ApiError ? err.message : String(err), variant: "destructive" });
    }
  };

  return (
    <Layout>
      <PageHeader title="Add-on Marketplace" subtitle="Manage the catalogue and per-tenant installs." />
      <div className="p-6 space-y-6">
        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="catalogue">Catalogue</TabsTrigger>
            <TabsTrigger value="events">Activity log</TabsTrigger>
            <TabsTrigger value="tenant">Per-tenant</TabsTrigger>
          </TabsList>

          <TabsContent value="catalogue" className="mt-6">
            {isLoading ? <div className="text-muted-foreground p-8 text-center">Loading…</div> : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Add-on</th>
                      <th className="text-left p-3 font-medium">Category</th>
                      <th className="text-left p-3 font-medium">Pricing</th>
                      <th className="text-right p-3 font-medium">Active</th>
                      <th className="text-right p-3 font-medium">Trial</th>
                      <th className="text-center p-3 font-medium">Coming soon</th>
                      <th className="text-center p-3 font-medium">Enabled</th>
                      <th className="text-right p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.addons ?? []).map(r => (
                      <tr key={r.addon.id} className="border-t" data-testid={`row-addon-${r.addon.key}`}>
                        <td className="p-3">
                          <div className="font-medium">{r.addon.name}</div>
                          <div className="text-xs text-muted-foreground">{r.addon.key}</div>
                        </td>
                        <td className="p-3"><Badge variant="outline">{r.addon.category}</Badge></td>
                        <td className="p-3">{r.addon.pricing.mode === "free" ? "Free" : `₹${r.addon.pricing.monthlyPrice ?? "—"}/mo`}</td>
                        <td className="p-3 text-right">{r.activeInstalls}</td>
                        <td className="p-3 text-right">{r.trialInstalls}</td>
                        <td className="p-3 text-center">{r.addon.comingSoon ? <Badge variant="outline">Soon</Badge> : "—"}</td>
                        <td className="p-3 text-center">
                          <Switch checked={r.addon.isEnabled} onCheckedChange={v => toggleEnabled(r, v)} data-testid={`switch-enabled-${r.addon.key}`} />
                        </td>
                        <td className="p-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => setEditing(r)} data-testid={`button-edit-${r.addon.key}`}>Edit</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="events" className="mt-6">
            <EventsTable events={eventsData?.events ?? []} />
          </TabsContent>

          <TabsContent value="tenant" className="mt-6 space-y-4">
            <form onSubmit={e => { e.preventDefault(); const n = Number(tenantInput); if (Number.isFinite(n)) setTenantId(n); }} className="flex gap-2 items-center">
              <Input placeholder="Tenant ID" value={tenantInput} onChange={e => setTenantInput(e.target.value)} className="w-40" data-testid="input-tenant-id" />
              <Button type="submit" data-testid="button-load-tenant">Load</Button>
              {tenantId && <span className="text-sm text-muted-foreground">Showing tenant #{tenantId}</span>}
            </form>
            {tenantId && tenantData && (
              <TenantAddonsTable tenantId={tenantId} rows={tenantData.addons} onRefresh={refresh} toast={toast} />
            )}
          </TabsContent>
        </Tabs>
      </div>

      <EditDialog row={editing} onClose={() => setEditing(null)} onSaved={refresh} toast={toast} />
    </Layout>
  );
}

function EditDialog({ row, onClose, onSaved, toast }: { row: AdminAddonRow | null; onClose: () => void; onSaved: () => void; toast: ReturnType<typeof useToast>["toast"]; }) {
  const [form, setForm] = useState<any>(null);
  useMemo(() => { if (row) setForm({
    name: row.addon.name, description: row.addon.description, longDescription: row.addon.longDescription,
    monthlyPrice: row.addon.pricing.monthlyPrice ?? 0, yearlyPrice: row.addon.pricing.yearlyPrice ?? 0,
    trialDays: row.addon.trialDays, comingSoon: row.addon.comingSoon, isEnabled: row.addon.isEnabled,
    eligiblePlanIds: (row.addon.eligiblePlanIds ?? []).join(","),
    includedInPlanIds: (row.addon.includedInPlanIds ?? []).join(","),
    featureFlags: (row.addon.featureFlags ?? []).join(","),
  }); }, [row]);
  if (!row || !form) return null;

  const save = async () => {
    try {
      const parseIds = (s: string) => s.split(",").map(x => Number(x.trim())).filter(Number.isFinite);
      await apiAction(`/admin/addons/${row.addon.id}`, "PATCH", {
        name: form.name, description: form.description, longDescription: form.longDescription,
        pricing: { ...row.addon.pricing, monthlyPrice: Number(form.monthlyPrice) || undefined, yearlyPrice: Number(form.yearlyPrice) || undefined },
        trialDays: Number(form.trialDays),
        comingSoon: !!form.comingSoon, isEnabled: !!form.isEnabled,
        eligiblePlanIds: parseIds(form.eligiblePlanIds),
        includedInPlanIds: parseIds(form.includedInPlanIds),
        featureFlags: form.featureFlags.split(",").map((s: string) => s.trim()).filter(Boolean),
      });
      toast({ title: "Saved" });
      onSaved(); onClose();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof ApiError ? err.message : String(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Edit {row.addon.name}</DialogTitle><DialogDescription>{row.addon.key}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Name"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Trial days"><Input type="number" value={form.trialDays} onChange={e => setForm({ ...form, trialDays: e.target.value })} /></Field>
          <Field label="Description" wide><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Long description" wide><Input value={form.longDescription} onChange={e => setForm({ ...form, longDescription: e.target.value })} /></Field>
          <Field label="Monthly price"><Input type="number" value={form.monthlyPrice} onChange={e => setForm({ ...form, monthlyPrice: e.target.value })} /></Field>
          <Field label="Yearly price"><Input type="number" value={form.yearlyPrice} onChange={e => setForm({ ...form, yearlyPrice: e.target.value })} /></Field>
          <Field label="Eligible plan IDs (csv)"><Input value={form.eligiblePlanIds} onChange={e => setForm({ ...form, eligiblePlanIds: e.target.value })} placeholder="1,2,3" /></Field>
          <Field label="Included-in plan IDs (csv)"><Input value={form.includedInPlanIds} onChange={e => setForm({ ...form, includedInPlanIds: e.target.value })} placeholder="3" /></Field>
          <Field label="Feature flags (csv)" wide><Input value={form.featureFlags} onChange={e => setForm({ ...form, featureFlags: e.target.value })} placeholder="khana_ai_enabled" /></Field>
          <label className="flex items-center gap-2"><Switch checked={form.comingSoon} onCheckedChange={v => setForm({ ...form, comingSoon: v })} /> Coming soon</label>
          <label className="flex items-center gap-2"><Switch checked={form.isEnabled} onCheckedChange={v => setForm({ ...form, isEnabled: v })} /> Enabled (kill-switch off)</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} data-testid="button-save-addon">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? "col-span-2" : ""}><div className="text-xs text-muted-foreground mb-1">{label}</div>{children}</div>;
}

function TenantAddonsTable({ tenantId, rows, onRefresh, toast }: { tenantId: number; rows: any[]; onRefresh: () => void; toast: ReturnType<typeof useToast>["toast"]; }) {
  const action = async (key: string, path: string, body?: unknown, label = "Done") => {
    try {
      await apiAction(`/admin/tenants/${tenantId}/addons/${key}/${path}`, "POST", body ?? {});
      toast({ title: label });
      onRefresh();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof ApiError ? err.message : String(err), variant: "destructive" });
    }
  };
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-3 font-medium">Add-on</th>
            <th className="text-left p-3 font-medium">Status</th>
            <th className="text-left p-3 font-medium">Trial ends</th>
            <th className="text-left p-3 font-medium">Renews</th>
            <th className="text-right p-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.addon.id} className="border-t">
              <td className="p-3"><div className="font-medium">{r.addon.name}</div><div className="text-xs text-muted-foreground">{r.addon.key}</div></td>
              <td className="p-3"><Badge variant="outline">{r.includedInPlan ? "included" : r.status}</Badge></td>
              <td className="p-3">{r.install?.trialEndsAt ? format(new Date(r.install.trialEndsAt), "PP") : "—"}</td>
              <td className="p-3">{r.install?.currentPeriodEndsAt ? format(new Date(r.install.currentPeriodEndsAt), "PP") : "—"}</td>
              <td className="p-3 text-right space-x-1">
                <Button size="sm" variant="outline" onClick={() => action(r.addon.key, "install", { startTrial: false }, "Installed")}>Install</Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const days = Number(prompt("Extend trial by how many days?", "14"));
                  if (Number.isFinite(days) && days > 0) action(r.addon.key, "extend", { days }, "Trial extended");
                }}>Extend</Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const months = Number(prompt("Comp how many months?", "3"));
                  if (Number.isFinite(months) && months > 0) action(r.addon.key, "comp", { months }, "Comped");
                }}>Comp</Button>
                <Button size="sm" variant="destructive" onClick={() => action(r.addon.key, "uninstall", { immediate: true }, "Uninstalled")}>Remove</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventsTable({ events }: { events: EventRow[] }) {
  if (events.length === 0) return <div className="text-muted-foreground p-12 text-center border border-dashed rounded-lg">No events yet.</div>;
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-3 font-medium">When</th>
            <th className="text-left p-3 font-medium">Tenant</th>
            <th className="text-left p-3 font-medium">Add-on</th>
            <th className="text-left p-3 font-medium">Event</th>
            <th className="text-left p-3 font-medium">Source</th>
            <th className="text-right p-3 font-medium">Amount</th>
            <th className="text-left p-3 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {events.map(e => (
            <tr key={e.id} className="border-t">
              <td className="p-3 text-muted-foreground whitespace-nowrap">{format(new Date(e.createdAt), "PPp")}</td>
              <td className="p-3">#{e.tenantId}</td>
              <td className="p-3 font-medium">{e.addonKey}</td>
              <td className="p-3">{e.eventType}</td>
              <td className="p-3"><Badge variant="outline">{e.source}</Badge></td>
              <td className="p-3 text-right">{e.amount ? `${e.currency === "INR" ? "₹" : ""}${Number(e.amount).toLocaleString("en-IN")}` : "—"}</td>
              <td className="p-3 text-muted-foreground">{e.notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
