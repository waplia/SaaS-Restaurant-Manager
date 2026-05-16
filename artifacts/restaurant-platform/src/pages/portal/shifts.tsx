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
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiPost } from "@/lib/api";
import { CalendarDays, ArrowLeftRight, Loader2 } from "lucide-react";

interface MyShift { id: number; date: string; endDate: string | null; recurringDays: string[] | null; shiftId: number; shiftName: string; startTime: string; endTime: string; days: string[] | null }
interface SwapReq { id: number; kind: string; shiftDate: string; shiftId: number | null; reason: string | null; status: string; decisionNote: string | null; createdAt: string }

export default function PortalShiftsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: shifts = [] } = useQuery<MyShift[]>({ queryKey: ["portal-shifts"], queryFn: () => apiFetch("/portal/shifts") });
  const { data: swaps = [] } = useQuery<SwapReq[]>({ queryKey: ["portal-shift-swaps"], queryFn: () => apiFetch("/portal/shift-swaps") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "unavailable", shiftDate: "", shiftId: "", reason: "" });

  const create = useMutation({
    mutationFn: () => apiPost("/portal/shift-swaps", { ...form, shiftId: form.shiftId ? Number(form.shiftId) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-shift-swaps"] });
      setOpen(false); setForm({ kind: "unavailable", shiftDate: "", shiftId: "", reason: "" });
      toast({ title: "Request submitted" });
    },
    onError: (e: Error) => toast({ title: "Request failed", description: e.message, variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => apiPost(`/portal/shift-swaps/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-shift-swaps"] }),
  });

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2"><CalendarDays className="w-6 h-6" />My Shifts</h1>
          <Button onClick={() => setOpen(true)} size="sm" data-testid="btn-request-swap"><ArrowLeftRight className="w-4 h-4 mr-1" />Request swap</Button>
        </div>

        <section>
          <h2 className="font-semibold mb-2 text-sm">Assigned shifts</h2>
          {shifts.length === 0 ? <p className="text-sm text-muted-foreground">No shifts assigned.</p> : (
            <div className="space-y-2">
              {shifts.map(s => (
                <Card key={s.id}><CardContent className="p-3">
                  <p className="font-medium">{s.shiftName} · {s.startTime}–{s.endTime}</p>
                  <p className="text-xs text-muted-foreground">From {new Date(s.date).toLocaleDateString()}{s.endDate && ` to ${new Date(s.endDate).toLocaleDateString()}`}</p>
                  {(s.recurringDays?.length ?? 0) > 0 && <p className="text-xs text-muted-foreground">Recurring: {s.recurringDays!.join(", ")}</p>}
                </CardContent></Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-2 text-sm">My requests</h2>
          {swaps.length === 0 ? <p className="text-sm text-muted-foreground">No requests yet.</p> : (
            <div className="space-y-2">
              {swaps.map(r => (
                <Card key={r.id}><CardContent className="p-3 flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <p className="font-medium capitalize">{r.kind} · {new Date(r.shiftDate).toLocaleDateString()}</p>
                    {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                    {r.decisionNote && <p className="text-xs text-muted-foreground">Note: {r.decisionNote}</p>}
                  </div>
                  <div className="flex items-center gap-2">
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
          <DialogHeader><DialogTitle>Request shift change</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <Select value={form.kind} onValueChange={v => setForm(f => ({ ...f, kind: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unavailable">Unavailable</SelectItem>
                  <SelectItem value="swap">Request swap</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.shiftDate} onChange={e => setForm(f => ({ ...f, shiftDate: e.target.value }))} data-testid="input-shift-date" />
            </div>
            <div>
              <Label>Shift (optional)</Label>
              <Select value={form.shiftId} onValueChange={v => setForm(f => ({ ...f, shiftId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select a shift" /></SelectTrigger>
                <SelectContent>
                  {[...new Map(shifts.map(s => [s.shiftId, s])).values()].map(s => (
                    <SelectItem key={s.shiftId} value={String(s.shiftId)}>{s.shiftName} ({s.startTime}–{s.endTime})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea rows={3} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!form.shiftDate || create.isPending} data-testid="btn-submit-swap">
              {create.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
