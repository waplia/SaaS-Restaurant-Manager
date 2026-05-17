import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Item { key: string; label: string; required: boolean }
interface Template { id: number; name: string; items: Item[]; enforceOnClose: boolean; isActive: boolean; }
interface Run { id: number; templateId: number | null; completedItems: string[]; blockers: string[]; notes: string | null; submittedAt: string; }

export default function OpsChecklistsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: templates = [] } = useQuery<Template[]>({ queryKey: ["ops", "closing-templates", restaurantId], queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/closing-templates`) });
  const { data: runs = [] } = useQuery<Run[]>({ queryKey: ["ops", "closing-runs", restaurantId], queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/closing-runs`) });
  // The currently open cash-register session — the server enforces that a
  // checklist run carries this id, otherwise one generic run could satisfy
  // every subsequent close-shift attempt.
  const { data: cashCurrent } = useQuery<{ session: { id: number } | null }>({ queryKey: ["cash-register", "current", restaurantId], queryFn: () => apiGet(`/restaurants/${restaurantId}/cash-register/current`) });
  const sessionId = cashCurrent?.session?.id ?? null;
  const [name, setName] = useState("");
  const [items, setItems] = useState<Item[]>([{ key: "k1", label: "", required: true }]);
  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/ops/closing-templates`, { name, items }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops", "closing-templates"] }); setName(""); setItems([{ key: "k1", label: "", required: true }]); toast({ title: "Template created" }); },
  });
  return (
    <Layout>
      <PageHeader title="Closing Checklists" subtitle="Configurable checklists with sign-off" icon={ClipboardCheck} />
      <div className="p-6">
        <Tabs defaultValue="templates">
          <TabsList><TabsTrigger value="templates">Templates</TabsTrigger><TabsTrigger value="run">Run checklist</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
          <TabsContent value="templates" className="space-y-4 pt-4">
            <Card><CardContent className="p-4 space-y-3">
              <h3 className="font-semibold">New template</h3>
              <Input placeholder="Template name (e.g., Nightly close)" value={name} onChange={e => setName(e.target.value)} />
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input value={it.label} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder={`Item ${i + 1}`} />
                    <Button variant="ghost" size="sm" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4"/></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setItems([...items, { key: `k${items.length + 1}`, label: "", required: true }])}><Plus className="w-4 h-4 mr-1"/>Add item</Button>
              </div>
              <Button onClick={() => create.mutate()} disabled={!name || create.isPending}>Create template</Button>
            </CardContent></Card>
            {templates.map(t => (
              <Card key={t.id}><CardContent className="p-4">
                <div className="font-semibold">{t.name}</div>
                <ul className="list-disc ml-5 text-sm text-muted-foreground">{t.items.map(it => <li key={it.key}>{it.label}</li>)}</ul>
              </CardContent></Card>
            ))}
          </TabsContent>
          <TabsContent value="run" className="pt-4">
            {sessionId == null && <div className="text-sm text-amber-600 mb-2">No cash session is open — opening one is required so the checklist binds to the correct shift.</div>}
            {templates.map(t => <RunForm key={t.id} template={t} restaurantId={restaurantId} sessionId={sessionId} qc={qc} toast={toast} />)}
            {templates.length === 0 && <div className="text-muted-foreground text-sm">Create a template first.</div>}
          </TabsContent>
          <TabsContent value="history" className="pt-4 space-y-2">
            {runs.map(r => (
              <Card key={r.id}><CardContent className="p-3 text-sm">
                <div className="flex justify-between"><span>Run #{r.id}</span><span className="text-muted-foreground">{new Date(r.submittedAt).toLocaleString()}</span></div>
                <div className="text-muted-foreground">Completed {r.completedItems.length} items{r.blockers.length ? ` · ${r.blockers.length} blockers` : ""}</div>
              </CardContent></Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function RunForm({ template, restaurantId, sessionId, qc, toast }: { template: Template; restaurantId: number; sessionId: number | null; qc: ReturnType<typeof useQueryClient>; toast: ReturnType<typeof useToast>["toast"] }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const submit = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/ops/closing-runs`, { templateId: template.id, sessionId, completedItems: Array.from(checked) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops", "closing-runs"] }); setChecked(new Set()); toast({ title: "Checklist submitted" }); },
  });
  return (
    <Card className="mb-3"><CardContent className="p-4 space-y-2">
      <div className="font-semibold">{template.name}</div>
      {template.items.map(it => (
        <label key={it.key} className="flex gap-2 items-center text-sm">
          <Checkbox checked={checked.has(it.key)} onCheckedChange={v => { const s = new Set(checked); v ? s.add(it.key) : s.delete(it.key); setChecked(s); }} />
          {it.label} {it.required && <span className="text-red-500">*</span>}
        </label>
      ))}
      <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending || sessionId == null}>Submit</Button>
    </CardContent></Card>
  );
}
