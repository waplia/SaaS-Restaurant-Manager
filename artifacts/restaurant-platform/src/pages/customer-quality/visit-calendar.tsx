import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, Crown, Cake, Heart, BookOpen, UserMinus, Send } from "lucide-react";
import { useVisitCalendar, useSendWinback } from "@/lib/hooks-customer-quality";
import { useToast } from "@/hooks/use-toast";

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

export default function VisitCalendarPage() {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [absentDays, setAbsentDays] = useState(30);
  const from = useMemo(() => ymd(month), [month]);
  const to = useMemo(() => { const d = new Date(month); d.setMonth(d.getMonth() + 1); return ymd(d); }, [month]);
  const { data, isLoading } = useVisitCalendar(from, to, absentDays);
  const winback = useSendWinback();
  const { toast } = useToast();

  const visits = data?.visits ?? [];
  const reservations = data?.reservations ?? [];
  const customers = data?.customers ?? [];
  const dropoff = data?.dropoff ?? [];

  const byDay = useMemo(() => {
    const map = new Map<string, { visits: any[]; reservations: any[]; birthdays: any[]; anniversaries: any[] }>();
    for (const v of visits) {
      const k = String(v.date);
      if (!map.has(k)) map.set(k, { visits: [], reservations: [], birthdays: [], anniversaries: [] });
      map.get(k)!.visits.push(v);
    }
    for (const r of reservations) {
      const k = ymd(new Date(r.reservationDate));
      if (!map.has(k)) map.set(k, { visits: [], reservations: [], birthdays: [], anniversaries: [] });
      map.get(k)!.reservations.push(r);
    }
    for (const c of customers) {
      if (c.dateOfBirth) {
        const dob = String(c.dateOfBirth).slice(5);
        for (let d = new Date(month); d.getMonth() === month.getMonth(); d.setDate(d.getDate() + 1)) {
          if (ymd(d).slice(5) === dob) {
            const k = ymd(d);
            if (!map.has(k)) map.set(k, { visits: [], reservations: [], birthdays: [], anniversaries: [] });
            map.get(k)!.birthdays.push(c);
          }
        }
      }
      if (c.anniversaryDate) {
        const a = String(c.anniversaryDate).slice(5);
        for (let d = new Date(month); d.getMonth() === month.getMonth(); d.setDate(d.getDate() + 1)) {
          if (ymd(d).slice(5) === a) {
            const k = ymd(d);
            if (!map.has(k)) map.set(k, { visits: [], reservations: [], birthdays: [], anniversaries: [] });
            map.get(k)!.anniversaries.push(c);
          }
        }
      }
    }
    return map;
  }, [visits, reservations, customers, month]);

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(month.getFullYear(), month.getMonth(), i));

  return (
    <Layout>
      <PageHeader title="Guest Visit Calendar" description="Visits, birthdays, anniversaries & reservations" icon={CalendarDays}
        actions={
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 border rounded text-sm" onClick={() => { const d = new Date(month); d.setMonth(d.getMonth() - 1); setMonth(d); }}>‹</button>
            <span className="text-sm font-medium">{month.toLocaleString(undefined, { month: "long", year: "numeric" })}</span>
            <button className="px-2 py-1 border rounded text-sm" onClick={() => { const d = new Date(month); d.setMonth(d.getMonth() + 1); setMonth(d); }}>›</button>
          </div>
        }
      />
      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2"><UserMinus className="h-4 w-4" /> Drop-off list — regulars absent ≥{absentDays} days</CardTitle>
          <select
            className="text-xs border rounded px-2 py-1 bg-background"
            value={absentDays}
            onChange={(e) => setAbsentDays(Number(e.target.value))}
            data-testid="select-absent-days"
          >
            {[14, 21, 30, 45, 60, 90].map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
        </CardHeader>
        <CardContent className="p-2">
          {dropoff.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3 text-center">No regulars have dropped off in this window.</p>
          ) : (
            <div className="divide-y">
              {dropoff.map((d: any) => (
                <div key={d.customer_id} className="flex items-center justify-between gap-2 py-2 px-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {d.is_vip ? <Crown className="h-3 w-3 text-amber-500 shrink-0" /> : null}
                      <span className="truncate">{d.name ?? d.phone ?? `Guest #${d.customer_id}`}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.visits_180d} visits in 180d · last seen {new Date(d.last_visit_at).toLocaleDateString()}
                    </div>
                  </div>
                  <Button
                    size="sm" variant="outline"
                    disabled={winback.isPending}
                    data-testid={`button-winback-${d.customer_id}`}
                    onClick={() => {
                      winback.mutate(
                        { customerId: Number(d.customer_id), channel: "whatsapp" },
                        {
                          onSuccess: () => toast({ title: "Winback queued", description: `Recovery message queued for ${d.name ?? d.phone}` }),
                          onError: (e: any) => toast({ title: "Failed", description: e?.message ?? "Could not send winback", variant: "destructive" }),
                        },
                      );
                    }}
                  >
                    <Send className="h-3 w-3 mr-1" /> Winback
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2">
          {isLoading && <p className="text-sm text-muted-foreground p-2">Loading…</p>}
          <div className="grid grid-cols-7 gap-1 text-xs">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <div key={d} className="text-center font-medium text-muted-foreground py-1">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const k = ymd(d);
              const x = byDay.get(k);
              return (
                <div key={i} className="border rounded p-1 min-h-[80px] text-left">
                  <div className="text-[11px] text-muted-foreground">{d.getDate()}</div>
                  {x?.visits?.length ? <div className="text-[10px] mt-0.5 flex items-center gap-1"><Badge variant="secondary" className="text-[10px] h-4 px-1">{x.visits.length} visits</Badge></div> : null}
                  {x?.reservations?.length ? <div className="text-[10px] mt-0.5 flex items-center gap-1"><BookOpen className="h-3 w-3" />{x.reservations.length}</div> : null}
                  {x?.birthdays?.length ? <div className="text-[10px] mt-0.5 flex items-center gap-1 text-pink-600"><Cake className="h-3 w-3" />{x.birthdays.length}</div> : null}
                  {x?.anniversaries?.length ? <div className="text-[10px] mt-0.5 flex items-center gap-1 text-rose-600"><Heart className="h-3 w-3" />{x.anniversaries.length}</div> : null}
                  {x?.visits?.some((v: any) => v.isVip) ? <div className="text-[10px] mt-0.5 flex items-center gap-1 text-amber-600"><Crown className="h-3 w-3" />VIP</div> : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}
