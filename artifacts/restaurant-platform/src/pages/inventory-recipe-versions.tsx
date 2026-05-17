import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, Plus, GitBranch, Check, X, Rocket, Undo2, Trash2 } from "lucide-react";
import {
  useRecipeVersions, useRecipeVersionDetail, useCreateRecipeVersion, useUpdateRecipeVersion, useRecipeVersionAction,
  useMenuItems, useInventory, useRecipeMappings,
} from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

interface LineForm { inventoryItemId: number; quantity: string; unit: string }

export default function RecipeVersionsPage() {
  const { toast } = useToast();
  const menuItems = useMenuItems();
  const inventory = useInventory({});
  const ALL = "__all";
  const [selectedMenuItem, setSelectedMenuItem] = useState<string>(ALL);
  const versionsQ = useRecipeVersions(selectedMenuItem && selectedMenuItem !== ALL ? Number(selectedMenuItem) : undefined);
  const [openVersionId, setOpenVersionId] = useState<number | null>(null);
  const detailQ = useRecipeVersionDetail(openVersionId);
  const createV = useCreateRecipeVersion();
  const updateV = useUpdateRecipeVersion();
  const act = useRecipeVersionAction();

  const [createOpen, setCreateOpen] = useState(false);
  const [createMenuItem, setCreateMenuItem] = useState<string>("");
  const [createNotes, setCreateNotes] = useState("");

  const [editLines, setEditLines] = useState<LineForm[]>([]);
  const [editNotes, setEditNotes] = useState("");

  const startEdit = () => {
    if (!detailQ.data) return;
    setEditLines(detailQ.data.lines.map(l => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity, unit: l.unit })));
    setEditNotes(detailQ.data.notes ?? "");
  };

  const saveEdit = async () => {
    if (!openVersionId) return;
    try {
      await updateV.mutateAsync({ id: openVersionId, notes: editNotes, lines: editLines });
      toast({ title: "Draft saved" });
    } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  const doAction = async (action: "submit" | "approve" | "reject" | "activate" | "rollback", reason?: string) => {
    if (!openVersionId) return;
    try {
      await act.mutateAsync({ id: openVersionId, action, reason });
      toast({ title: `Version ${action}d` });
    } catch (e: any) { toast({ title: "Failed", description: e?.message ?? String(e), variant: "destructive" }); }
  };

  const statusColor = (s: string) =>
    s === "active" ? "default" : s === "approved" ? "secondary" :
    s === "pending_approval" ? "outline" : s === "rejected" ? "destructive" : "secondary";

  return (
    <Layout>
      <PageHeader title="Recipe Versions" subtitle="Versioned recipes with approval, diff, rollout & rollback." icon={History}>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-create-version"><Plus className="w-4 h-4 mr-1"/> New version</Button>
      </PageHeader>

      <div className="mb-4 max-w-sm">
        <Label>Filter by dish</Label>
        <Select value={selectedMenuItem} onValueChange={setSelectedMenuItem}>
          <SelectTrigger data-testid="select-menu-filter"><SelectValue placeholder="All dishes"/></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All dishes</SelectItem>
            {(menuItems.data ?? []).map(mi => <SelectItem key={mi.id} value={String(mi.id)}>{mi.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        {versionsQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
        {!versionsQ.isLoading && (versionsQ.data ?? []).length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No recipe versions yet.</CardContent></Card>
        )}
        {(versionsQ.data ?? []).map(v => (
          <Card key={v.id} className={v.isActive ? "border-primary" : ""}>
            <CardContent className="py-3 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
              <div className="flex items-center gap-3 flex-wrap">
                <GitBranch className="w-4 h-4 text-muted-foreground"/>
                <span className="font-medium">{v.menuItemName} · v{v.versionNumber}</span>
                <Badge variant={statusColor(v.status) as any}>{v.status.replace("_", " ")}</Badge>
                {v.isActive && <Badge>LIVE</Badge>}
                <span className="text-xs text-muted-foreground">Cost ₹{Number(v.totalCost).toFixed(2)}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setOpenVersionId(v.id); }} data-testid={`button-open-${v.id}`}>Open</Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New recipe version</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Menu item</Label>
              <Select value={createMenuItem} onValueChange={setCreateMenuItem}>
                <SelectTrigger data-testid="select-create-menu"><SelectValue placeholder="Choose dish…"/></SelectTrigger>
                <SelectContent>{(menuItems.data ?? []).map(mi => <SelectItem key={mi.id} value={String(mi.id)}>{mi.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={createNotes} onChange={e => setCreateNotes(e.target.value)} placeholder="What's changing in this version?" /></div>
            <p className="text-xs text-muted-foreground">Starts as a draft. Edit the lines after creating, then submit for approval.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              if (!createMenuItem) return;
              try {
                const v = await createV.mutateAsync({ menuItemId: Number(createMenuItem), notes: createNotes });
                setCreateOpen(false); setCreateMenuItem(""); setCreateNotes("");
                setOpenVersionId(v.id);
                toast({ title: "Draft created" });
              } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
            }} disabled={!createMenuItem} data-testid="button-create-confirm">Create draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!openVersionId} onOpenChange={(o) => !o && setOpenVersionId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detailQ.data ? `${detailQ.data.menuItemName} · v${detailQ.data.versionNumber}` : "Loading…"}
            </DialogTitle>
          </DialogHeader>
          {detailQ.data && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={statusColor(detailQ.data.status) as any}>{detailQ.data.status.replace("_", " ")}</Badge>
                {detailQ.data.isActive && <Badge>LIVE</Badge>}
                <span className="text-xs text-muted-foreground">Total cost ₹{Number(detailQ.data.totalCost).toFixed(2)}</span>
              </div>

              <RecipeDiffPanel
                menuItemId={detailQ.data.menuItemId}
                draftLines={detailQ.data.lines.map(l => ({ inventoryItemId: l.inventoryItemId, name: l.inventoryItemName, quantity: Number(l.quantity), unit: l.unit }))}
              />

              {detailQ.data.status === "draft" ? (
                <>
                  <div><Label>Notes</Label><Textarea value={editNotes || (detailQ.data.notes ?? "")} onChange={e => setEditNotes(e.target.value)} /></div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Ingredients</Label>
                      <Button size="sm" variant="outline" onClick={() => setEditLines([...(editLines.length ? editLines : detailQ.data!.lines.map(l => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity, unit: l.unit }))), { inventoryItemId: 0, quantity: "1", unit: "kg" }])} data-testid="button-add-line"><Plus className="w-3 h-3 mr-1"/> Add</Button>
                    </div>
                    {(editLines.length ? editLines : detailQ.data.lines.map(l => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity, unit: l.unit }))).map((line, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_90px_70px_40px] gap-2 items-center">
                        <Select value={String(line.inventoryItemId || "")} onValueChange={v => {
                          const nl = [...(editLines.length ? editLines : detailQ.data!.lines.map(l => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity, unit: l.unit })))];
                          const inv = (inventory.data ?? []).find((i: any) => i.id === Number(v));
                          nl[idx] = { ...nl[idx]!, inventoryItemId: Number(v), unit: inv?.unit ?? nl[idx]!.unit };
                          setEditLines(nl);
                        }}>
                          <SelectTrigger data-testid={`select-line-${idx}`}><SelectValue placeholder="Ingredient…"/></SelectTrigger>
                          <SelectContent>{(inventory.data ?? []).filter((i: any) => i.kind === "ingredient" || !i.kind).map((i: any) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input type="number" step="0.001" value={line.quantity} onChange={e => {
                          const nl = [...editLines]; nl[idx] = { ...nl[idx]!, quantity: e.target.value }; setEditLines(nl);
                        }} data-testid={`input-qty-${idx}`}/>
                        <Input value={line.unit} onChange={e => {
                          const nl = [...editLines]; nl[idx] = { ...nl[idx]!, unit: e.target.value }; setEditLines(nl);
                        }}/>
                        <Button size="sm" variant="ghost" onClick={() => setEditLines(editLines.filter((_, i) => i !== idx))}><Trash2 className="w-3 h-3 text-destructive"/></Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => { startEdit(); }} variant="outline" size="sm">Reset to saved</Button>
                    <Button onClick={saveEdit} size="sm" data-testid="button-save-draft">Save draft</Button>
                    <Button onClick={() => doAction("submit")} size="sm" variant="outline" data-testid="button-submit">Submit for approval</Button>
                    <Button onClick={() => doAction("approve")} size="sm" data-testid="button-approve-draft"><Check className="w-3 h-3 mr-1"/>Approve</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Ingredients</Label>
                    {detailQ.data.lines.length === 0 && <p className="text-sm text-muted-foreground">No ingredients in this version.</p>}
                    {detailQ.data.lines.map(l => (
                      <div key={l.id} className="flex justify-between text-sm py-1 border-b">
                        <span>{l.inventoryItemName}</span>
                        <span className="text-muted-foreground">{Number(l.quantity).toFixed(3)} {l.unit} · ₹{Number(l.costAtSnapshot).toFixed(2)}/unit</span>
                      </div>
                    ))}
                  </div>
                  {detailQ.data.notes && <div className="text-sm italic text-muted-foreground">"{detailQ.data.notes}"</div>}
                  <div className="flex gap-2 flex-wrap">
                    {detailQ.data.status === "pending_approval" && <>
                      <Button onClick={() => doAction("approve")} size="sm" data-testid="button-approve"><Check className="w-3 h-3 mr-1"/>Approve</Button>
                      <Button onClick={() => doAction("reject", prompt("Reason for rejection?") ?? undefined)} size="sm" variant="outline" data-testid="button-reject"><X className="w-3 h-3 mr-1"/>Reject</Button>
                    </>}
                    {detailQ.data.status === "approved" && !detailQ.data.isActive && (
                      <Button onClick={() => doAction("activate")} size="sm" data-testid="button-activate"><Rocket className="w-3 h-3 mr-1"/>Activate</Button>
                    )}
                    {(detailQ.data.status === "archived" || detailQ.data.status === "approved") && !detailQ.data.isActive && (
                      <Button onClick={() => doAction("rollback")} size="sm" variant="outline" data-testid="button-rollback"><Undo2 className="w-3 h-3 mr-1"/>Roll back to this version</Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function RecipeDiffPanel({ menuItemId, draftLines }: { menuItemId: number; draftLines: Array<{ inventoryItemId: number; name: string | null; quantity: number; unit: string }> }) {
  const liveQ = useRecipeMappings({ menuItemId });
  const live = (liveQ.data ?? []).filter((m: any) => (m.kind ?? "ingredient") === "ingredient");
  const byInvLive = new Map<number, { name: string | null; quantity: number; unit: string }>();
  for (const m of live as any[]) byInvLive.set(m.inventoryItemId, { name: m.inventoryItemName, quantity: Number(m.quantity), unit: m.unit });
  const byInvNew = new Map<number, { name: string | null; quantity: number; unit: string }>();
  for (const l of draftLines) byInvNew.set(l.inventoryItemId, { name: l.name, quantity: l.quantity, unit: l.unit });
  const ids = new Set<number>([...byInvLive.keys(), ...byInvNew.keys()]);
  const rows = Array.from(ids).map(id => {
    const a = byInvLive.get(id); const b = byInvNew.get(id);
    let kind: "added" | "removed" | "changed" | "same" = "same";
    if (a && !b) kind = "removed";
    else if (!a && b) kind = "added";
    else if (a && b && (a.quantity !== b.quantity || a.unit !== b.unit)) kind = "changed";
    return { id, name: a?.name ?? b?.name ?? `#${id}`, a, b, kind };
  });
  const changes = rows.filter(r => r.kind !== "same");

  return (
    <div className="border rounded-md p-3 bg-muted/30">
      <p className="text-xs font-semibold uppercase tracking-wide mb-2">vs. live recipe ({changes.length} change{changes.length === 1 ? "" : "s"})</p>
      {liveQ.isLoading && <p className="text-xs text-muted-foreground">Loading live recipe…</p>}
      {!liveQ.isLoading && rows.length === 0 && <p className="text-xs text-muted-foreground">No ingredients on either side.</p>}
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground border-b pb-1 mb-1">
        <span>Ingredient</span><span>Live</span><span>This version</span>
      </div>
      {rows.map(r => (
        <div key={r.id} className={`grid grid-cols-[1fr_1fr_1fr] gap-2 text-xs py-1 border-b border-border/40 ${r.kind === "added" ? "bg-green-50 dark:bg-green-950/20" : r.kind === "removed" ? "bg-red-50 dark:bg-red-950/20" : r.kind === "changed" ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
          <span>{r.name}</span>
          <span>{r.a ? `${r.a.quantity.toFixed(3)} ${r.a.unit}` : "—"}</span>
          <span>{r.b ? `${r.b.quantity.toFixed(3)} ${r.b.unit}` : "—"}</span>
        </div>
      ))}
    </div>
  );
}
