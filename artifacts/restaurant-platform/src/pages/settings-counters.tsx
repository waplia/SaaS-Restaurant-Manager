import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useCounters, useCreateCounter, useUpdateCounter, useDeleteCounter, useUnclaimCounter,
  useRestaurantBranches,
  type CounterRecord,
} from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, X, Monitor, Link2Off, CheckCircle2, AlertCircle } from "lucide-react";

interface CounterForm {
  name: string;
  branchId: number | null;
  description: string;
  isActive: boolean;
}

const EMPTY: CounterForm = { name: "", branchId: null, description: "", isActive: true };

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "Never";
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SettingsCountersPage() {
  const { toast } = useToast();
  const { data: counters, isLoading } = useCounters();
  const { data: branches } = useRestaurantBranches();
  const create = useCreateCounter();
  const update = useUpdateCounter();
  const del = useDeleteCounter();
  const unclaim = useUnclaimCounter();

  const [editing, setEditing] = useState<CounterRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CounterForm>(EMPTY);

  const branchById = useMemo(() => {
    const m = new Map<number, string>();
    (branches ?? []).forEach((b) => m.set(b.id, b.name));
    return m;
  }, [branches]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setShowForm(true);
  };
  const openEdit = (c: CounterRecord) => {
    setEditing(c);
    setForm({
      name: c.name,
      branchId: c.branchId,
      description: c.description ?? "",
      isActive: c.isActive,
    });
    setShowForm(true);
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) { toast({ title: "Name is required", variant: "destructive" }); return; }
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          name,
          branchId: form.branchId,
          description: form.description.trim() || null,
          isActive: form.isActive,
        });
        toast({ title: "Counter updated" });
      } else {
        await create.mutateAsync({
          name,
          branchId: form.branchId,
          description: form.description.trim() || null,
          isActive: form.isActive,
        });
        toast({ title: "Counter created" });
      }
      setShowForm(false);
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onDelete = async (c: CounterRecord) => {
    if (!confirm(`Delete counter "${c.name}"? Past reports and Z-reports linked to it will keep its name on record.`)) return;
    try {
      await del.mutateAsync(c.id);
      toast({ title: "Counter deleted" });
    } catch (e) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const onUnclaim = async (c: CounterRecord) => {
    if (!confirm(`Release "${c.name}" from its workstation? The cashier will have to re-bind on their next launch.`)) return;
    try {
      await unclaim.mutateAsync(c.id);
      toast({ title: "Workstation binding released" });
    } catch (e) {
      toast({ title: "Unclaim failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Layout>
      <PageHeader
        title="POS Counters"
        description="A counter is one cash register / workstation at an outlet. Each Khanalagao Desktop POS install claims one counter. Card readers are managed under Settings → Card Terminals."
        actions={
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New Counter</Button>
        }
      />

      {isLoading && <div className="text-sm text-muted-foreground p-4">Loading counters…</div>}

      {!isLoading && counters && counters.length === 0 && (
        <div className="border border-dashed rounded-lg p-10 text-center text-muted-foreground">
          <Monitor className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <div className="font-medium mb-1">No counters yet</div>
          <div className="text-sm mb-4">Create one counter per cash register / workstation at your outlet.</div>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Create first counter</Button>
        </div>
      )}

      {!isLoading && counters && counters.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Counter</th>
                <th className="px-3 py-2 font-medium">Outlet</th>
                <th className="px-3 py-2 font-medium">Workstation</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium w-px">Actions</th>
              </tr>
            </thead>
            <tbody>
              {counters.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.name}</div>
                    {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.branchId ? (branchById.get(c.branchId) ?? `Outlet #${c.branchId}`) : <span className="italic">Any outlet</span>}
                  </td>
                  <td className="px-3 py-2">
                    {c.machineId ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        Bound{c.appVersion && <span className="text-muted-foreground">· v{c.appVersion}</span>}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5" /> Unbound
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">{relativeTime(c.lastSeenAt)}</td>
                  <td className="px-3 py-2">
                    {c.isActive
                      ? <span className="text-xs text-green-700">Active</span>
                      : <span className="text-xs text-muted-foreground">Inactive</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(c)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                      {c.machineId && (
                        <Button variant="ghost" size="icon" onClick={() => onUnclaim(c)} title="Release workstation binding"><Link2Off className="h-4 w-4" /></Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => onDelete(c)} title="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-card border rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold">{editing ? "Edit counter" : "New counter"}</div>
              <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X className="h-4 w-4" /></Button>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Counter 1" maxLength={60} autoFocus />
              </div>

              <div>
                <Label>Outlet (optional)</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 bg-background text-sm"
                  value={form.branchId ?? ""}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">— Any outlet —</option>
                  {(branches ?? []).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <div className="text-xs text-muted-foreground mt-1">Leave blank for a single-outlet restaurant.</div>
              </div>

              <div>
                <Label>Description</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Front cash desk near entrance" maxLength={240} />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
                <Label className="cursor-pointer" onClick={() => setForm({ ...form, isActive: !form.isActive })}>
                  Active (can be claimed by a desktop POS)
                </Label>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={save} disabled={create.isPending || update.isPending}>
                {editing ? (update.isPending ? "Saving…" : "Save") : (create.isPending ? "Creating…" : "Create")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
