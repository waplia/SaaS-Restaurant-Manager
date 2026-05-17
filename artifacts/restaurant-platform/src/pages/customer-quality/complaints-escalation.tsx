import { useEffect, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertOctagon } from "lucide-react";
import { useEscalationRule, useUpdateEscalationRule, useEscalationEvents } from "@/lib/hooks-customer-quality";

export default function ComplaintEscalationPage() {
  const { data: ruleData } = useEscalationRule();
  const { data: eventsData } = useEscalationEvents();
  const update = useUpdateEscalationRule();
  const [form, setForm] = useState({ level1Minutes: 30, level2Minutes: 120, level3Minutes: 360, notifyManagers: true, notifyOwners: true, isActive: true });

  useEffect(() => {
    if (ruleData?.rule) {
      const r = ruleData.rule;
      setForm({ level1Minutes: r.level1Minutes, level2Minutes: r.level2Minutes, level3Minutes: r.level3Minutes, notifyManagers: r.notifyManagers, notifyOwners: r.notifyOwners, isActive: r.isActive });
    }
  }, [ruleData?.rule]);

  return (
    <Layout>
      <PageHeader title="Complaint Escalation" description="SLA-based escalation of complaints" icon={AlertOctagon} />
      <Card className="mb-4">
        <CardHeader><CardTitle>SLA Ladder</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>Level 1 (notify manager) — minutes</Label><Input type="number" value={form.level1Minutes} onChange={e => setForm({ ...form, level1Minutes: Number(e.target.value) })} /></div>
            <div><Label>Level 2 (notify owner) — minutes</Label><Input type="number" value={form.level2Minutes} onChange={e => setForm({ ...form, level2Minutes: Number(e.target.value) })} /></div>
            <div><Label>Level 3 (critical) — minutes</Label><Input type="number" value={form.level3Minutes} onChange={e => setForm({ ...form, level3Minutes: Number(e.target.value) })} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2"><Switch checked={form.notifyManagers} onCheckedChange={v => setForm({ ...form, notifyManagers: v })} />Notify managers</label>
            <label className="flex items-center gap-2"><Switch checked={form.notifyOwners} onCheckedChange={v => setForm({ ...form, notifyOwners: v })} />Notify owners</label>
            <label className="flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={v => setForm({ ...form, isActive: v })} />Active</label>
            <Button onClick={() => update.mutate(form)} disabled={update.isPending}>Save</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent escalations</CardTitle></CardHeader>
        <CardContent>
          {(eventsData?.events ?? []).length === 0 && <p className="text-sm text-muted-foreground">No escalations yet.</p>}
          <div className="divide-y">
            {(eventsData?.events ?? []).map((e: any) => (
              <div key={e.id} className="py-2 flex items-center gap-3">
                <Badge variant={e.level === 3 ? "destructive" : "secondary"}>Level {e.level}</Badge>
                <span className="text-sm">Complaint #{e.complaintId}</span>
                <span className="text-sm text-muted-foreground flex-1">{e.message}</span>
                <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}
