/**
 * Parent dashboard. Two modes:
 *   1. Logged-in parent (role=parent) — sees their student via authenticated
 *      endpoints. (Future: parent self-service. For now, this page is the
 *      magic-token public view.)
 *   2. Public link — /canteen/parent/:token gives the guardian a no-login
 *      view of balance, recent orders, and a recharge action.
 */
import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { rupees } from "@/lib/canteen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wallet, ShoppingBag, History } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface ParentSnapshot {
  student: {
    id: number; name: string; studentCode: string; className: string | null;
    balance: number; lifetimeIn: number; lifetimeOut: number;
    dailyCap: number | null; isFrozen: boolean;
  };
  guardian: { id: number; name: string; relation: string | null };
}

interface History {
  txns: Array<{
    id: number; direction: string; amount: number; type: string;
    closingBalance: number; createdAt: string; notes: string | null;
  }>;
  orders: Array<{
    id: number; orderNumber: string; total: number; createdAt: string;
    paymentSource: string;
  }>;
}

export default function CanteenParentPage() {
  const [, params] = useRoute<{ token: string }>("/canteen/parent/:token");
  const token = params?.token;
  const [snap, setSnap] = useState<ParentSnapshot | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amt, setAmt] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!token) return;
    try {
      const [s, h] = await Promise.all([
        fetch(`/api/canteen/parent/${token}`).then(r => r.ok ? r.json() : Promise.reject(new Error("Invalid link"))),
        fetch(`/api/canteen/parent/${token}/history`).then(r => r.ok ? r.json() : { txns: [], orders: [] }),
      ]);
      setSnap(s); setHist(h); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  };

  useEffect(() => { refresh(); }, [token]);

  const recharge = async () => {
    const paise = Math.round(Number(amt) * 100);
    if (!paise || paise <= 0) { toast({ title: "Enter an amount" }); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/canteen/parent/${token}/recharge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountPaise: paise, channel: "manual" }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Recharge failed");
      setAmt("");
      toast({ title: "Recharged" });
      refresh();
    } catch (e) { toast({ title: "Failed", description: (e as Error).message }); }
    finally { setLoading(false); }
  };

  if (err) return <div className="min-h-screen flex items-center justify-center p-6"><div className="text-center"><div className="text-2xl mb-2">😕</div><div className="font-semibold">{err}</div><div className="text-sm text-muted-foreground mt-1">Please check your link or contact the canteen administrator.</div></div></div>;
  if (!snap) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-gradient-to-r from-primary/90 to-primary text-primary-foreground rounded-2xl p-6 shadow">
          <div className="text-sm opacity-90">Hello {snap.guardian.name}</div>
          <div className="text-3xl font-bold mt-1">{snap.student.name}</div>
          <div className="text-xs opacity-90">{snap.student.studentCode}{snap.student.className && ` · ${snap.student.className}`}</div>
          <div className="mt-4 text-4xl font-bold">{rupees(snap.student.balance)}</div>
          <div className="text-xs opacity-90">canteen wallet balance</div>
          {snap.student.isFrozen && <div className="mt-2 text-xs bg-red-500/20 inline-block px-2 py-1 rounded">Wallet frozen — contact canteen</div>}
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="font-semibold mb-2 flex items-center gap-2"><Wallet className="w-4 h-4" />Recharge</h2>
          <div className="flex gap-2">
            <Input type="number" placeholder="₹ Amount" value={amt} onChange={e => setAmt(e.target.value)} />
            <Button onClick={recharge} disabled={loading} data-testid="button-recharge">Recharge</Button>
          </div>
          <div className="text-xs text-muted-foreground mt-1">Funds are added immediately. Payment is settled via your school's gateway.</div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="font-semibold mb-2 flex items-center gap-2"><ShoppingBag className="w-4 h-4" />Recent Orders</h2>
          {(hist?.orders ?? []).length === 0 && <div className="text-sm text-muted-foreground">No orders yet.</div>}
          {hist?.orders.slice(0, 10).map(o => (
            <div key={o.id} className="flex justify-between text-sm border-b border-border last:border-0 py-2">
              <div><div className="font-mono text-xs">{o.orderNumber}</div><div className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString()}</div></div>
              <div className="text-right"><div className="font-semibold">{rupees(o.total)}</div><div className="text-xs text-muted-foreground">{o.paymentSource}</div></div>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="font-semibold mb-2 flex items-center gap-2"><History className="w-4 h-4" />Wallet History</h2>
          {(hist?.txns ?? []).slice(0, 20).map(t => (
            <div key={t.id} className="flex justify-between text-sm border-b border-border last:border-0 py-2">
              <div><div>{t.type}</div><div className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</div></div>
              <div className={`text-right font-semibold ${t.direction === "credit" ? "text-green-600" : "text-red-600"}`}>{t.direction === "credit" ? "+" : "−"}{rupees(t.amount)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
