import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { apiFetch, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { LifeBuoy, Loader2, Plus } from "lucide-react";

interface Category { id: number; name: string; slug: string }
interface Ticket { id: number; subject: string; status: string; priority: string; categoryName: string | null; createdAt: string; lastActivityAt: string | null }

export default function PortalHelpPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: cats = [] } = useQuery<Category[]>({ queryKey: ["portal-help-cats"], queryFn: () => apiFetch("/support/categories") });
  const { data: tickets = [] } = useQuery<Ticket[]>({ queryKey: ["portal-help-tickets"], queryFn: () => apiFetch("/support/tickets") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: "", body: "", categoryId: "", priority: "medium" });

  const create = useMutation({
    mutationFn: () => apiPost("/support/tickets", { ...form, categoryId: form.categoryId ? Number(form.categoryId) : undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-help-tickets"] });
      setOpen(false); setForm({ subject: "", body: "", categoryId: "", priority: "medium" });
      toast({ title: "Ticket created" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2"><LifeBuoy className="w-6 h-6" />Help & Support</h1>
          <Button size="sm" onClick={() => setOpen(true)} data-testid="btn-new-ticket"><Plus className="w-4 h-4 mr-1" />New ticket</Button>
        </div>

        <p className="text-xs text-muted-foreground">Reach out to your manager, HR, IT or payroll team. We'll get back to you here.</p>

        {tickets.length === 0 ? <p className="text-sm text-muted-foreground">No tickets yet.</p> : (
          <div className="space-y-2">
            {tickets.map(t => (
              <Card key={t.id}><CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm">{t.subject}</p>
                  <Badge variant={t.status === "closed" || t.status === "resolved" ? "outline" : "default"} className="text-[10px]">{t.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t.categoryName ?? "General"} · {new Date(t.createdAt).toLocaleString()}</p>
              </CardContent></Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New support ticket</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Subject</Label><Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} /></div>
            <div>
              <Label>Category</Label>
              <Select value={form.categoryId} onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>{cats.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Textarea rows={4} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!form.subject || !form.body || create.isPending} data-testid="btn-submit-ticket">
              {create.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
