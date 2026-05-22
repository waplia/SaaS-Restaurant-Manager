import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { Label } from "@/components/ui/label";
import { Plus, QrCode, RefreshCw, Wallet, Trash2, History, Users } from "lucide-react";
import {
  useStudents, useCreateStudent, useUpdateStudent, useDeactivateStudent,
  useRegenerateQr, useStudentHistory, useGuardians, useAddGuardian,
  useDeleteGuardian, useRecharge, rupees, type Student,
} from "@/lib/canteen";
import { toast } from "@/hooks/use-toast";

export default function CanteenStudentsPage() {
  const [q, setQ] = useState("");
  const { data: students = [] } = useStudents(q);
  const create = useCreateStudent();
  const update = useUpdateStudent();
  const deact = useDeactivateStudent();
  const regen = useRegenerateQr();
  const recharge = useRecharge();

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    name: "", studentCode: "", className: "", section: "", rollNumber: "",
    dailyCap: "", lowBalanceThreshold: "",
  });
  const [selected, setSelected] = useState<Student | null>(null);

  const submit = async () => {
    if (!form.name.trim() || !form.studentCode.trim()) {
      toast({ title: "Name and student code required" }); return;
    }
    try {
      await create.mutateAsync({
        name: form.name, studentCode: form.studentCode,
        className: form.className || null, section: form.section || null,
        rollNumber: form.rollNumber || null,
        dailyCap: form.dailyCap ? Math.round(Number(form.dailyCap) * 100) : null,
        lowBalanceThreshold: form.lowBalanceThreshold ? Math.round(Number(form.lowBalanceThreshold) * 100) : null,
      });
      setShowNew(false);
      setForm({ name: "", studentCode: "", className: "", section: "", rollNumber: "", dailyCap: "", lowBalanceThreshold: "" });
      toast({ title: "Student added" });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message });
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Canteen Students"
        subtitle="Manage student ID-card wallets and parent links"
        actions={
          <div className="flex gap-2">
            <Input className="w-56" placeholder="Search name/code/class" value={q} onChange={e => setQ(e.target.value)} />
            <Button onClick={() => setShowNew(true)} data-testid="button-new-student"><Plus className="w-4 h-4 mr-1" />New Student</Button>
          </div>
        }
      />

      {showNew && (
        <div className="bg-card border border-border rounded-xl p-4 m-6">
          <h3 className="font-semibold mb-3">Add Student</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Student Code *</Label><Input value={form.studentCode} onChange={e => setForm({ ...form, studentCode: e.target.value })} /></div>
            <div><Label>Class</Label><Input value={form.className} onChange={e => setForm({ ...form, className: e.target.value })} placeholder="e.g. Grade 8" /></div>
            <div><Label>Section</Label><Input value={form.section} onChange={e => setForm({ ...form, section: e.target.value })} /></div>
            <div><Label>Roll #</Label><Input value={form.rollNumber} onChange={e => setForm({ ...form, rollNumber: e.target.value })} /></div>
            <div><Label>Daily Cap (₹)</Label><Input type="number" value={form.dailyCap} onChange={e => setForm({ ...form, dailyCap: e.target.value })} placeholder="0 = no cap" /></div>
            <div><Label>Low Balance Alert (₹)</Label><Input type="number" value={form.lowBalanceThreshold} onChange={e => setForm({ ...form, lowBalanceThreshold: e.target.value })} /></div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={submit} disabled={create.isPending}>Save</Button>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="m-6 bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="p-3">Student</th><th className="p-3">Code</th><th className="p-3">Class</th>
              <th className="p-3">Balance</th><th className="p-3">Daily Cap</th><th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground"><Users className="w-8 h-8 mx-auto mb-2 opacity-40" />No students yet</td></tr>
            )}
            {students.map(s => (
              <tr key={s.id} className="border-t border-border hover:bg-muted/20">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3 font-mono text-xs">{s.studentCode}</td>
                <td className="p-3 text-muted-foreground">{[s.className, s.section, s.rollNumber].filter(Boolean).join(" / ") || "—"}</td>
                <td className="p-3 font-semibold">{rupees(s.balance)}</td>
                <td className="p-3">{rupees(s.dailyCap)}</td>
                <td className="p-3">{s.isFrozen ? <span className="text-red-600">Frozen</span> : s.isActive ? <span className="text-green-600">Active</span> : <span className="text-muted-foreground">Inactive</span>}</td>
                <td className="p-3 flex gap-1 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setSelected(s)} data-testid={`button-detail-${s.id}`}><History className="w-3 h-3" /></Button>
                  <Button size="sm" variant="outline" onClick={async () => {
                    const amt = prompt(`Recharge amount in ₹ for ${s.name}:`);
                    if (!amt) return;
                    try {
                      await recharge.mutateAsync({ studentId: s.id, amountPaise: Math.round(Number(amt) * 100), channel: "manual" });
                      toast({ title: "Recharged" });
                    } catch (err) { toast({ title: "Failed", description: (err as Error).message }); }
                  }}><Wallet className="w-3 h-3" /></Button>
                  <Button size="sm" variant="outline" onClick={async () => {
                    if (!confirm("Regenerate QR? Old card will stop working.")) return;
                    await regen.mutateAsync(s.id); toast({ title: "QR regenerated" });
                  }}><RefreshCw className="w-3 h-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    update.mutate({ id: s.id, isFrozen: !s.isFrozen });
                  }}>{s.isFrozen ? "Unfreeze" : "Freeze"}</Button>
                  <Button size="sm" variant="outline" onClick={async () => {
                    if (!confirm("Deactivate student?")) return;
                    await deact.mutateAsync(s.id);
                  }}><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && <StudentDetailDrawer student={selected} onClose={() => setSelected(null)} />}
    </Layout>
  );
}

