import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiPost } from "@/lib/api";
import { CalendarDays, Loader2 } from "lucide-react";

interface Balance { leaveType: string; label: string; isPaid: boolean; entitlement: number; opening: number; used: number; remaining: number }
interface Req { id: number; leaveType: string; fromDate: string; toDate: string; halfDay: boolean; totalDays: string; reason: string | null; status: string; decisionNote: string | null }

export default function PortalLeavesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: balances = [] } = useQuery<Balance[]>({ queryKey: ["portal-leave-balances"], queryFn: () => apiFetch("/portal/leave-balances") });
  const { data: requests = [] } = useQuery<Req[]>({ queryKey: ["portal-leave-requests"], queryFn: () => apiFetch("/portal/leave-requests") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ leaveType: "", fromDate: "", toDate: "", halfDay: false, reason: "" });

  const create = useMutation({
    mutationFn: () => apiPost("/portal/leave-requests", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-leave-requests"] });
      setOpen(false); setForm({ leaveType: "", fromDate: "", toDate: "", halfDay: false, reason: "" });
      toast({ title: "Leave request submitted" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => apiPost(`/portal/leave-requests/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-leave-requests"] }),
  });

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2"><CalendarDays className="w-6 h-6" />Leaves</h1>
          <Button size="sm" onClick={() => setOpen(true)} data-testid="btn-apply-leave">Apply leave</Button>
        </div>

        <section>
          <h2 className="font-semibold mb-2 text-sm">Balances ({new Date().getFullYear()})</h2>
          {balances.length === 0 ? <p className="text-sm text-muted-foreground">No leave policies set up.</p> : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {balances.map(b => (
                <Card key={b.leaveType}><CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">{b.label}</p>
                  <p className="text-xl font-bold">{b.remaining.toFixed(1)}</p>
                  <p className="text-[10px] text-muted-foreground">of {b.opening} {b.isPaid && "· paid"}</p>
                </CardContent></Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-2 text-sm">My requests</h2>
          {requests.length === 0 ? <p className="text-sm text-muted-foreground">No requests yet.</p> : (
            <div className="space-y-2">
              {requests.map(r => (
                <Card key={r.id}><CardContent className="p-3 flex items-center justify-between gap-2">
                  <div className="text-sm min-w-0">
                    <p className="font-medium capitalize">{r.leaveType} · {r.totalDays} day{Number(r.totalDays) > 1 ? "s" : ""}</p>
                    <p className="text-xs text-muted-foreground">{new Date(r.fromDate).toLocaleDateString()} → {new Date(r.toDate).toLocaleDateString()}{r.halfDay && " (half-day)"}</p>
                    {r.reason && <p className="text-xs text-muted-foreground truncate">{r.reason}</p>}
                    {r.decisionNote && <p className="text-xs text-muted-foreground">Note: {r.decisionNote}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "outline"}>{r.status}</Badge>
                    {r.status === "pending" && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>Cancel</Button>}
                  </div>
                </CardContent></Card>
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply for leave</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Leave type</Label>
              <Select value={form.leaveType} onValueChange={v => setForm(f => ({ ...f, leaveType: v }))}>
                <SelectTrigger data-testid="select-leave-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {balances.map(b => <SelectItem key={b.leaveType} value={b.leaveType}>{b.label} ({b.remaining.toFixed(1)} left)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>From</Label><Input type="date" value={form.fromDate} onChange={e => setForm(f => ({ ...f, fromDate: e.target.value }))} /></div>
              <div><Label>To</Label><Input type="date" value={form.toDate} onChange={e => setForm(f => ({ ...f, toDate: e.target.value }))} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="half" checked={form.halfDay} onCheckedChange={v => setForm(f => ({ ...f, halfDay: !!v }))} />
              <Label htmlFor="half" className="cursor-pointer">Half day</Label>
            </div>
            <div><Label>Reason</Label><Textarea rows={3} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!form.leaveType || !form.fromDate || !form.toDate || create.isPending} data-testid="btn-submit-leave">
              {create.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
