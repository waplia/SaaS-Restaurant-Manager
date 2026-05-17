import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";

interface Asset { id: number; name: string; kind: string; fileUrl: string | null; thumbnailUrl: string | null; tags: string[]; createdAt: string; }

export default function MenuBrandAssetsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "logo", fileUrl: "", thumbnailUrl: "", tags: "" });

  const { data } = useQuery({ queryKey: ["brand-assets", restaurantId], queryFn: () => apiGet<{ data: Asset[] }>(`/restaurants/${restaurantId}/menu-intel/brand-assets`) });

  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/menu-intel/brand-assets`, {
      name: form.name, kind: form.kind, fileUrl: form.fileUrl, thumbnailUrl: form.thumbnailUrl,
      tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["brand-assets", restaurantId] }); setOpen(false); setForm({ name: "", kind: "logo", fileUrl: "", thumbnailUrl: "", tags: "" }); toast({ title: "Added" }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/menu-intel/brand-assets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brand-assets", restaurantId] }),
  });

  return (
    <Layout>
      <PageHeader title="Brand Asset Library" description="Brand-approved logos, fonts and dish photos." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New asset</Button>} />
      <div className="p-4 sm:p-6 max-w-6xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(data?.data ?? []).map((a) => (
          <Card key={a.id}><CardContent className="p-3 space-y-2">
            {a.thumbnailUrl || a.fileUrl ? <img src={a.thumbnailUrl ?? a.fileUrl!} alt={a.name} className="w-full h-32 object-contain bg-muted rounded" onError={(e) => (e.currentTarget.style.display = "none")} /> : null}
            <div className="flex items-center gap-2"><div className="font-medium flex-1">{a.name}</div><Badge variant="secondary">{a.kind}</Badge></div>
            <div className="flex flex-wrap gap-1">{a.tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}</div>
            <div className="flex gap-2 pt-1">
              {a.fileUrl && <a className="text-xs underline" href={a.fileUrl} target="_blank" rel="noreferrer">Open</a>}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => del.mutate(a.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </CardContent></Card>
        ))}
        {(data?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground col-span-full">No assets yet.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New brand asset</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Kind</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="logo">Logo</SelectItem>
                  <SelectItem value="font">Font</SelectItem>
                  <SelectItem value="dish_photo">Dish photo</SelectItem>
                  <SelectItem value="color_palette">Color palette</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>File URL</Label><Input value={form.fileUrl} onChange={(e) => setForm({ ...form, fileUrl: e.target.value })} /></div>
            <div><Label>Thumbnail URL</Label><Input value={form.thumbnailUrl} onChange={(e) => setForm({ ...form, thumbnailUrl: e.target.value })} /></div>
            <div><Label>Tags (comma)</Label><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={() => create.mutate()} disabled={!form.name}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
