import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Handover { id: number; toUserId: number | null; cashIssue: string | null; stockIssue: string | null; staffIssue: string | null; pendingOrders: string | null; complaints: string | null; tomorrowTasks: string | null; notes: string | null; submittedAt: string; }
interface StaffUser { id: number; name: string | null; email: string | null; role: string; }

const EMPTY = { cashIssue: "", stockIssue: "", staffIssue: "", pendingOrders: "", complaints: "", tomorrowTasks: "", notes: "" };

export default function OpsHandoverPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data = [] } = useQuery<Handover[]>({
    queryKey: ["ops", "handover", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/handovers`),
  });
  // Staff list scoped to this restaurant — used to pick the incoming manager.
  const { data: staff = [] } = useQuery<StaffUser[]>({
    queryKey: ["ops", "handover-staff", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/users`),
  });
  const managers = staff.filter(s => s.role === "owner" || s.role === "manager");
  const [form, setForm] = useState(EMPTY);
  const [toUserId, setToUserId] = useState<string>("");
  const submit = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/ops/handovers`, {
      ...form,
      toUserId: toUserId ? Number(toUserId) : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops", "handover"] }); setForm(EMPTY); setToUserId(""); toast({ title: "Handover submitted" }); },
    onError: (e: unknown) => toast({ title: "Could not submit handover", description: (e as Error).message, variant: "destructive" }),
  });
  const fields: Array<[keyof typeof EMPTY, string]> = [["cashIssue", "Cash issues"], ["stockIssue", "Stock issues"], ["staffIssue", "Staff issues"], ["pendingOrders", "Pending orders"], ["complaints", "Customer complaints"], ["tomorrowTasks", "Tasks for tomorrow"], ["notes", "Other notes"]];
  return (
    <Layout>
      <PageHeader title="Shift Handover" subtitle="Daily manager handover notes" icon={ClipboardCheck} />
      <div className="p-6 space-y-6 max-w-4xl">
        <Card><CardContent className="p-4 space-y-3">
          <h3 className="font-semibold">New handover</h3>
          <div>
            <Label>Next manager (recipient)</Label>
            <Select value={toUserId} onValueChange={setToUserId}>
              <SelectTrigger><SelectValue placeholder="Owners are always notified — pick the incoming manager too" /></SelectTrigger>
              <SelectContent>
                {managers.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name ?? m.email} · {m.role}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {fields.map(([k, label]) => (
            <div key={k}><Label>{label}</Label><Textarea value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} rows={2} /></div>
          ))}
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>{submit.isPending ? "Submitting…" : "Submit handover"}</Button>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <h3 className="font-semibold mb-3">Recent handovers</h3>
          <div className="space-y-3">
            {data.map(h => (
              <div key={h.id} className="border rounded p-3 text-sm">
                <div className="text-xs text-muted-foreground">{new Date(h.submittedAt).toLocaleString()}{h.toUserId ? ` · to user #${h.toUserId}` : ""}</div>
                {fields.map(([k, label]) => h[k] ? <div key={k}><b>{label}:</b> {h[k]}</div> : null)}
              </div>
            ))}
            {data.length === 0 && <div className="text-muted-foreground text-sm">No handovers yet.</div>}
          </div>
        </CardContent></Card>
      </div>
    </Layout>
  );
}
