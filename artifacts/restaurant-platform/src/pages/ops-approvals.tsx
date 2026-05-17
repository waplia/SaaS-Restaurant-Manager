import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Inbox } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Approval { id: number; type: string; title: string; description: string | null; amount: string | null; status: string; requestedAt: string; decisionComment: string | null; }
const TYPES = ["discount", "refund", "stock_adjustment", "leave", "purchase_order", "price_change", "campaign", "expense", "other"];

export default function OpsApprovalsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [comment, setComment] = useState("");
  const { data = [] } = useQuery<Approval[]>({
    queryKey: ["ops", "approvals", restaurantId, status],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ops/approvals?status=${status}`),
  });
  const [form, setForm] = useState({ type: "discount", title: "", description: "", amount: "" });
  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/ops/approvals`, { ...form, amount: form.amount ? Number(form.amount) : undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ops", "approvals"] }); setForm({ type: "discount", title: "", description: "", amount: "" }); toast({ title: "Approval requested" }); },
  });
  const decide = useMutation({
    mutationFn: ({ id, decision, decisionComment }: { id: number; decision: "approved" | "rejected"; decisionComment?: string }) =>
      apiPatch(`/restaurants/${restaurantId}/ops/approvals/${id}`, { status: decision, decisionComment }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "approvals"] }),
  });
  const bulk = useMutation({
    mutationFn: ({ decision }: { decision: "approved" | "rejected" }) =>
      apiPost(`/restaurants/${restaurantId}/ops/approvals/bulk`, { ids: [...selected], status: decision, decisionComment: comment || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops", "approvals"] });
      toast({ title: `Bulk ${selected.size} decided` });
      setSelected(new Set()); setComment("");
    },
  });
  const toggle = (id: number) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(s => s.size === data.length ? new Set() : new Set(data.map(a => a.id)));

  return (
    <Layout>
      <PageHeader title="Approvals Inbox" subtitle="Voids, comps, discounts, refunds" icon={Inbox} />
      <div className="p-6 space-y-6">
        <Card><CardContent className="p-4 space-y-3">
          <h3 className="font-semibold">Request approval</h3>
          <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
          <Input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <Input type="number" placeholder="Amount (optional)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          <Textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Button onClick={() => create.mutate()} disabled={!form.title}>Submit request</Button>
        </CardContent></Card>

        <Tabs value={status} onValueChange={v => { setStatus(v as typeof status); setSelected(new Set()); }}>
          <TabsList><TabsTrigger value="pending">Pending</TabsTrigger><TabsTrigger value="approved">Approved</TabsTrigger><TabsTrigger value="rejected">Rejected</TabsTrigger></TabsList>
          <TabsContent value={status} className="pt-4 space-y-3">
            {status === "pending" && data.length > 0 && (
              <Card><CardContent className="p-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={selected.size === data.length && data.length > 0} onCheckedChange={toggleAll} /> Select all ({selected.size}/{data.length})</label>
                <Input className="flex-1 min-w-[200px]" placeholder="Decision comment (applied to bulk action)" value={comment} onChange={e => setComment(e.target.value)} />
                <Button size="sm" variant="outline" disabled={selected.size === 0 || bulk.isPending} onClick={() => bulk.mutate({ decision: "rejected" })}>Bulk reject</Button>
                <Button size="sm" disabled={selected.size === 0 || bulk.isPending} onClick={() => bulk.mutate({ decision: "approved" })}>Bulk approve</Button>
              </CardContent></Card>
            )}
            {data.map(a => (
              <Card key={a.id}><CardContent className="p-3 text-sm flex justify-between gap-3">
                <div className="flex gap-3 flex-1">
                  {status === "pending" && <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} />}
                  <div className="flex-1">
                    <Badge variant="outline">{a.type}</Badge> <b className="ml-1">{a.title}</b>
                    {a.amount && <span className="ml-2">₹{a.amount}</span>}
                    {a.description && <div className="text-muted-foreground">{a.description}</div>}
                    {a.decisionComment && <div className="text-xs italic text-muted-foreground mt-1">Decision note: {a.decisionComment}</div>}
                    <div className="text-xs text-muted-foreground">{new Date(a.requestedAt).toLocaleString()}</div>
                  </div>
                </div>
                {a.status === "pending" && (
                  <SingleDecide onDecide={(decision, decisionComment) => decide.mutate({ id: a.id, decision, decisionComment })} />
                )}
              </CardContent></Card>
            ))}
            {data.length === 0 && <div className="text-muted-foreground text-sm">None.</div>}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function SingleDecide({ onDecide }: { onDecide: (decision: "approved" | "rejected", comment?: string) => void }) {
  const [c, setC] = useState("");
  return (
    <div className="flex flex-col gap-1 min-w-[260px]">
      <Input className="text-xs" placeholder="Comment (optional)" value={c} onChange={e => setC(e.target.value)} />
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" onClick={() => onDecide("rejected", c || undefined)}>Reject</Button>
        <Button size="sm" onClick={() => onDecide("approved", c || undefined)}>Approve</Button>
      </div>
    </div>
  );
}
