import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, ShieldAlert, Check } from "lucide-react";
import { useRiskFlags, useCreateRiskFlag, useUpdateRiskFlag } from "@/lib/hooks-customer-quality";

export default function BlacklistPage() {
  const { data, isLoading } = useRiskFlags();
  const create = useCreateRiskFlag();
  const update = useUpdateRiskFlag();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customerId: "", reason: "abusive", notes: "", riskScore: 70 });
  const flags = data?.flags ?? [];

  return (
    <Layout>
      <PageHeader title="Guest Blacklist & Risk Flags" description="Block disruptive or non-paying guests" icon={ShieldAlert}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Flag customer</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add risk flag</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Customer ID</Label><Input type="number" value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} /></div>
                <div><Label>Reason</Label>
                  <Select value={form.reason} onValueChange={v => setForm({ ...form, reason: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="abusive">Abusive</SelectItem>
                      <SelectItem value="fake_order">Fake order</SelectItem>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="refund_abuse">Refund abuse</SelectItem>
                      <SelectItem value="troublemaker">Troublemaker</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Risk score (0–100)</Label><Input type="number" min={0} max={100} value={form.riskScore} onChange={e => setForm({ ...form, riskScore: Number(e.target.value) })} /></div>
                <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button onClick={async () => {
                  await create.mutateAsync({ customerId: Number(form.customerId), reason: form.reason, notes: form.notes, riskScore: form.riskScore });
                  setOpen(false); setForm({ customerId: "", reason: "abusive", notes: "", riskScore: 70 });
                }} disabled={!form.customerId || create.isPending}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && flags.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No risk flags. Use the button to flag a disruptive customer.</CardContent></Card>
        )}
        {flags.map((f: any) => (
          <Card key={f.id} className={!f.isActive ? "opacity-50" : ""}>
            <CardContent className="py-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{f.customerName ?? f.customerPhone ?? `Customer #${f.customerId}`}</span>
                  <Badge variant={f.riskScore >= 70 ? "destructive" : "secondary"}>Risk {f.riskScore}</Badge>
                  <Badge variant="outline">{f.reason}</Badge>
                  {!f.isActive && <Badge variant="outline">Resolved</Badge>}
                </div>
                {f.notes && <p className="text-sm text-muted-foreground mt-1">{f.notes}</p>}
                <p className="text-xs text-muted-foreground mt-1">{new Date(f.createdAt).toLocaleString()}</p>
              </div>
              {f.isActive && (
                <Button size="sm" variant="outline" onClick={() => update.mutate({ id: f.id, resolve: true })}>
                  <Check className="h-4 w-4 mr-1" /> Resolve
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