function StudentDetailDrawer({ student, onClose }: { student: Student; onClose: () => void }) {
  const { data: hist } = useStudentHistory(student.id);
  const { data: guardians = [] } = useGuardians(student.id);
  const addG = useAddGuardian();
  const delG = useDeleteGuardian();
  const [g, setG] = useState({ name: "", relation: "", phone: "", email: "" });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div className="bg-background w-full max-w-2xl h-full overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold">{student.name}</h2>
            <p className="text-sm text-muted-foreground">{student.studentCode} · Balance {rupees(student.balance)}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>

        <div className="bg-muted/30 border border-border rounded-lg p-4 mb-4 flex items-center gap-3">
          <QrCode className="w-12 h-12" />
          <div className="font-mono text-xs break-all flex-1">{student.qrToken}</div>
        </div>

        <h3 className="font-semibold mt-4 mb-2">Guardians / Parents</h3>
        <div className="space-y-2 mb-3">
          {guardians.map(gu => (
            <div key={gu.id} className="flex items-center justify-between border border-border rounded-md p-2">
              <div className="text-sm">
                <div className="font-medium">{gu.name} {gu.relation && <span className="text-muted-foreground text-xs">({gu.relation})</span>}</div>
                <div className="text-xs text-muted-foreground">{gu.phone || gu.email || "no contact"}</div>
                <div className="text-xs font-mono mt-1 text-blue-600 break-all">/canteen/parent/{gu.parentToken}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => delG.mutate(gu.id)}><Trash2 className="w-3 h-3" /></Button>
            </div>
          ))}
          {guardians.length === 0 && <div className="text-sm text-muted-foreground">No guardians yet.</div>}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <Input placeholder="Name *" value={g.name} onChange={e => setG({ ...g, name: e.target.value })} />
          <Input placeholder="Relation" value={g.relation} onChange={e => setG({ ...g, relation: e.target.value })} />
          <PhoneInput placeholder="Phone" value={g.phone} onChange={v => setG({ ...g, phone: v })} />
          <Input placeholder="Email" value={g.email} onChange={e => setG({ ...g, email: e.target.value })} />
        </div>
        <Button size="sm" onClick={async () => {
          if (!g.name) return;
          await addG.mutateAsync({ studentId: student.id, ...g });
          setG({ name: "", relation: "", phone: "", email: "" });
        }}>Add Guardian</Button>

        <h3 className="font-semibold mt-6 mb-2">Wallet Activity</h3>
        <div className="border border-border rounded-md overflow-hidden text-xs">
          <table className="w-full">
            <thead className="bg-muted/40">
              <tr><th className="p-2 text-left">When</th><th className="p-2 text-left">Type</th><th className="p-2 text-right">Amount</th><th className="p-2 text-right">Balance</th></tr>
            </thead>
            <tbody>
              {hist?.txns.map(t => (
                <tr key={t.id} className="border-t border-border">
                  <td className="p-2">{new Date(t.createdAt).toLocaleString()}</td>
                  <td className="p-2">{t.type}</td>
                  <td className={`p-2 text-right ${t.direction === "credit" ? "text-green-600" : "text-red-600"}`}>{t.direction === "credit" ? "+" : "−"}{rupees(t.amount)}</td>
                  <td className="p-2 text-right font-mono">{rupees(t.closingBalance)}</td>
                </tr>
              ))}
              {(!hist?.txns || hist.txns.length === 0) && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No activity</td></tr>}
            </tbody>
          </table>
        </div>

        <h3 className="font-semibold mt-6 mb-2">Recent Orders</h3>
        <div className="space-y-1 text-xs">
          {hist?.orders.slice(0, 20).map(o => {
            const items = hist.items.filter(i => i.orderId === o.id);
            return (
              <div key={o.id} className="border border-border rounded-md p-2">
                <div className="flex justify-between"><span className="font-mono">{o.orderNumber}</span><span>{rupees(o.total)}</span></div>
                <div className="text-muted-foreground">{new Date(o.createdAt).toLocaleString()} · {o.paymentSource}</div>
                <div>{items.map(i => `${i.itemName} ×${i.quantity}`).join(", ")}</div>
              </div>
            );
          })}
          {(!hist?.orders || hist.orders.length === 0) && <div className="text-muted-foreground">No orders yet.</div>}
        </div>
      </div>
    </div>
  );
}
