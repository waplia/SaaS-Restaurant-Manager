import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, apiPost } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Plus, Check, X } from "lucide-react";

interface Sub { id: number; menuItemId: number | null; imageUrl: string; caption: string | null; status: string; reviewNotes: string | null; createdAt: string; reviewedAt: string | null; }

export default function MenuPhotoApprovalsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("pending");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ imageUrl: "", menuItemId: "", caption: "" });
  const [reviewing, setReviewing] = useState<Sub | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const { data } = useQuery({
    queryKey: ["photo-subs", restaurantId, tab],
    queryFn: () => apiGet<{ data: Sub[] }>(`/restaurants/${restaurantId}/menu-intel/photo-submissions?status=${tab}`),
  });

  const submit = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/menu-intel/photo-submissions`, {
      imageUrl: form.imageUrl, menuItemId: form.menuItemId ? Number(form.menuItemId) : null, caption: form.caption,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["photo-subs", restaurantId] }); setOpen(false); setForm({ imageUrl: "", menuItemId: "", caption: "" }); toast({ title: "Submitted" }); },
  });
  const review = useMutation({
    mutationFn: (decision: "approved" | "rejected") => apiPost(`/restaurants/${restaurantId}/menu-intel/photo-submissions/${reviewing!.id}/review`, { decision, reviewNotes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["photo-subs", restaurantId] }); setReviewing(null); setReviewNotes(""); toast({ title: "Reviewed" }); },
  });

  return (
    <Layout>
      <PageHeader title="Photo Approvals" description="Review dish photos before they go live on the QR menu." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Submit</Button>} />
      <div className="px-4 sm:px-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList><TabsTrigger value="pending">Pending</TabsTrigger><TabsTrigger value="approved">Approved</TabsTrigger><TabsTrigger value="rejected">Rejected</TabsTrigger></TabsList>
        </Tabs>
      </div>
      <div className="p-4 sm:p-6 max-w-6xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(data?.data ?? []).map((s) => (
          <Card key={s.id}><CardContent className="p-3 space-y-2">
            <img src={s.imageUrl} alt="" className="w-full h-40 object-cover rounded" onError={(e) => (e.currentTarget.style.display = "none")} />
            <div className="text-sm font-medium">{s.menuItemId ? `Item #${s.menuItemId}` : "Unlinked"}</div>
            <div className="text-xs text-muted-foreground">{s.caption ?? "—"}</div>
            <Badge variant={s.status === "approved" ? "default" : s.status === "rejected" ? "destructive" : "secondary"}>{s.status}</Badge>
            {s.status === "pending" && <Button size="sm" onClick={() => setReviewing(s)}>Review</Button>}
          </CardContent></Card>
        ))}
        {(data?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground col-span-full">No submissions.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submit photo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Image URL</Label><Input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://…" /></div>
            <div><Label>Menu item ID (optional)</Label><Input type="number" value={form.menuItemId} onChange={(e) => setForm({ ...form, menuItemId: e.target.value })} /></div>
            <div><Label>Caption</Label><Input value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={() => submit.mutate()} disabled={!form.imageUrl}>Submit</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewing != null} onOpenChange={(o) => !o && setReviewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review photo</DialogTitle></DialogHeader>
          {reviewing && <img src={reviewing.imageUrl} alt="" className="w-full max-h-72 object-contain rounded" />}
          <div><Label>Notes</Label><Textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} /></div>
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={() => review.mutate("rejected")}><X className="h-4 w-4 mr-1" />Reject</Button>
            <Button onClick={() => review.mutate("approved")}><Check className="h-4 w-4 mr-1" />Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
