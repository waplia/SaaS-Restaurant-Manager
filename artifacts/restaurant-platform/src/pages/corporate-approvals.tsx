import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useApprovals, useDecideApproval } from "@/lib/corporate";

export default function CorporateApprovalsPage() {
  const [tab, setTab] = useState("pending");
  const { data: approvals, isLoading } = useApprovals({ status: tab });
  const decide = useDecideApproval();
  const { toast } = useToast();
  const [comments, setComments] = useState<Record<number, string>>({});

  const onDecide = async (id: number, decision: "approved" | "rejected") => {
    try {
      await decide.mutateAsync({ id, decision, comment: comments[id] });
      toast({ title: `Approval ${decision}` });
    } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Approval inbox</h1>
        <p className="text-sm text-muted-foreground">Review and decide on corporate order approval requests</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card>
        <CardHeader><CardTitle>{tab.charAt(0).toUpperCase() + tab.slice(1)} requests</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <div>Loading…</div> : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr><th className="py-2">Created</th><th>Company</th><th>Requested by</th><th>Order/Bulk</th><th>Amount</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {approvals?.map(a => (
                  <tr key={a.id} className="border-t align-top">
                    <td className="py-2">{new Date(a.createdAt).toLocaleString()}</td>
                    <td>{a.companyName}</td>
                    <td>{a.requestedByName || "—"}</td>
                    <td>{a.orderId ? `Order #${a.orderId}` : a.bulkOrderId ? `Bulk #${a.bulkOrderId}` : "—"}</td>
                    <td>₹{Number(a.amount).toFixed(2)}</td>
                    <td><Badge variant={a.status === "approved" ? "default" : a.status === "rejected" ? "destructive" : "secondary"}>{a.status}</Badge></td>
                    <td>
                      {a.status === "pending" ? (
                        <div className="flex flex-col gap-2">
                          <Input placeholder="Comment (optional)" value={comments[a.id] ?? ""} onChange={e => setComments(c => ({ ...c, [a.id]: e.target.value }))} />
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => onDecide(a.id, "approved")} disabled={decide.isPending}>Approve</Button>
                            <Button size="sm" variant="destructive" onClick={() => onDecide(a.id, "rejected")} disabled={decide.isPending}>Reject</Button>
                          </div>
                        </div>
                      ) : a.comment ?? "—"}
                    </td>
                  </tr>
                ))}
                {approvals?.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Nothing here.</td></tr>}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
