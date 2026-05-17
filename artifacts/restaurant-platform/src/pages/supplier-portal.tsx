import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getApiUrl } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface PortalData {
  supplier: { id: number; name: string; restaurantId: number };
  requests: Array<{
    id: number; title: string; notes: string | null; status: string;
    neededBy: string | null; sentAt: string;
    items: Array<{ id: number; name: string; unit: string; quantity: string; notes: string | null }>;
  }>;
}

export default function SupplierPortalPage() {
  const [, params] = useRoute<{ token: string }>("/supplier-portal/:token");
  const token = params?.token ?? "";
  const { toast } = useToast();
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prices, setPrices] = useState<Record<number, Record<number, string>>>({});
  const [unavail, setUnavail] = useState<Record<number, Record<number, boolean>>>({});
  const [lead, setLead] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});

  async function load() {
    try {
      const res = await fetch(getApiUrl(`/supplier-portal/${token}`));
      if (!res.ok) throw new Error("invalid");
      setData(await res.json());
    } catch { setError("Invalid or expired portal link."); }
  }
  useEffect(() => { if (token) load(); }, [token]);

  async function submit(requestId: number) {
    const items = (data?.requests.find((r) => r.id === requestId)?.items ?? []).map((it) => ({
      requestItemId: it.id,
      pricePerUnit: Number(prices[requestId]?.[it.id] ?? 0),
      available: !(unavail[requestId]?.[it.id] ?? false),
    }));
    setSubmitting(true);
    try {
      const res = await fetch(getApiUrl(`/supplier-portal/${token}/quotes`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, items, leadTimeDays: lead[requestId] ? Number(lead[requestId]) : undefined, notes: notes[requestId] }),
      });
      if (!res.ok) throw new Error("fail");
      toast({ title: "Quote submitted. Thank you!" });
      await load();
    } catch { toast({ title: "Failed to submit", variant: "destructive" }); }
    finally { setSubmitting(false); }
  }

  if (error) return <div className="min-h-screen flex items-center justify-center"><Card className="p-6">{error}</Card></div>;
  if (!data) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen bg-muted/30 py-8">
      <div className="max-w-4xl mx-auto px-4 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Supplier Portal</h1>
          <p className="text-sm text-muted-foreground">Welcome, {data.supplier.name}. Submit your quotes for the open requests below.</p>
        </div>
        {data.requests.length === 0 && <Card className="p-6 text-center text-muted-foreground">No open RFQs right now.</Card>}
        {data.requests.map((r) => (
          <Card key={r.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-medium text-lg">{r.title}</h2>
                <div className="text-sm text-muted-foreground">{r.notes ?? ""}</div>
                <div className="text-xs text-muted-foreground mt-1">Needed by: {r.neededBy ? new Date(r.neededBy).toLocaleDateString() : "—"}</div>
              </div>
              <Badge>{r.status}</Badge>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Price/unit (₹)</TableHead><TableHead className="w-20">Unavail</TableHead></TableRow></TableHeader>
              <TableBody>
                {r.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.name}</TableCell>
                    <TableCell>{Number(it.quantity)} {it.unit}</TableCell>
                    <TableCell><Input className="w-28" value={prices[r.id]?.[it.id] ?? ""} onChange={(e) => setPrices({ ...prices, [r.id]: { ...(prices[r.id] ?? {}), [it.id]: e.target.value } })} placeholder="0.00" /></TableCell>
                    <TableCell><Checkbox checked={unavail[r.id]?.[it.id] ?? false} onCheckedChange={(c) => setUnavail({ ...unavail, [r.id]: { ...(unavail[r.id] ?? {}), [it.id]: !!c } })} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Lead time (days)</Label><Input value={lead[r.id] ?? ""} onChange={(e) => setLead({ ...lead, [r.id]: e.target.value })} /></div>
              <div><Label>Notes</Label><Textarea rows={2} value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} /></div>
            </div>
            <div className="flex justify-end"><Button disabled={submitting} onClick={() => submit(r.id)}>Submit quote</Button></div>
          </Card>
        ))}
      </div>
    </div>
  );
}
