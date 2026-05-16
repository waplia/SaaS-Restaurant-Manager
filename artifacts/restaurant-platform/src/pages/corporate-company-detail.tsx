import { useState } from "react";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useCorporateCompany, useUpdateCompany,
  useDepartments, useCreateDepartment,
  useEmployees, useCreateEmployee, useUpdateEmployee, useBulkImportEmployees,
  useGenerateInvoice, useInvoices,
} from "@/lib/corporate";

export default function CorporateCompanyDetailPage() {
  const [, params] = useRoute("/corporate/companies/:id");
  const id = Number(params?.id);
  const { data: company, isLoading } = useCorporateCompany(id);
  const update = useUpdateCompany(id);
  const { data: departments } = useDepartments(id);
  const createDept = useCreateDepartment(id);
  const { data: employees } = useEmployees(id);
  const createEmp = useCreateEmployee(id);
  const updateEmp = useUpdateEmployee(id);
  const bulkImport = useBulkImportEmployees(id);
  const generateInvoice = useGenerateInvoice();
  const { data: invoices } = useInvoices({ companyId: id });
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [newDept, setNewDept] = useState({ name: "", costCenter: "", monthlyLimit: "" });
  const [empOpen, setEmpOpen] = useState(false);
  const [empForm, setEmpForm] = useState<Record<string, unknown>>({ role: "employee" });
  const [csvText, setCsvText] = useState("");

  if (isLoading || !company) return <div className="p-6">Loading…</div>;

  const beginEdit = () => { setForm({ ...company }); setEditing(true); };
  const saveEdit = async () => {
    try { await update.mutateAsync(form); toast({ title: "Saved" }); setEditing(false); }
    catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  const addDept = async () => {
    if (!newDept.name) return;
    await createDept.mutateAsync({ name: newDept.name, costCenter: newDept.costCenter || null, monthlyLimit: newDept.monthlyLimit || null });
    setNewDept({ name: "", costCenter: "", monthlyLimit: "" });
    toast({ title: "Department added" });
  };

  const addEmp = async () => {
    try {
      await createEmp.mutateAsync(empForm);
      setEmpOpen(false);
      setEmpForm({ role: "employee" });
      toast({ title: "Employee added" });
    } catch (e) { toast({ title: "Failed", description: String(e), variant: "destructive" }); }
  };

  const importCsv = async () => {
    const lines = csvText.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return;
    const header = lines[0].split(",").map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const cols = line.split(",").map(c => c.trim());
      const o: Record<string, string> = {};
      header.forEach((h, i) => { o[h] = cols[i] ?? ""; });
      return o;
    });
    try {
      const result = await bulkImport.mutateAsync(rows);
      toast({ title: `Imported ${result.created} employees` });
      setCsvText("");
    } catch (e) { toast({ title: "Import failed", description: String(e), variant: "destructive" }); }
  };

  const runInvoice = async () => {
    try {
      await generateInvoice.mutateAsync({ companyId: id });
      toast({ title: "Invoice generated" });
    } catch (e) { toast({ title: "No billable orders or failed", description: String(e), variant: "destructive" }); }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/corporate/companies"><a className="text-sm text-muted-foreground">← All companies</a></Link>
          <h1 className="text-2xl font-semibold">{company.name}</h1>
          <div className="flex gap-2 mt-1 text-sm text-muted-foreground">
            <Badge variant={company.status === "active" ? "default" : "secondary"}>{company.status}</Badge>
            <span>Terms: {company.paymentTerms.replace("_", " ")}</span>
            <span>Approval ≥ ₹{Number(company.approvalThreshold).toFixed(0)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={beginEdit}>Edit</Button>
          <Button onClick={runInvoice}>Generate invoice (last month)</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Outstanding</div><div className="text-2xl font-semibold">₹{Number(company.outstandingBalance).toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">This month spend</div><div className="text-2xl font-semibold">₹{Number(company.monthSpend).toFixed(2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Orders this month</div><div className="text-2xl font-semibold">{company.monthOrderCount}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="employees">
        <TabsList>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="contact">Contact & terms</TabsTrigger>
        </TabsList>

        <TabsContent value="employees">
          <Card><CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Employees</CardTitle>
            <Button size="sm" onClick={() => setEmpOpen(true)}>+ Add employee</Button>
          </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr><th className="py-2">Name</th><th>Email</th><th>Phone</th><th>Department</th><th>Role</th><th>Per-meal cap</th><th>Monthly cap</th><th>Status</th></tr></thead>
                <tbody>
                  {employees?.map(e => (
                    <tr key={e.id} className="border-t">
                      <td className="py-2">{e.name}</td><td>{e.email || "—"}</td><td>{e.phone || "—"}</td>
                      <td>{e.departmentName || "—"}</td><td>{e.role}</td>
                      <td>{e.perMealLimit ? `₹${e.perMealLimit}` : "—"}</td>
                      <td>{e.monthlyLimit ? `₹${e.monthlyLimit}` : "—"}</td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => updateEmp.mutate({ id: e.id, isActive: !e.isActive })}>
                          {e.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {employees?.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">No employees yet.</td></tr>}
                </tbody>
              </table>

              <div className="mt-6">
                <h4 className="font-medium mb-2">Bulk import (CSV)</h4>
                <p className="text-xs text-muted-foreground mb-2">Header row required: <code>name,email,phone,employeeCode,perMealLimit,monthlyLimit</code></p>
                <textarea className="w-full border rounded p-2 text-sm font-mono h-32" placeholder="name,email,phone,employeeCode,perMealLimit,monthlyLimit&#10;Aisha,a@x.com,9999900001,E001,300,5000" value={csvText} onChange={e => setCsvText(e.target.value)} />
                <Button size="sm" className="mt-2" onClick={importCsv} disabled={bulkImport.isPending}>Import</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments">
          <Card><CardHeader><CardTitle>Departments / Cost centres</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-2 mb-4">
                <Input placeholder="Name" value={newDept.name} onChange={e => setNewDept(d => ({ ...d, name: e.target.value }))} />
                <Input placeholder="Cost centre" value={newDept.costCenter} onChange={e => setNewDept(d => ({ ...d, costCenter: e.target.value }))} />
                <Input placeholder="Monthly limit ₹" value={newDept.monthlyLimit} onChange={e => setNewDept(d => ({ ...d, monthlyLimit: e.target.value }))} />
                <Button onClick={addDept}>Add</Button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr><th>Name</th><th>Cost centre</th><th>Monthly limit</th></tr></thead>
                <tbody>
                  {departments?.map(d => (
                    <tr key={d.id} className="border-t"><td className="py-2">{d.name}</td><td>{d.costCenter || "—"}</td><td>{d.monthlyLimit ? `₹${d.monthlyLimit}` : "—"}</td></tr>
                  ))}
                  {departments?.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">None yet.</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card><CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr><th>Number</th><th>Period</th><th>Total</th><th>Paid</th><th>Status</th><th>Due</th></tr></thead>
                <tbody>
                  {invoices?.map(inv => (
                    <tr key={inv.id} className="border-t">
                      <td className="py-2"><Link href={`/corporate/invoices/${inv.id}`}><a className="text-primary">{inv.invoiceNumber}</a></Link></td>
                      <td>{inv.periodStart} → {inv.periodEnd}</td>
                      <td>₹{Number(inv.totalAmount).toFixed(2)}</td>
                      <td>₹{Number(inv.amountPaid).toFixed(2)}</td>
                      <td><Badge>{inv.status}</Badge></td>
                      <td>{inv.dueDate}</td>
                    </tr>
                  ))}
                  {invoices?.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No invoices yet. Click "Generate invoice".</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contact">
          <Card><CardContent className="p-4 text-sm space-y-2">
            <div><span className="text-muted-foreground">GSTIN:</span> {company.gstin || "—"}</div>
            <div><span className="text-muted-foreground">Billing email:</span> {company.billingEmail || "—"}</div>
            <div><span className="text-muted-foreground">Billing address:</span> {company.billingAddress || "—"}</div>
            <div><span className="text-muted-foreground">Primary contact:</span> {company.primaryContactName || "—"} ({company.primaryContactPhone || "—"})</div>
            <div><span className="text-muted-foreground">Credit limit:</span> ₹{Number(company.creditLimit).toFixed(2)}</div>
            <div><span className="text-muted-foreground">Approval threshold:</span> ₹{Number(company.approvalThreshold).toFixed(2)}</div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit company</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={String(form.name ?? "")} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Terms</Label>
                <Select value={String(form.paymentTerms ?? "")} onValueChange={v => setForm(f => ({ ...f, paymentTerms: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["due_on_receipt", "net_15", "net_30", "net_45"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Credit limit</Label><Input type="number" value={String(form.creditLimit ?? "")} onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))} /></div>
              <div><Label>Approval ≥</Label><Input type="number" value={String(form.approvalThreshold ?? "")} onChange={e => setForm(f => ({ ...f, approvalThreshold: e.target.value }))} /></div>
            </div>
            <div><Label>GSTIN</Label><Input value={String(form.gstin ?? "")} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} /></div>
            <div><Label>Billing email</Label><Input value={String(form.billingEmail ?? "")} onChange={e => setForm(f => ({ ...f, billingEmail: e.target.value }))} /></div>
            <div><Label>Status</Label>
              <Select value={String(form.status ?? "active")} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["active", "suspended", "inactive"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button onClick={saveEdit} disabled={update.isPending}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={empOpen} onOpenChange={setEmpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add employee</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={String(empForm.name ?? "")} onChange={e => setEmpForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Email</Label><Input value={String(empForm.email ?? "")} onChange={e => setEmpForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><Label>Phone</Label><Input value={String(empForm.phone ?? "")} onChange={e => setEmpForm(f => ({ ...f, phone: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Department</Label>
                <Select value={empForm.departmentId ? String(empForm.departmentId) : ""} onValueChange={v => setEmpForm(f => ({ ...f, departmentId: Number(v) }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>{departments?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Role</Label>
                <Select value={String(empForm.role ?? "employee")} onValueChange={v => setEmpForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["employee", "approver", "admin"].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Employee code</Label><Input value={String(empForm.employeeCode ?? "")} onChange={e => setEmpForm(f => ({ ...f, employeeCode: e.target.value }))} /></div>
              <div><Label>Per-meal cap ₹</Label><Input type="number" value={String(empForm.perMealLimit ?? "")} onChange={e => setEmpForm(f => ({ ...f, perMealLimit: e.target.value }))} /></div>
              <div><Label>Monthly cap ₹</Label><Input type="number" value={String(empForm.monthlyLimit ?? "")} onChange={e => setEmpForm(f => ({ ...f, monthlyLimit: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setEmpOpen(false)}>Cancel</Button><Button onClick={addEmp} disabled={!empForm.name || createEmp.isPending}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
