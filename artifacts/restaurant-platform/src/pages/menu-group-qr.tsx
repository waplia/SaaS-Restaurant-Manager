import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

interface Session { id: number; code: string; status: string; splitMode: string; tableId: number | null; createdAt: string; closedAt: string | null; }

export default function MenuGroupQrPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ tableId: "", splitMode: "single" as "single" | "split" });

  const { data } = useQuery({ queryKey: ["group-sessions", restaurantId], queryFn: () => apiGet<{ data: Session[] }>(`/restaurants/${restaurantId}/menu-intel/group-sessions`) });

  const create = useMutation({
    mutationFn: () => apiPost<Session>(`/restaurants/${restaurantId}/menu-intel/group-sessions`, { tableId: form.tableId ? Number(form.tableId) : null, splitMode: form.splitMode }),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["group-sessions", restaurantId] }); setOpen(false); toast({ title: `Session ${s.code} created` }); },
  });
  const close = useMutation({
    mutationFn: (id: number) => apiPatch(`/restaurants/${restaurantId}/menu-intel/group-sessions/${id}/close`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["group-sessions", restaurantId] }),
  });

  return (
    <Layout>
      <PageHeader title="Group Ordering QR" description="Single QR for a group of guests." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New session</Button>} />
      <div className="p-4 sm:p-6 max-w-4xl space-y-3">
        {(data?.data ?? []).map((s) => (
          <Card key={s.id}><CardContent className="p-4 flex items-center gap-3">
            <div className="flex-1">
              <div className="font-mono text-lg">{s.code}</div>
              <div className="text-xs text-muted-foreground">{s.splitMode === "split" ? "Split cart" : "Single bill"} · Table {s.tableId ?? "—"} · {new Date(s.createdAt).toLocaleString()}</div>
            </div>
            <Badge variant={s.status === "open" ? "default" : "secondary"}>{s.status}</Badge>
            {s.status === "open" && <Button size="sm" variant="outline" onClick={() => close.mutate(s.id)}>Close</Button>}
          </CardContent></Card>
        ))}
        {(data?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No sessions yet.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New group session</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Table ID (optional)</Label><Input type="number" value={form.tableId} onChange={(e) => setForm({ ...form, tableId: e.target.value })} /></div>
            <div><Label>Mode</Label>
              <div className="flex gap-2 mt-1">
                <Button variant={form.splitMode === "single" ? "default" : "outline"} size="sm" onClick={() => setForm({ ...form, splitMode: "single" })}>Single bill</Button>
                <Button variant={form.splitMode === "split" ? "default" : "outline"} size="sm" onClick={() => setForm({ ...form, splitMode: "split" })}>Split cart</Button>
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={() => create.mutate()}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
