import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useKitchens, useCreateKitchen, useUpdateKitchen, useDeleteKitchen, useKitchenDelayConfig, useUpdateKitchenDelayConfig } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Star, X, Printer, ChefHat } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Kitchen } from "@/lib/types";

interface KitchenForm {
  name: string;
  printerName: string;
  paperSize: "thermal-80mm" | "a5";
  autoPrint: boolean;
  printerTarget: "browser" | "network";
  isDefault: boolean;
}

const EMPTY: KitchenForm = {
  name: "",
  printerName: "",
  paperSize: "thermal-80mm",
  autoPrint: false,
  printerTarget: "browser",
  isDefault: false,
};

export default function SettingsKitchensPage() {
  const { data: kitchens = [], isLoading } = useKitchens();
  const create = useCreateKitchen();
  const update = useUpdateKitchen();
  const del = useDeleteKitchen();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Kitchen | null>(null);
  const [form, setForm] = useState<KitchenForm>(EMPTY);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setShowModal(true);
  };

  const openEdit = (k: Kitchen) => {
    setEditing(k);
    setForm({
      name: k.name,
      printerName: k.printerName ?? "",
      paperSize: (k.paperSize as KitchenForm["paperSize"]) || "thermal-80mm",
      autoPrint: k.autoPrint,
      printerTarget: (k.printerTarget as KitchenForm["printerTarget"]) || "browser",
      isDefault: k.isDefault,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          name: form.name.trim(),
          printerName: form.printerName.trim() || null,
          paperSize: form.paperSize,
          autoPrint: form.autoPrint,
          printerTarget: form.printerTarget,
          isDefault: form.isDefault,
        });
        toast({ title: "Kitchen updated" });
      } else {
        await create.mutateAsync({
          name: form.name.trim(),
          printerName: form.printerName.trim() || null,
          paperSize: form.paperSize,
          autoPrint: form.autoPrint,
          printerTarget: form.printerTarget,
          isDefault: form.isDefault,
        });
        toast({ title: "Kitchen created" });
      }
      setShowModal(false);
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  const handleDelete = async (k: Kitchen) => {
    if (k.isDefault) {
      toast({ title: "Cannot delete default kitchen", variant: "destructive" });
      return;
    }
    if (!confirm(`Delete kitchen "${k.name}"? Items routed here will be reassigned to the default kitchen.`)) return;
    try {
      await del.mutateAsync(k.id);
      toast({ title: "Kitchen deleted" });
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Kitchens & Stations"
        subtitle="Define kitchens (Grill, Fryer, Bar) so orders auto-route to the right station with printable Kitchen Order Tickets."
        actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-1" /> Add Kitchen</Button>}
      />

      <div className="p-6 max-w-4xl">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Printer</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Paper</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Auto-print</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {kitchens.map((k) => (
                  <tr key={k.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ChefHat className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{k.name}</span>
                        {k.isDefault && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                            <Star className="w-2.5 h-2.5" /> DEFAULT
                          </span>
                        )}
                        {!k.isActive && (
                          <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">INACTIVE</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Printer className="w-3.5 h-3.5" />
                        {k.printerName || "—"}
                        <span className="text-[10px] uppercase ml-1 opacity-60">{k.printerTarget}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">{k.paperSize === "a5" ? "A5" : "80mm"}</td>
                    <td className="px-4 py-3">
                      <span className={cn("text-xs font-medium px-2 py-1 rounded-full", k.autoPrint ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                        {k.autoPrint ? "On" : "Off"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(k)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(k)} disabled={k.isDefault}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {kitchens.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-muted-foreground">
                      <ChefHat className="w-10 h-10 mx-auto mb-3 opacity-20" />
                      <p className="text-sm">No kitchens defined yet</p>
                      <p className="text-xs mt-1">Add a kitchen like Grill, Fryer, or Bar to start routing tickets.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <DelayAlertSettings />
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
              <h2 className="text-lg font-semibold">{editing ? "Edit Kitchen" : "Add Kitchen"}</h2>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. Grill, Fryer, Bar" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <Label>Printer Name</Label>
                <Input placeholder="e.g. Star TSP100 — Grill" value={form.printerName} onChange={e => setForm(p => ({ ...p, printerName: e.target.value }))} />
                <p className="text-[10px] text-muted-foreground mt-1">Used as the print job title so OS routes to the right printer.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Paper Size</Label>
                  <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.paperSize} onChange={e => setForm(p => ({ ...p, paperSize: e.target.value as KitchenForm["paperSize"] }))}>
                    <option value="thermal-80mm">Thermal 80mm</option>
                    <option value="a5">A5</option>
                  </select>
                </div>
                <div>
                  <Label>Printer Target</Label>
                  <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.printerTarget} onChange={e => setForm(p => ({ ...p, printerTarget: e.target.value as KitchenForm["printerTarget"] }))}>
                    <option value="browser">Browser dialog</option>
                    <option value="network">Network (silent)</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
                <input type="checkbox" checked={form.autoPrint} onChange={e => setForm(p => ({ ...p, autoPrint: e.target.checked }))} />
                Auto-print KOT when new ticket arrives at the KDS
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isDefault} onChange={e => setForm(p => ({ ...p, isDefault: e.target.checked }))} />
                Default kitchen (used for unassigned items)
              </label>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button className="flex-1" onClick={handleSave} disabled={create.isPending || update.isPending}>
                {editing ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function DelayAlertSettings() {
  const { data: kitchens = [] } = useKitchens();
  const { data: cfgRes, isLoading } = useKitchenDelayConfig();
  const save = useUpdateKitchenDelayConfig();
  const { toast } = useToast();
  const cfg = cfgRes?.data ?? {};
  const [enabled, setEnabled] = useState<boolean>(true);
  const [thresholdMinutes, setThresholdMinutes] = useState<number>(10);
  const [perKitchen, setPerKitchen] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  if (!hydrated && cfgRes) {
    setEnabled(cfg.enabled !== false);
    setThresholdMinutes(typeof cfg.thresholdMinutes === "number" ? cfg.thresholdMinutes : 10);
    const pk: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg.perKitchen ?? {})) pk[k] = String(v);
    setPerKitchen(pk);
    setHydrated(true);
  }

  const handleSave = async () => {
    const pk: Record<string, number> = {};
    for (const [k, v] of Object.entries(perKitchen)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) pk[k] = Math.floor(n);
    }
    try {
      await save.mutateAsync({ enabled, thresholdMinutes: Math.max(1, Math.floor(thresholdMinutes)), perKitchen: pk });
      toast({ title: "Delay alert settings saved" });
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 mt-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Delay Alerts</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Notify waiters, managers, and owners when a kitchen ticket runs past its expected ready time. Default threshold is 10 minutes; override per kitchen below.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Default threshold (minutes past expected)</Label>
          <Input
            type="number"
            min={1}
            value={thresholdMinutes}
            onChange={e => setThresholdMinutes(Number(e.target.value))}
            disabled={isLoading}
          />
        </div>
      </div>

      {kitchens.length > 0 && (
        <div>
          <Label className="mb-2 block">Per-kitchen overrides</Label>
          <div className="border border-border rounded-lg divide-y divide-border">
            {kitchens.map(k => (
              <div key={k.id} className="flex items-center gap-3 px-3 py-2">
                <ChefHat className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium flex-1">{k.name}</span>
                <Input
                  type="number"
                  min={0}
                  placeholder={`${thresholdMinutes}`}
                  className="w-28"
                  value={perKitchen[String(k.id)] ?? ""}
                  onChange={e => setPerKitchen(p => ({ ...p, [String(k.id)]: e.target.value }))}
                />
                <span className="text-xs text-muted-foreground w-12">min</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Leave blank to use the default threshold.</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save delay settings"}</Button>
      </div>
    </div>
  );
}
