import { useRef, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  FileText, Upload, AlertTriangle, CheckCircle2, XCircle, Loader2, Receipt, Link2, Trash2,
} from "lucide-react";
import {
  useVendorInvoices, useVendorInvoice, useUploadVendorInvoice, useCorrectVendorInvoice,
  useMatchVendorInvoicePo, useApproveVendorInvoice, useRejectVendorInvoice, useDeleteVendorInvoice,
  useExpenseCategories, useSuppliers, usePurchaseOrders, useInventory, useRestaurantId,
  type VendorInvoice, type VendorInvoiceLine,
} from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { apiPost, getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<VendorInvoice["status"], string> = {
  draft: "Draft",
  matched: "PO matched",
  approved: "Approved",
  rejected: "Rejected",
};
const STATUS_CLS: Record<VendorInvoice["status"], string> = {
  draft:    "bg-slate-100 text-slate-700 border-slate-200",
  matched:  "bg-blue-50 text-blue-700 border-blue-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

function fmtMoney(v: string | number, ccy = "INR") {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const sym = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : `${ccy} `;
  return `${sym}${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

async function uploadInvoiceFile(rid: number, file: File): Promise<string> {
  const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
    `/restaurants/${rid}/storage/uploads/request-url`,
    { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
  );
  const put = await fetch(presign.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  await apiPost(`/restaurants/${rid}/storage/uploads/finalize`, { objectPath: presign.objectPath });
  return presign.objectPath;
}

export default function VendorInvoicesPage() {
  const { toast } = useToast();
  const rid = useRestaurantId();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const listQ = useVendorInvoices(statusFilter === "all" ? undefined : statusFilter);
  const detailQ = useVendorInvoice(selectedId);

  return (
    <Layout>
      <PageHeader
        title="Vendor Invoices OCR"
        subtitle="Upload supplier invoices — Khana AI extracts vendor, totals and line items, matches a PO and flags price variances before you book the bill."
        icon={FileText}
      >
        <Button onClick={() => setUploadOpen(true)} data-testid="button-upload-invoice">
          <Upload className="w-4 h-4 mr-1" /> Upload invoice
        </Button>
      </PageHeader>

      <div className="flex items-center gap-3 mb-4">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44" data-testid="select-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="matched">PO matched</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {listQ.isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 mx-auto animate-spin" />
            </div>
          ) : (listQ.data ?? []).length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No vendor invoices yet. Upload one to get started.
            </div>
          ) : (
            <div className="divide-y">
              {(listQ.data ?? []).map((inv) => (
                <button
                  key={inv.id}
                  onClick={() => setSelectedId(inv.id)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/40 flex items-center gap-4"
                  data-testid={`row-invoice-${inv.id}`}
                >
                  <Receipt className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{inv.vendorName || "Unknown vendor"}</span>
                      <span className="text-xs text-muted-foreground">#{inv.invoiceNumber || `draft-${inv.id}`}</span>
                      <Badge variant="outline" className={cn("text-[11px]", STATUS_CLS[inv.status])}>
                        {STATUS_LABEL[inv.status]}
                      </Badge>
                      {inv.hasPriceVariance === "true" && (
                        <Badge variant="outline" className="text-[11px] bg-amber-50 text-amber-700 border-amber-200">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Price variance
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {fmtDate(inv.invoiceDate)} • uploaded {fmtDate(inv.createdAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{fmtMoney(inv.totalAmount, inv.currency)}</div>
                    <div className="text-[11px] text-muted-foreground">total</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        rid={rid}
        onUploaded={(id) => { setUploadOpen(false); setSelectedId(id); listQ.refetch(); }}
      />

      <Dialog open={selectedId != null} onOpenChange={(v) => { if (!v) setSelectedId(null); }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice review</DialogTitle>
          </DialogHeader>
          {detailQ.isLoading || !detailQ.data ? (
            <div className="p-8 text-center"><Loader2 className="w-4 h-4 mx-auto animate-spin" /></div>
          ) : (
            <InvoiceDetail
              rid={rid}
              invoice={detailQ.data.invoice}
              lines={detailQ.data.lines}
              onChanged={() => { detailQ.refetch(); listQ.refetch(); }}
              onClose={() => setSelectedId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

// ─── Upload dialog ───────────────────────────────────────────────────────────

function UploadDialog({ open, onOpenChange, rid, onUploaded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rid: number;
  onUploaded: (id: number) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [poId, setPoId] = useState<string>("none");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const pos = usePurchaseOrders();
  const upload = useUploadVendorInvoice();

  const reset = () => { setFile(null); setPoId("none"); setNotes(""); if (fileRef.current) fileRef.current.value = ""; };

  const submit = async () => {
    if (!file) { toast({ title: "Choose a PDF or image first", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const objectPath = await uploadInvoiceFile(rid, file);
      const pageHint = file.type === "application/pdf" ? Math.min(10, Math.max(1, Math.ceil(file.size / (250 * 1024)))) : 1;
      const result = await upload.mutateAsync({
        objectPath,
        purchaseOrderId: poId === "none" ? undefined : Number(poId),
        pageCountHint: pageHint,
        notes: notes || undefined,
      });
      toast({
        title: "Invoice processed",
        description: result.hasPriceVariance ? "Price variance detected — review before approving." : "Review the extracted fields and approve.",
      });
      reset();
      onUploaded(result.id);
    } catch (e) {
      const err = e as Error & { code?: string; status?: number };
      const body = (err as unknown as { body?: { code?: string; error?: string } }).body;
      const code = err.code ?? body?.code;
      if (code === "CONFIGURATION_REQUIRED" || /CONFIGURATION_REQUIRED|Khana AI is not configured/i.test(err.message)) {
        toast({
          title: "Khana AI not configured",
          description: "Connect a vision-capable AI provider in Settings → AI to enable invoice OCR.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      }
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Upload vendor invoice</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Invoice file (PDF or image)</Label>
            <Input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="input-invoice-file"
            />
            <p className="text-xs text-muted-foreground mt-1">Max 10 MB. OCR uses Khana AI credits (5 credits per page).</p>
          </div>
          <div>
            <Label>Match purchase order (optional)</Label>
            <Select value={poId} onValueChange={setPoId}>
              <SelectTrigger data-testid="select-po"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Auto / none —</SelectItem>
                {(pos.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    PO #{p.id} — {fmtMoney(p.totalAmount)} ({p.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Internal notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. delivered late, partial shipment" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !file} data-testid="button-submit-upload">
            {busy ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Extracting…</> : <><Upload className="w-4 h-4 mr-1" /> Upload & extract</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Detail / review panel ───────────────────────────────────────────────────

interface EditableLine {
  id?: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  matchedInventoryItemId: number | null;
  matchedPoItemId: number | null;
  priceVariancePct: string | null;
}

function InvoiceDetail({ rid, invoice, lines, onChanged, onClose }: {
  rid: number;
  invoice: VendorInvoice;
  lines: VendorInvoiceLine[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const cats = useExpenseCategories();
  const suppliers = useSuppliers();
  const pos = usePurchaseOrders();
  const items = useInventory();
  const correct = useCorrectVendorInvoice();
  const matchPo = useMatchVendorInvoicePo();
  const approve = useApproveVendorInvoice();
  const reject = useRejectVendorInvoice();
  const del = useDeleteVendorInvoice();

  const [vendorName, setVendorName] = useState(invoice.vendorName ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate ?? "");
  const [dueDate, setDueDate] = useState(invoice.dueDate ?? "");
  const [totalAmount, setTotalAmount] = useState(String(invoice.totalAmount));
  const [taxAmount, setTaxAmount] = useState(String(invoice.taxAmount));
  const [supplierId, setSupplierId] = useState<string>(invoice.supplierId ? String(invoice.supplierId) : "none");
  const [poId, setPoId] = useState<string>(invoice.purchaseOrderId ? String(invoice.purchaseOrderId) : "none");
  const [editedLines, setEditedLines] = useState<EditableLine[]>(() => lines.map((l) => ({
    id: l.id, description: l.description, quantity: Number(l.quantity), unit: l.unit,
    unitPrice: Number(l.unitPrice), lineTotal: Number(l.lineTotal),
    matchedInventoryItemId: l.matchedInventoryItemId, matchedPoItemId: l.matchedPoItemId,
    priceVariancePct: l.priceVariancePct,
  })));
  const [expenseCategoryId, setExpenseCategoryId] = useState<string>("");

  const readonly = invoice.status === "approved" || invoice.status === "rejected";
  const fileHref = getApiUrl(`/restaurants/${rid}/vendor-invoices/${invoice.id}/file`);

  const confidence = (key: string) => {
    const c = invoice.confidenceScores?.[key];
    if (typeof c !== "number") return null;
    const pct = Math.round(c * 100);
    const cls = c >= 0.85 ? "bg-emerald-50 text-emerald-700" : c >= 0.6 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
    return <span className={cn("text-[10px] px-1.5 py-0.5 rounded ml-1", cls)}>{pct}%</span>;
  };

  const updateLine = (idx: number, patch: Partial<EditableLine>) => {
    setEditedLines((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch, lineTotal: patch.quantity != null || patch.unitPrice != null
      ? (patch.quantity ?? l.quantity) * (patch.unitPrice ?? l.unitPrice)
      : l.lineTotal,
    } : l));
  };
  const addLine = () => setEditedLines((p) => [...p, {
    description: "", quantity: 0, unit: "unit", unitPrice: 0, lineTotal: 0,
    matchedInventoryItemId: null, matchedPoItemId: null, priceVariancePct: null,
  }]);
  const removeLine = (idx: number) => setEditedLines((p) => p.filter((_, i) => i !== idx));

  const onSaveCorrections = async () => {
    try {
      await correct.mutateAsync({
        id: invoice.id,
        supplierId: supplierId === "none" ? null : Number(supplierId),
        vendorName,
        invoiceNumber,
        invoiceDate: invoiceDate || null,
        dueDate: dueDate || null,
        totalAmount: Number(totalAmount),
        taxAmount: Number(taxAmount),
        lines: editedLines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          matchedInventoryItemId: l.matchedInventoryItemId,
          matchedPoItemId: l.matchedPoItemId,
        })),
      });
      toast({ title: "Corrections saved" });
      onChanged();
    } catch (e) { toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }); }
  };

  const onSetPo = async (next: string) => {
    setPoId(next);
    try {
      await matchPo.mutateAsync({ id: invoice.id, purchaseOrderId: next === "none" ? null : Number(next) });
      toast({ title: "Purchase order updated" });
      onChanged();
    } catch (e) { toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }); }
  };

  const onApprove = async () => {
    if (!expenseCategoryId) { toast({ title: "Pick an expense category first", variant: "destructive" }); return; }
    try {
      await approve.mutateAsync({ id: invoice.id, expenseCategoryId: Number(expenseCategoryId) });
      toast({ title: "Invoice approved", description: "Vendor bill booked and stock updated." });
      onChanged(); onClose();
    } catch (e) { toast({ title: "Approval failed", description: (e as Error).message, variant: "destructive" }); }
  };
  const onReject = async () => {
    const reason = window.prompt("Reason for rejection?");
    if (!reason) return;
    try { await reject.mutateAsync({ id: invoice.id, reason }); toast({ title: "Invoice rejected" }); onChanged(); onClose(); }
    catch (e) { toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }); }
  };
  const onDelete = async () => {
    if (!window.confirm("Delete this invoice draft?")) return;
    try { await del.mutateAsync(invoice.id); toast({ title: "Deleted" }); onChanged(); onClose(); }
    catch (e) { toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }); }
  };

  const inventoryOpts = items.data ?? [];
  const poOpts = pos.data ?? [];

  return (
    <Tabs defaultValue="review" className="w-full">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={STATUS_CLS[invoice.status]}>{STATUS_LABEL[invoice.status]}</Badge>
          {invoice.hasPriceVariance === "true" && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              <AlertTriangle className="w-3 h-3 mr-1" /> Price variance vs PO
            </Badge>
          )}
          <a href={fileHref} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
            <Link2 className="w-3 h-3" /> View original file
          </a>
        </div>
        <TabsList>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="raw">Raw OCR</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="review" className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border rounded-md bg-slate-50 overflow-hidden" style={{ minHeight: 420 }}>
            <div className="px-3 py-2 text-xs font-medium text-slate-600 border-b bg-white flex items-center justify-between">
              <span>Original invoice</span>
              <a href={fileHref} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open</a>
            </div>
            {(invoice.uploadMimeType ?? "").startsWith("image/") ? (
              <img src={fileHref} alt="Invoice" className="w-full h-auto block" data-testid="img-invoice-preview" />
            ) : (
              <iframe
                src={fileHref}
                title="Vendor invoice"
                className="w-full"
                style={{ height: 600, border: 0 }}
                data-testid="iframe-invoice-preview"
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 content-start">
          <div>
            <Label>Vendor name {confidence("vendor")}</Label>
            <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} disabled={readonly} data-testid="input-vendor-name" />
          </div>
          <div>
            <Label>Supplier (linked)</Label>
            <Select value={supplierId} onValueChange={setSupplierId} disabled={readonly}>
              <SelectTrigger data-testid="select-supplier"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Not linked —</SelectItem>
                {(suppliers.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Invoice # {confidence("invoiceNumber")}</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} disabled={readonly} data-testid="input-invoice-number" />
          </div>
          <div>
            <Label>Purchase order</Label>
            <Select value={poId} onValueChange={onSetPo} disabled={readonly}>
              <SelectTrigger data-testid="select-po-detail"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Not linked —</SelectItem>
                {poOpts.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    PO #{p.id} — {fmtMoney(p.totalAmount)} ({p.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Invoice date {confidence("date")}</Label>
            <Input type="date" value={invoiceDate ?? ""} onChange={(e) => setInvoiceDate(e.target.value)} disabled={readonly} />
          </div>
          <div>
            <Label>Due date</Label>
            <Input type="date" value={dueDate ?? ""} onChange={(e) => setDueDate(e.target.value)} disabled={readonly} />
          </div>
          <div>
            <Label>Total amount {confidence("total")}</Label>
            <Input type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} disabled={readonly} data-testid="input-total" />
          </div>
          <div>
            <Label>Tax amount</Label>
            <Input type="number" step="0.01" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} disabled={readonly} />
          </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Line items</Label>
            {!readonly && (
              <Button size="sm" variant="outline" onClick={addLine}>+ Add line</Button>
            )}
          </div>
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="text-left p-2">Description</th>
                  <th className="text-left p-2 w-28">Inventory item</th>
                  <th className="text-right p-2 w-20">Qty</th>
                  <th className="text-left p-2 w-16">Unit</th>
                  <th className="text-right p-2 w-24">Unit price</th>
                  <th className="text-right p-2 w-24">Line total</th>
                  <th className="text-right p-2 w-20">vs PO</th>
                  {!readonly && <th className="w-8"></th>}
                </tr>
              </thead>
              <tbody>
                {editedLines.map((l, idx) => {
                  const variance = l.priceVariancePct ? Number(l.priceVariancePct) : null;
                  return (
                    <tr key={idx} className="border-t">
                      <td className="p-1">
                        <Input value={l.description} onChange={(e) => updateLine(idx, { description: e.target.value })} disabled={readonly} className="h-8" />
                      </td>
                      <td className="p-1">
                        <Select
                          value={l.matchedInventoryItemId ? String(l.matchedInventoryItemId) : "none"}
                          onValueChange={(v) => updateLine(idx, { matchedInventoryItemId: v === "none" ? null : Number(v) })}
                          disabled={readonly}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— None —</SelectItem>
                            {inventoryOpts.map((it) => (
                              <SelectItem key={it.id} value={String(it.id)}>{it.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1">
                        <Input type="number" step="0.001" value={l.quantity} onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })} disabled={readonly} className="h-8 text-right" />
                      </td>
                      <td className="p-1">
                        <Input value={l.unit} onChange={(e) => updateLine(idx, { unit: e.target.value })} disabled={readonly} className="h-8" />
                      </td>
                      <td className="p-1">
                        <Input type="number" step="0.0001" value={l.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: Number(e.target.value) })} disabled={readonly} className="h-8 text-right" />
                      </td>
                      <td className="p-2 text-right tabular-nums">{fmtMoney(l.lineTotal, invoice.currency)}</td>
                      <td className="p-2 text-right text-xs">
                        {variance == null ? "—" : (
                          <span className={cn(
                            "px-1.5 py-0.5 rounded",
                            Math.abs(variance) > 5 ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700",
                          )}>
                            {variance > 0 ? "+" : ""}{variance.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      {!readonly && (
                        <td className="p-1 text-right">
                          <button onClick={() => removeLine(idx)} className="text-muted-foreground hover:text-red-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {editedLines.length === 0 && (
                  <tr><td colSpan={readonly ? 7 : 8} className="p-4 text-center text-xs text-muted-foreground">No line items extracted.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {!readonly && (
          <div className="border-t pt-3 flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-2">
              <div>
                <Label>Expense category (for vendor bill)</Label>
                <Select value={expenseCategoryId} onValueChange={setExpenseCategoryId}>
                  <SelectTrigger className="w-56" data-testid="select-expense-category">
                    <SelectValue placeholder="Pick a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {(cats.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={onSaveCorrections} disabled={correct.isPending} data-testid="button-save-corrections">
                Save corrections
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onDelete} className="text-red-600">
                <Trash2 className="w-4 h-4 mr-1" /> Delete
              </Button>
              <Button variant="outline" onClick={onReject} disabled={reject.isPending}>
                <XCircle className="w-4 h-4 mr-1" /> Reject
              </Button>
              <Button onClick={onApprove} disabled={approve.isPending || !expenseCategoryId} data-testid="button-approve">
                {approve.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                Approve &amp; book bill
              </Button>
            </div>
          </div>
        )}

        {readonly && invoice.rejectionReason && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            <span className="font-medium">Rejection reason:</span> {invoice.rejectionReason}
          </div>
        )}
      </TabsContent>

      <TabsContent value="raw">
        <pre className="text-xs bg-muted/40 p-3 rounded max-h-[60vh] overflow-auto">
{JSON.stringify(invoice.extractedData, null, 2)}
        </pre>
      </TabsContent>
    </Tabs>
  );
}
