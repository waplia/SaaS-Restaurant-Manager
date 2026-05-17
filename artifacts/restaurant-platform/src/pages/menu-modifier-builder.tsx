import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Send } from "lucide-react";

interface ModGroup { name: string; required?: boolean; options: Array<{ name: string; price: number }> }
interface Tpl { id: number; name: string; description: string | null; groups: ModGroup[]; }

export default function MenuModifierBuilderPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Tpl | null>(null);
  const [form, setForm] = useState({ name: "", description: "", groups: [] as ModGroup[] });
  const [applyFor, setApplyFor] = useState<Tpl | null>(null);
  const [applyIds, setApplyIds] = useState("");

  const { data } = useQuery({ queryKey: ["mod-tpl", restaurantId], queryFn: () => apiGet<{ data: Tpl[] }>(`/restaurants/${restaurantId}/menu-intel/modifier-templates`) });

  const save = useMutation({
    mutationFn: () => editing
      ? apiPatch(`/restaurants/${restaurantId}/menu-intel/modifier-templates/${editing.id}`, form)
      : apiPost(`/restaurants/${restaurantId}/menu-intel/modifier-templates`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mod-tpl", restaurantId] }); setOpen(false); setEditing(null); toast({ title: "Saved" }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/menu-intel/modifier-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mod-tpl", restaurantId] }),
  });
  const apply = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/menu-intel/modifier-templates/${applyFor!.id}/apply`, {
      menuItemIds: applyIds.split(",").map((s) => Number(s.trim())).filter(Boolean),
    }),
    onSuccess: () => { setApplyFor(null); setApplyIds(""); toast({ title: "Applied" }); },
  });

  function openCreate() { setEditing(null); setForm({ name: "", description: "", groups: [] }); setOpen(true); }
  function openEdit(t: Tpl) { setEditing(t); setForm({ name: t.name, description: t.description ?? "", groups: t.groups ?? [] }); setOpen(true); }
  function addGroup() { setForm({ ...form, groups: [...form.groups, { name: "Group", required: false, options: [{ name: "Option", price: 0 }] }] }); }

  return (
    <Layout>
      <PageHeader title="Modifier Builder" description="Reusable modifier templates with bulk attach." actions={<Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />New template</Button>} />
      <div className="p-4 sm:p-6 max-w-5xl space-y-3">
        {(data?.data ?? []).map((t) => (
          <Card key={t.id}><CardContent className="p-4 flex items-center gap-3">
            <div className="flex-1">
              <div className="font-medium">{t.name}</div>
              <div className="text-xs text-muted-foreground">{(t.groups ?? []).length} group(s) — {t.description ?? "no description"}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => { setApplyFor(t); setApplyIds(""); }}><Send className="h-4 w-4 mr-1" />Bulk attach</Button>
            <Button size="sm" variant="outline" onClick={() => openEdit(t)}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => del.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>
          </CardContent></Card>
        ))}
        {(data?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No templates yet.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} template</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="space-y-2">
              <div className="flex justify-between items-center"><Label>Groups</Label><Button size="sm" variant="outline" onClick={addGroup}>Add group</Button></div>
              {form.groups.map((g, gi) => (
                <Card key={gi}><CardContent className="p-3 space-y-2">
                  <div className="flex gap-2">
                    <Input value={g.name} onChange={(e) => { const ng = [...form.groups]; ng[gi] = { ...g, name: e.target.value }; setForm({ ...form, groups: ng }); }} placeholder="Group name" />
                    <Button size="sm" variant="ghost" onClick={() => { const ng = form.groups.filter((_, i) => i !== gi); setForm({ ...form, groups: ng }); }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  {g.options.map((o, oi) => (
                    <div key={oi} className="flex gap-2 pl-4">
                      <Input value={o.name} onChange={(e) => { const ng = [...form.groups]; ng[gi].options[oi] = { ...o, name: e.target.value }; setForm({ ...form, groups: ng }); }} placeholder="Option" />
                      <Input className="w-24" type="number" value={o.price} onChange={(e) => { const ng = [...form.groups]; ng[gi].options[oi] = { ...o, price: Number(e.target.value) }; setForm({ ...form, groups: ng }); }} />
                      <Button size="sm" variant="ghost" onClick={() => { const ng = [...form.groups]; ng[gi].options = g.options.filter((_, i) => i !== oi); setForm({ ...form, groups: ng }); }}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => { const ng = [...form.groups]; ng[gi].options.push({ name: "Option", price: 0 }); setForm({ ...form, groups: ng }); }}>Add option</Button>
                </CardContent></Card>
              ))}
            </div>
          </div>
          <DialogFooter><Button onClick={() => save.mutate()} disabled={!form.name}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={applyFor != null} onOpenChange={(o) => !o && setApplyFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bulk attach: {applyFor?.name}</DialogTitle></DialogHeader>
          <div><Label>Menu item IDs (comma separated)</Label><Input value={applyIds} onChange={(e) => setApplyIds(e.target.value)} placeholder="12, 34, 56" /></div>
          <DialogFooter><Button onClick={() => apply.mutate()} disabled={!applyIds.trim()}>Apply</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
