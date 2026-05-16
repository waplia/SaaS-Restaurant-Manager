import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCorporateCompanies, useCreateCompany, type CorporateCompany } from "@/lib/corporate";

const TERMS = ["due_on_receipt", "net_15", "net_30", "net_45"];

export default function CorporateCompaniesPage() {
  const { data: companies, isLoading } = useCorporateCompanies();
  const create = useCreateCompany();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<CorporateCompany>>({ paymentTerms: "net_15", creditLimit: "0", approvalThreshold: "0" });

  const submit = async () => {
    try {
      await create.mutateAsync(form);
      toast({ title: "Company created" });
      setOpen(false);
      setForm({ paymentTerms: "net_15", creditLimit: "0", approvalThreshold: "0" });
    } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Corporate companies</h1>
          <p className="text-sm text-muted-foreground">Manage B2B customer accounts</p>
        </div>
        <Button onClick={() => setOpen(true)}>+ New company</Button>
      </div>

      {isLoading ? <div>Loading…</div> : (
        <Card><CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-left bg-muted/50">
              <tr>
                <th className="p-3">Name</th><th>GSTIN</th><th>Payment terms</th>
                <th>Approval ≥</th><th>Credit limit</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {companies?.map(c => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="p-3"><Link href={`/corporate/companies/${c.id}`}><a className="text-primary font-medium">{c.name}</a></Link></td>
                  <td>{c.gstin || "—"}</td>
                  <td>{c.paymentTerms.replace("_", " ")}</td>
                  <td>₹{Number(c.approvalThreshold).toFixed(0)}</td>
                  <td>₹{Number(c.creditLimit).toFixed(0)}</td>
                  <td><Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge></td>
                </tr>
              ))}
              {companies?.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No corporate companies yet.</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New corporate company</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={form.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>GSTIN</Label><Input value={form.gstin ?? ""} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} /></div>
              <div><Label>Billing email</Label><Input value={form.billingEmail ?? ""} onChange={e => setForm(f => ({ ...f, billingEmail: e.target.value }))} /></div>
            </div>
            <div><Label>Billing address</Label><Input value={form.billingAddress ?? ""} onChange={e => setForm(f => ({ ...f, billingAddress: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Payment terms</Label>
                <Select value={form.paymentTerms} onValueChange={v => setForm(f => ({ ...f, paymentTerms: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TERMS.map(t => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Credit limit (₹)</Label><Input type="number" value={form.creditLimit ?? ""} onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))} /></div>
              <div><Label>Approval ≥ (₹)</Label><Input type="number" value={form.approvalThreshold ?? ""} onChange={e => setForm(f => ({ ...f, approvalThreshold: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Primary contact name</Label><Input value={form.primaryContactName ?? ""} onChange={e => setForm(f => ({ ...f, primaryContactName: e.target.value }))} /></div>
              <div><Label>Primary contact phone</Label><Input value={form.primaryContactPhone ?? ""} onChange={e => setForm(f => ({ ...f, primaryContactPhone: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.name || create.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
