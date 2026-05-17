import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Soup, Plus, Check, X, Star, Trash2 } from "lucide-react";
import { useTasteTests, useCreateTasteTest, useTasteTestAction, useDeleteTasteTest, useMenuItems, useRecipeVersions } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

interface Form { menuItemId: string; recipeVersionId: string; rating: number; appearance: string; aroma: string; taste: string; texture: string; temperature: string; notes: string; correctiveActions: string; tasterName: string }
const emptyForm: Form = { menuItemId: "", recipeVersionId: "", rating: 4, appearance: "4", aroma: "4", taste: "4", texture: "4", temperature: "4", notes: "", correctiveActions: "", tasterName: "" };

export default function TasteTestingPage() {
  const { toast } = useToast();
  const ALL = "__all";
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const tQ = useTasteTests({ status: statusFilter && statusFilter !== ALL ? statusFilter : undefined });
  const create = useCreateTasteTest();
  const act = useTasteTestAction();
  const del = useDeleteTasteTest();
  const menuItems = useMenuItems();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const versionsQ = useRecipeVersions(form.menuItemId ? Number(form.menuItemId) : undefined);

  const submit = async () => {
    if (!form.menuItemId) { toast({ title: "Choose dish", variant: "destructive" }); return; }
    try {
      await create.mutateAsync({
        menuItemId: Number(form.menuItemId),
        recipeVersionId: form.recipeVersionId && form.recipeVersionId !== ALL ? Number(form.recipeVersionId) : null,
        rating: form.rating,
        appearance: Number(form.appearance), aroma: Number(form.aroma), taste: Number(form.taste),
        texture: Number(form.texture), temperature: Number(form.temperature),
        notes: form.notes || null, correctiveActions: form.correctiveActions || null,
        tasterName: form.tasterName || null,
      });
      setOpen(false); setForm(emptyForm); toast({ title: "Taste test logged" });
    } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  const statusColor = (s: string) => s === "approved" ? "default" : s === "rejected" ? "destructive" : "secondary";

  return (
    <Layout>
      <PageHeader title="Taste Testing" subtitle="Daily QA sign-off per dish with corrective actions." icon={Soup}>
        <Button onClick={() => setOpen(true)} data-testid="button-new-taste-test"><Plus className="w-4 h-4 mr-1"/> New taste test</Button>
      </PageHeader>

      <div className="mb-4 max-w-sm">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger data-testid="select-status-filter"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value={ALL}>All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {tQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {!tQ.isLoading && (tQ.data ?? []).length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No taste tests yet.</CardContent></Card>
      )}

      <div className="space-y-2">
        {(tQ.data ?? []).map(t => (
          <Card key={t.id}>
            <CardContent className="py-3 flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={statusColor(t.status) as any}>{t.status}</Badge>
                  <span className="font-medium">{t.menuItemName ?? `#${t.menuItemId}`}</span>
                  <span className="text-xs text-muted-foreground">{t.recipeVersionId ? `v${t.recipeVersionId}` : "live recipe"} · by {t.tasterName ?? `user ${t.tasterId}`} · {new Date(t.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  {[1,2,3,4,5].map(n => <Star key={n} className={`w-3 h-3 ${n <= t.rating ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"}`}/>)}
                  <span className="text-xs text-muted-foreground ml-2">
                    A:{t.appearance ?? "-"} Ar:{t.aroma ?? "-"} T:{t.taste ?? "-"} Tx:{t.texture ?? "-"} Tp:{t.temperature ?? "-"}
                  </span>
                </div>
                {t.notes && <p className="text-sm mt-1">{t.notes}</p>}
                {t.correctiveActions && <p className="text-sm text-amber-600 mt-1">Action: {t.correctiveActions}</p>}
                {t.rejectedReason && <p className="text-sm text-red-600 mt-1">Rejected: {t.rejectedReason}</p>}
              </div>
              <div className="flex gap-2 flex-wrap">
                {t.status === "pending" && <>
                  <Button size="sm" onClick={() => act.mutate({ id: t.id, action: "approve" })} data-testid={`button-approve-${t.id}`}><Check className="w-3 h-3 mr-1"/>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ id: t.id, action: "reject", reason: prompt("Reason?") ?? undefined })} data-testid={`button-reject-${t.id}`}><X className="w-3 h-3 mr-1"/>Reject</Button>
                </>}
                <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(t.id); }}><Trash2 className="w-3 h-3 text-destructive"/></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New taste test</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Dish</Label>
              <Select value={form.menuItemId} onValueChange={v => setForm({ ...form, menuItemId: v, recipeVersionId: "" })}>
                <SelectTrigger data-testid="select-dish"><SelectValue placeholder="Choose dish…"/></SelectTrigger>
                <SelectContent>{(menuItems.data ?? []).map(mi => <SelectItem key={mi.id} value={String(mi.id)}>{mi.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {form.menuItemId && (versionsQ.data ?? []).length > 0 && (
              <div>
                <Label>Recipe version (optional)</Label>
                <Select value={form.recipeVersionId} onValueChange={v => setForm({ ...form, recipeVersionId: v })}>
                  <SelectTrigger data-testid="select-version"><SelectValue placeholder="Use current live recipe"/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Use current live recipe</SelectItem>
                    {(versionsQ.data ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>v{v.versionNumber} ({v.status})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Your name</Label>
              <Input value={form.tasterName} onChange={e => setForm({ ...form, tasterName: e.target.value })} placeholder="Tester name" data-testid="input-taster"/>
            </div>
            <div>
              <Label>Overall rating: {form.rating} ★</Label>
              <input type="range" min={1} max={5} value={form.rating} onChange={e => setForm({ ...form, rating: Number(e.target.value) })} className="w-full" data-testid="input-rating"/>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {(["appearance", "aroma", "taste", "texture", "temperature"] as const).map(k => (
                <div key={k}>
                  <Label className="text-xs capitalize">{k}</Label>
                  <Input type="number" min={1} max={5} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })}/>
                </div>
              ))}
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Observations…"/></div>
            <div><Label>Corrective actions</Label><Textarea value={form.correctiveActions} onChange={e => setForm({ ...form, correctiveActions: e.target.value })} placeholder="What needs to change?"/></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} data-testid="button-submit-test">Log taste test</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
