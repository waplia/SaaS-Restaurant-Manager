import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Send, Award, X, History } from "lucide-react";
import {
  useSuppliers, useInventory,
  usePurchaseRequests, usePurchaseRequest, useCreatePurchaseRequest,
  useSendPurchaseRequest, useAddManualQuote, useAwardPurchaseRequest, useCancelPurchaseRequest,
  usePurchaseHistory,
} from "@/lib/hooks";
import { formatDistanceToNow } from "date-fns";

interface LineDraft { name: string; unit: string; quantity: string; inventoryItemId: number | null; notes?: string }

export default function PurchaseRequestsPage() {
  const { toast } = useToast();
  const { data: requests = [] } = usePurchaseRequests();
  const { data: suppliers = [] } = useSuppliers();
  const { data: inventoryItems = [] } = useInventory();
  const create = useCreatePurchaseRequest();
  const cancel = useCancelPurchaseRequest();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [supplierIds, setSupplierIds] = useState<number[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([{ name: "", unit: "kg", quantity: "1", inventoryItemId: null }]);

  function addLine() { setLines([...lines, { name: "", unit: "kg", quantity: "1", inventoryItemId: null }]); }
  function removeLine(i: number) { setLines(lines.filter((_, idx) => idx !== i)); }
  function updateLine(i: number, patch: Partial<LineDraft>) { setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l)); }
  function toggleSupplier(id: number) { setSupplierIds(supplierIds.includes(id) ? supplierIds.filter((x) => x !== id) : [...supplierIds, id]); }

  async function submitRfq() {
    if (!title || lines.length === 0 || lines.some((l) => !l.name || !l.quantity)) {
      toast({ title: "Title and complete line items required", variant: "destructive" });
      return;
    }
    try {
      const result = await create.mutateAsync({
        title, notes: notes || null, neededBy: neededBy || null, supplierIds,
        items: lines.map((l) => ({ name: l.name, unit: l.unit, quantity: l.quantity, inventoryItemId: l.inventoryItemId, notes: l.notes })),
      });
      toast({ title: "RFQ created" });
      setShowCreate(false);
      setTitle(""); setNotes(""); setNeededBy(""); setSupplierIds([]);
      setLines([{ name: "", unit: "kg", quantity: "1", inventoryItemId: null }]);
      setSelectedId(result.request.id);
    } catch { toast({ title: "Failed to create RFQ", variant: "destructive" }); }
  }

  return (
    <Layout>
      <PageHeader title="Bulk RFQs & Quote Comparison" description="Send RFQs to multiple vendors, compare quotes, and award the winner — auto-generates a purchase order." actions={
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-2" />New RFQ</Button>
      } />

      <Tabs defaultValue="requests" className="space-y-4">
        <TabsList>
          <TabsTrigger value="requests">RFQs</TabsTrigger>
          <TabsTrigger value="history">Purchase History</TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4">
            <Card className="p-3">
              <div className="text-sm font-medium mb-2">All RFQs</div>
              <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                {requests.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">No RFQs yet</div>}
                {requests.map((r) => (
                  <button key={r.id} onClick={() => setSelectedId(r.id)} className={`w-full text-left p-2 rounded hover:bg-muted ${selectedId === r.id ? "bg-muted" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">{r.title}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</div>
                  </button>
                ))}
              </div>
            </Card>
            <div>{selectedId ? <RfqDetail id={selectedId} suppliers={suppliers as any} cancel={cancel.mutateAsync} /> : <Card className="p-8 text-center text-muted-foreground">Select an RFQ</Card>}</div>
          </div>
        </TabsContent>

        <TabsContent value="history"><PurchaseHistoryPanel suppliers={suppliers as any} inventoryItems={inventoryItems as any} /></TabsContent>
      </Tabs>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Create RFQ</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly produce — week 24" /></div>
              <div><Label>Needed by</Label><Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></div>
              <div className="col-span-2"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
            </div>
            <div>
              <Label>Suppliers to invite</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {suppliers.map((s) => (
                  <button key={s.id} onClick={() => toggleSupplier(s.id)} className={`px-3 py-1 rounded border text-sm ${supplierIds.includes(s.id) ? "bg-primary text-primary-foreground" : ""}`}>{s.name}</button>
                ))}
                {suppliers.length === 0 && <span className="text-sm text-muted-foreground">Add suppliers first in Inventory → Suppliers.</span>}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1"><Label>Items</Label><Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3 w-3 mr-1" />Line</Button></div>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      <Label className="text-xs">Item</Label>
                      <Input value={l.name} onChange={(e) => updateLine(i, { name: e.target.value })} placeholder="Tomatoes" />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Link inventory</Label>
                      <Select value={l.inventoryItemId ? String(l.inventoryItemId) : "none"} onValueChange={(v) => {
                        const it = inventoryItems.find((x) => String(x.id) === v);
                        updateLine(i, { inventoryItemId: v === "none" ? null : Number(v), name: it?.name ?? l.name, unit: it?.unit ?? l.unit });
                      }}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {inventoryItems.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2"><Label className="text-xs">Qty</Label><Input value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} /></div>
                    <div className="col-span-2"><Label className="text-xs">Unit</Label><Input value={l.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} /></div>
                    <div className="col-span-1"><Button size="sm" variant="ghost" onClick={() => removeLine(i)}><X className="h-4 w-4" /></Button></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={submitRfq}>Create RFQ</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { draft: "secondary", sent: "default", quoted: "default", awarded: "default", cancelled: "destructive", closed: "secondary" };
  return <Badge variant={(map[status] as any) ?? "secondary"}>{status}</Badge>;
}

function RfqDetail({ id, suppliers, cancel }: { id: number; suppliers: any[]; cancel: (id: number) => Promise<unknown> }) {
  const { toast } = useToast();
  const { data } = usePurchaseRequest(id);
  const send = useSendPurchaseRequest();
  const addQuote = useAddManualQuote();
  const award = useAwardPurchaseRequest();
  const [sendDialog, setSendDialog] = useState(false);
  const [quoteDialog, setQuoteDialog] = useState(false);
  const [pickIds, setPickIds] = useState<number[]>([]);
  const [quoteSupplier, setQuoteSupplier] = useState<number | null>(null);
  const [quoteLead, setQuoteLead] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quotePrices, setQuotePrices] = useState<Record<number, string>>({});
  const [quoteUnavail, setQuoteUnavail] = useState<Record<number, boolean>>({});

  if (!data) return <Card className="p-8 text-center text-muted-foreground">Loading…</Card>;
  const { request, items, recipients, quotes } = data;
  const itemsById = new Map(items.map((i) => [i.id, i]));

  const compareRows = items.map((it) => ({
    item: it,
    byQuote: new Map(quotes.map((q) => [q.id, q.items.find((qi) => qi.requestItemId === it.id) ?? null])),
  }));

  async function doSend() {
    if (pickIds.length === 0) { toast({ title: "Pick at least one supplier", variant: "destructive" }); return; }
    try { await send.mutateAsync({ id, supplierIds: pickIds }); toast({ title: "RFQ sent" }); setSendDialog(false); }
    catch { toast({ title: "Failed", variant: "destructive" }); }
  }
  function openQuote(sid: number) {
    setQuoteSupplier(sid); setQuoteLead(""); setQuoteNotes(""); setQuotePrices({}); setQuoteUnavail({});
    setQuoteDialog(true);
  }
  async function submitQuote() {
    if (!quoteSupplier) return;
    try {
      await addQuote.mutateAsync({
        id, supplierId: quoteSupplier,
        leadTimeDays: quoteLead ? Number(quoteLead) : undefined,
        notes: quoteNotes || undefined,
        items: items.map((it) => ({ requestItemId: it.id, pricePerUnit: Number(quotePrices[it.id] ?? 0), available: !quoteUnavail[it.id] })),
      });
      toast({ title: "Quote recorded" });
      setQuoteDialog(false);
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }
  async function doAward(quoteId: number) {
    if (!confirm("Award this quote? A purchase order will be created.")) return;
    try { const r = await award.mutateAsync({ id, quoteId }); toast({ title: `PO #${r.purchaseOrderId} created` }); }
    catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  const isOpen = request.status === "draft" || request.status === "sent" || request.status === "quoted";
  const sentSupplierIds = new Set(recipients.map((r) => r.supplierId));
  const cheapestQuoteId = quotes.length ? quotes.slice().sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount))[0].id : null;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">{request.title}</h2>
          <div className="text-sm text-muted-foreground">{request.notes ?? "—"}</div>
          <div className="text-xs text-muted-foreground mt-1">Needed by: {request.neededBy ? new Date(request.neededBy).toLocaleDateString() : "—"}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={request.status} />
          <div className="flex gap-2">
            {isOpen && <Button size="sm" variant="outline" onClick={() => { setPickIds([]); setSendDialog(true); }}><Send className="h-4 w-4 mr-1" />Invite vendors</Button>}
            {isOpen && <Button size="sm" variant="outline" onClick={() => { if (suppliers[0]) openQuote(suppliers[0].id); }}><Plus className="h-4 w-4 mr-1" />Record quote</Button>}
            {isOpen && <Button size="sm" variant="ghost" onClick={async () => { if (confirm("Cancel RFQ?")) await cancel(id); }}>Cancel</Button>}
          </div>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium mb-1">Invited vendors</div>
        <div className="flex flex-wrap gap-2">
          {recipients.length === 0 && <span className="text-sm text-muted-foreground">None yet</span>}
          {recipients.map((r) => (
            <Badge key={r.id} variant={r.status === "received" ? "default" : "secondary"}>
              {r.supplierName ?? `#${r.supplierId}`} · {r.status}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-medium mb-1">Quote comparison</div>
        {quotes.length === 0 ? <div className="text-sm text-muted-foreground">No quotes yet</div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item / Qty</TableHead>
                {quotes.map((q) => (
                  <TableHead key={q.id}>
                    <div className="font-medium">{q.supplierName ?? `#${q.supplierId}`}</div>
                    <div className="text-xs text-muted-foreground">{q.leadTimeDays != null ? `${q.leadTimeDays}d` : "?d"} · {q.source}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {compareRows.map((row) => (
                <TableRow key={row.item.id}>
                  <TableCell>
                    <div className="font-medium">{row.item.name}</div>
                    <div className="text-xs text-muted-foreground">{Number(row.item.quantity)} {row.item.unit}</div>
                  </TableCell>
                  {quotes.map((q) => {
                    const qi = row.byQuote.get(q.id);
                    if (!qi) return <TableCell key={q.id} className="text-muted-foreground">—</TableCell>;
                    if (!qi.available) return <TableCell key={q.id}><Badge variant="secondary">Unavail</Badge></TableCell>;
                    return <TableCell key={q.id}>₹{Number(qi.pricePerUnit).toFixed(2)} {qi.alternativeName ? <div className="text-xs text-muted-foreground">{qi.alternativeName}</div> : null}</TableCell>;
                  })}
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                {quotes.map((q) => (
                  <TableCell key={q.id} className={q.id === cheapestQuoteId ? "font-semibold text-primary" : "font-medium"}>
                    ₹{Number(q.totalAmount).toFixed(2)}
                    {q.id === cheapestQuoteId && <Badge className="ml-1" variant="outline">Best</Badge>}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell></TableCell>
                {quotes.map((q) => (
                  <TableCell key={q.id}>
                    {isOpen && q.status === "submitted" && <Button size="sm" onClick={() => doAward(q.id)}><Award className="h-4 w-4 mr-1" />Award</Button>}
                    {q.status === "accepted" && <Badge>Awarded</Badge>}
                    {q.status === "rejected" && <Badge variant="secondary">Rejected</Badge>}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={sendDialog} onOpenChange={setSendDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite vendors</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-80 overflow-auto">
            {suppliers.map((s) => (
              <label key={s.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted">
                <Checkbox checked={pickIds.includes(s.id)} onCheckedChange={(c) => setPickIds(c ? [...pickIds, s.id] : pickIds.filter((x) => x !== s.id))} />
                <span>{s.name}</span>
                {sentSupplierIds.has(s.id) && <Badge variant="secondary" className="ml-auto">Already invited</Badge>}
              </label>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setSendDialog(false)}>Cancel</Button><Button onClick={doSend}>Send</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={quoteDialog} onOpenChange={setQuoteDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Record vendor quote</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Supplier</Label>
                <Select value={quoteSupplier ? String(quoteSupplier) : ""} onValueChange={(v) => setQuoteSupplier(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Lead time (days)</Label><Input value={quoteLead} onChange={(e) => setQuoteLead(e.target.value)} /></div>
              <div className="col-span-2"><Label>Notes</Label><Textarea value={quoteNotes} onChange={(e) => setQuoteNotes(e.target.value)} rows={2} /></div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Price/unit</TableHead><TableHead className="w-20">Unavail</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.name}</TableCell>
                    <TableCell>{Number(it.quantity)} {it.unit}</TableCell>
                    <TableCell><Input className="w-28" value={quotePrices[it.id] ?? ""} onChange={(e) => setQuotePrices({ ...quotePrices, [it.id]: e.target.value })} placeholder="0.00" /></TableCell>
                    <TableCell><Checkbox checked={quoteUnavail[it.id] ?? false} onCheckedChange={(c) => setQuoteUnavail({ ...quoteUnavail, [it.id]: !!c })} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setQuoteDialog(false)}>Cancel</Button><Button onClick={submitQuote}>Save quote</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PurchaseHistoryPanel({ suppliers, inventoryItems }: { suppliers: any[]; inventoryItems: any[] }) {
  const [supplierId, setSupplierId] = useState<string>("all");
  const [itemId, setItemId] = useState<string>("all");
  const { data = [] } = usePurchaseHistory({
    supplierId: supplierId === "all" ? undefined : Number(supplierId),
    inventoryItemId: itemId === "all" ? undefined : Number(itemId),
  });
  return (
    <Card className="p-4 space-y-3">
      <div className="flex gap-2">
        <Select value={supplierId} onValueChange={setSupplierId}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All suppliers</SelectItem>{suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent></Select>
        <Select value={itemId} onValueChange={setItemId}><SelectTrigger className="w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All items</SelectItem>{inventoryItems.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}</SelectContent></Select>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>PO #</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead>Ordered</TableHead><TableHead>Received</TableHead><TableHead>Items</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No purchase history yet</TableCell></TableRow>}
          {data.map((po) => (
            <TableRow key={po.id}>
              <TableCell className="font-mono">#{po.id}</TableCell>
              <TableCell>{po.supplierName ?? "—"}</TableCell>
              <TableCell><Badge variant="secondary">{po.status}</Badge></TableCell>
              <TableCell className="text-xs">{po.orderedAt ? new Date(po.orderedAt).toLocaleDateString() : "—"}</TableCell>
              <TableCell className="text-xs">{po.receivedAt ? new Date(po.receivedAt).toLocaleDateString() : "—"}</TableCell>
              <TableCell className="text-xs">{po.items.map((i) => `${i.name} (${Number(i.quantity)})`).join(", ")}</TableCell>
              <TableCell className="text-right">₹{Number(po.totalAmount).toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
