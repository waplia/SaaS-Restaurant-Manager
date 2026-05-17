/**
 * Reusable, realistic-looking product mockup components.
 *
 * All mockups are pure HTML/CSS/React with brand tokens — no images, no
 * heavy libraries. Each is responsive and safe to lazy-mount. The intent
 * is to look like a real screenshot (tables, charts, badges, status pills,
 * order cards, live metrics) rather than generic placeholder boxes.
 */
import type { ReactNode } from "react";
import {
  IndianRupee, ChefHat, Clock, AlertTriangle, TrendingUp, Users,
  Star, Sparkles, CheckCircle2, Package, Receipt,
  Bell, ShieldCheck, BrainCircuit, BarChart3, Search,
  ArrowUpRight, Filter,
} from "lucide-react";

/* ----------------------------- shared chrome ----------------------------- */

function BrowserFrame({ title, children, dark = false }: { title?: string; children: ReactNode; dark?: boolean }) {
  return (
    <div
      className={`rounded-2xl overflow-hidden shadow-2xl border ${dark ? "border-white/10 bg-[#0F172A] text-white" : "border-border bg-card text-foreground"}`}
    >
      <div className={`h-9 flex items-center px-3 gap-2 border-b ${dark ? "border-white/10 bg-white/5" : "border-border/60 bg-background/60"}`}>
        <div className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        <div className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <div className="h-2.5 w-2.5 rounded-full bg-green-400/80" />
        <div className={`mx-auto text-[10px] font-medium ${dark ? "text-white/60" : "text-muted-foreground"}`}>{title ?? "app.khanalagao.com"}</div>
      </div>
      {children}
    </div>
  );
}

function PhoneFrame({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <div className={`mx-auto rounded-[2rem] overflow-hidden shadow-2xl border-[6px] ${dark ? "border-[#0F172A]" : "border-[#111827]"} aspect-[9/19] w-full max-w-[260px] bg-background`}>
      <div className="h-5 bg-black/90 flex items-center justify-center">
        <div className="h-1 w-12 rounded-full bg-white/30" />
      </div>
      <div className="h-[calc(100%-1.25rem)] overflow-hidden">{children}</div>
    </div>
  );
}

function Pill({ children, tone = "primary" }: { children: ReactNode; tone?: "primary" | "green" | "amber" | "red" | "blue" | "purple" | "slate" }) {
  const tones: Record<string, string> = {
    primary: "bg-primary/15 text-primary border-primary/30",
    green: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    red: "bg-red-500/15 text-red-600 border-red-500/30",
    blue: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    purple: "bg-purple-500/15 text-purple-600 border-purple-500/30",
    slate: "bg-slate-500/15 text-slate-600 border-slate-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function MetricTile({
  label, value, delta, tone = "primary", icon: Icon,
}: { label: string; value: string; delta?: string; tone?: "primary" | "green" | "amber" | "purple"; icon?: React.ComponentType<{ className?: string }> }) {
  const tones: Record<string, string> = {
    primary: "from-primary/10 to-primary/5 text-primary",
    green: "from-emerald-500/10 to-emerald-500/5 text-emerald-600",
    amber: "from-amber-500/10 to-amber-500/5 text-amber-600",
    purple: "from-purple-500/10 to-purple-500/5 text-purple-600",
  };
  return (
    <div className={`rounded-xl border border-border bg-gradient-to-br ${tones[tone]} p-2.5`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] uppercase font-bold tracking-wider text-foreground/60">{label}</span>
        {Icon && <Icon className="h-3 w-3" />}
      </div>
      <div className="text-sm md:text-base font-bold text-foreground tabular-nums">{value}</div>
      {delta && (
        <div className="flex items-center gap-0.5 text-[9px] text-emerald-600 font-semibold mt-0.5">
          <ArrowUpRight className="h-2.5 w-2.5" /> {delta}
        </div>
      )}
    </div>
  );
}

function Sparkline({ bars, accent = "primary" }: { bars: number[]; accent?: "primary" | "purple" | "emerald" }) {
  const colors = {
    primary: "from-primary/40 to-primary",
    purple: "from-purple-400/40 to-purple-500",
    emerald: "from-emerald-400/40 to-emerald-500",
  };
  return (
    <div className="h-16 flex items-end gap-0.5">
      {bars.map((h, i) => (
        <div key={i} style={{ height: `${h}%` }} className={`flex-1 rounded-t bg-gradient-to-t ${colors[accent]}`} />
      ))}
    </div>
  );
}

/* -------------------------- 1. DashboardMockup --------------------------- */

export function DashboardMockup() {
  return (
    <BrowserFrame title="Dashboard · Tandoor House">
      <div className="p-3 sm:p-4">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] text-muted-foreground">Good evening,</div>
            <div className="text-sm font-bold font-serif">Live performance · Today</div>
          </div>
          <Pill tone="green"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live</Pill>
        </div>

        {/* Metric tiles */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <MetricTile label="Sales" value="₹1,42,800" delta="+18%" icon={IndianRupee} />
          <MetricTile label="Orders" value="184" delta="+22" tone="green" icon={Receipt} />
          <MetricTile label="Avg ticket" value="₹776" delta="+₹40" tone="purple" icon={TrendingUp} />
          <MetricTile label="Guests" value="412" delta="+9%" tone="amber" icon={Users} />
        </div>

        {/* Chart + side list */}
        <div className="grid grid-cols-5 gap-2">
          <div className="col-span-3 rounded-xl border border-border bg-background p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-semibold">Sales by hour</div>
              <Pill tone="primary">Today vs Last Thu</Pill>
            </div>
            <Sparkline bars={[20, 35, 28, 45, 50, 38, 65, 72, 58, 82, 90, 76]} />
            <div className="flex justify-between mt-1 text-[8px] text-muted-foreground">
              <span>11am</span><span>1pm</span><span>3pm</span><span>5pm</span><span>7pm</span><span>9pm</span><span>11pm</span>
            </div>
          </div>
          <div className="col-span-2 rounded-xl border border-border bg-background p-3 space-y-1.5">
            <div className="text-[10px] font-semibold mb-1">Top items today</div>
            {[
              { name: "Paneer Tikka", qty: 72, rev: "₹18,400" },
              { name: "Butter Naan", qty: 218, rev: "₹6,540" },
              { name: "Dal Makhani", qty: 64, rev: "₹14,720" },
              { name: "Mojito", qty: 96, rev: "₹9,600" },
            ].map((it) => (
              <div key={it.name} className="flex items-center justify-between text-[10px]">
                <span className="font-medium truncate">{it.name}</span>
                <span className="text-muted-foreground tabular-nums">{it.qty} · {it.rev}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ----------------------------- 2. POSMockup ------------------------------ */

export function POSMockup() {
  const items = [
    { name: "Paneer Tikka", price: 320, cat: "Tandoor" },
    { name: "Veg Biryani", price: 280, cat: "Rice" },
    { name: "Butter Naan", price: 60, cat: "Breads" },
    { name: "Dal Makhani", price: 240, cat: "Mains" },
    { name: "Mojito", price: 180, cat: "Bar" },
    { name: "Gulab Jamun", price: 120, cat: "Desserts" },
  ];
  const check = [
    { name: "Paneer Tikka", qty: 1, amt: 320 },
    { name: "Butter Naan", qty: 4, amt: 240 },
    { name: "Dal Makhani", qty: 1, amt: 240 },
    { name: "Mojito", qty: 2, amt: 360 },
  ];
  const subtotal = check.reduce((s, x) => s + x.amt, 0);
  return (
    <BrowserFrame title="POS · Table 7">
      <div className="grid grid-cols-5 gap-2 p-2.5">
        <div className="col-span-3">
          <div className="flex items-center gap-1 mb-2 overflow-x-auto no-scrollbar">
            {["All", "Starters", "Tandoor", "Rice", "Breads", "Bar", "Desserts"].map((c, i) => (
              <span key={c} className={`shrink-0 text-[10px] px-2 py-1 rounded-full font-semibold ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{c}</span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {items.map((it) => (
              <div key={it.name} className="rounded-lg border border-border bg-gradient-to-br from-primary/5 to-transparent p-1.5 hover:border-primary/40 transition-colors">
                <div className="h-8 rounded bg-primary/15 mb-1.5 flex items-center justify-center text-[10px] font-bold text-primary">{it.cat[0]}</div>
                <div className="text-[10px] font-semibold leading-tight truncate">{it.name}</div>
                <div className="text-[9px] text-muted-foreground">₹{it.price}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="col-span-2 rounded-lg bg-background border border-border p-2.5 flex flex-col">
          <div className="flex items-center justify-between mb-1.5">
            <div>
              <div className="text-[9px] text-muted-foreground">CHECK #142</div>
              <div className="text-[11px] font-bold">Table 7 · 4 guests</div>
            </div>
            <Pill tone="amber">Dine-in</Pill>
          </div>
          <div className="space-y-1 flex-1 overflow-hidden">
            {check.map((row) => (
              <div key={row.name} className="flex items-center justify-between text-[10px] border-b border-border/40 pb-0.5">
                <span className="font-medium truncate flex-1">{row.name}</span>
                <span className="text-muted-foreground mx-1.5">x{row.qty}</span>
                <span className="font-semibold tabular-nums">₹{row.amt}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-1.5 mt-1.5 space-y-0.5">
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>Subtotal</span><span>₹{subtotal}</span></div>
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>GST 5%</span><span>₹{Math.round(subtotal * 0.05)}</span></div>
            <div className="flex justify-between text-[12px] font-bold"><span>Total</span><span className="text-primary">₹{subtotal + Math.round(subtotal * 0.05)}</span></div>
          </div>
          <button className="mt-2 h-7 rounded-md bg-primary text-primary-foreground text-[10px] font-bold">Print KOT + Bill</button>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ----------------------- 3. QRMenuMobileMockup --------------------------- */

export function QRMenuMobileMockup() {
  return (
    <PhoneFrame>
      <div className="bg-gradient-to-b from-primary/15 to-background h-full overflow-hidden">
        <div className="px-3 pt-3 pb-2">
          <div className="text-[9px] text-muted-foreground">Tandoor House · Table 7</div>
          <div className="text-[14px] font-bold font-serif">Tonight's Menu</div>
          <div className="mt-2 h-7 rounded-full bg-background border border-border flex items-center px-2 gap-1.5">
            <Search className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Search dishes…</span>
          </div>
        </div>
        <div className="px-3 flex gap-1 overflow-x-auto no-scrollbar pb-2">
          {["Veg", "Tandoor", "Mains", "Breads", "Bar"].map((c, i) => (
            <span key={c} className={`shrink-0 text-[9px] px-2 py-1 rounded-full font-semibold ${i === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{c}</span>
          ))}
        </div>
        <div className="px-3 space-y-1.5">
          {[
            { name: "Paneer Tikka", price: 320, badge: "Bestseller", tone: "primary" as const },
            { name: "Tandoori Mushroom", price: 280, badge: "Chef's pick", tone: "purple" as const },
            { name: "Hara Bhara Kabab", price: 240 },
          ].map((d) => (
            <div key={d.name} className="rounded-lg border border-border bg-background p-2 flex gap-2">
              <div className="h-10 w-10 rounded-md bg-gradient-to-br from-amber-400 to-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-semibold truncate">{d.name}</div>
                  <span className="text-[9px] text-emerald-600">●</span>
                </div>
                <div className="text-[9px] text-muted-foreground">Cottage cheese · clay-roasted</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] font-bold">₹{d.price}</span>
                  {d.badge && <Pill tone={d.tone!}>{d.badge}</Pill>}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="absolute bottom-0 left-0 right-0 mx-3 mb-3">
          <div className="rounded-full bg-primary text-primary-foreground h-9 flex items-center justify-between px-3 shadow-lg">
            <span className="text-[10px] font-bold">3 items · ₹920</span>
            <span className="text-[10px] font-bold">View cart →</span>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/* ------------------------- 4. KitchenKDSMockup --------------------------- */

export function KitchenKDSMockup() {
  const tickets = [
    { num: "T7", time: "02:14", tone: "green" as const, items: ["1× Paneer Tikka", "4× Butter Naan", "1× Dal Makhani"] },
    { num: "T3", time: "05:48", tone: "amber" as const, items: ["2× Veg Biryani", "1× Raita"] },
    { num: "T12", time: "08:02", tone: "red" as const, items: ["3× Tandoori Roti", "2× Mojito", "1× Gulab Jamun"] },
    { num: "DLV-902", time: "01:32", tone: "blue" as const, items: ["1× Family Combo"] },
  ];
  const dotMap = { green: "bg-emerald-500", amber: "bg-amber-400", red: "bg-red-500", blue: "bg-blue-400" };
  return (
    <BrowserFrame dark title="Kitchen Display · Tandoor House">
      <div className="p-3 grid grid-cols-4 gap-2">
        {tickets.map((t) => (
          <div key={t.num} className="rounded-lg bg-white text-foreground p-2 flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-bold">{t.num}</div>
              <span className={`h-2 w-2 rounded-full ${dotMap[t.tone]} ${t.tone === "red" ? "animate-pulse" : ""}`} />
            </div>
            <div className="space-y-0.5 text-[9px] leading-snug">
              {t.items.map((i) => (
                <div key={i} className="text-foreground/80">• {i}</div>
              ))}
            </div>
            <div className="flex-1" />
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border">
              <span className="text-[9px] text-muted-foreground tabular-nums">{t.time}</span>
              <button className="text-[9px] font-bold text-primary">Bump →</button>
            </div>
          </div>
        ))}
      </div>
      <div className="px-3 pb-3 grid grid-cols-3 gap-2 text-[9px]">
        <div className="rounded-md bg-white/5 border border-white/10 p-1.5 text-center"><span className="text-emerald-400 font-bold">12</span> Cooking</div>
        <div className="rounded-md bg-white/5 border border-white/10 p-1.5 text-center"><span className="text-amber-400 font-bold">5</span> Ready to pickup</div>
        <div className="rounded-md bg-white/5 border border-white/10 p-1.5 text-center"><span className="text-red-400 font-bold">2</span> Delayed</div>
      </div>
    </BrowserFrame>
  );
}

/* -------------------------- 5. InventoryMockup --------------------------- */

export function InventoryMockup() {
  const rows = [
    { name: "Paneer", unit: "kg", qty: 8.2, par: 12, tone: "amber" as const, used: "−1.2 today" },
    { name: "Tomato", unit: "kg", qty: 24, par: 20, tone: "green" as const, used: "−3.4 today" },
    { name: "Basmati Rice", unit: "kg", qty: 6.0, par: 25, tone: "red" as const, used: "−0.8 today" },
    { name: "Butter", unit: "kg", qty: 4.6, par: 6, tone: "amber" as const, used: "−0.6 today" },
    { name: "Cooking Oil", unit: "L", qty: 18, par: 15, tone: "green" as const, used: "−1.0 today" },
  ];
  return (
    <BrowserFrame title="Inventory · Live stock">
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[11px] font-bold">Today's stock movement</div>
            <div className="text-[9px] text-muted-foreground">Recipe-linked · updates with every order</div>
          </div>
          <Pill tone="red"><AlertTriangle className="h-2.5 w-2.5" /> 2 below par</Pill>
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-5 gap-2 px-2 py-1.5 bg-muted/50 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className="col-span-2">Ingredient</span><span>On hand</span><span>Par</span><span>Movement</span>
          </div>
          {rows.map((r) => {
            const pct = Math.min(100, (r.qty / r.par) * 100);
            const bar = r.tone === "red" ? "bg-red-500" : r.tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
            return (
              <div key={r.name} className="grid grid-cols-5 gap-2 px-2 py-2 border-t border-border/60 items-center">
                <div className="col-span-2">
                  <div className="text-[11px] font-semibold">{r.name}</div>
                  <div className="text-[9px] text-muted-foreground">{r.unit}</div>
                </div>
                <div className="text-[11px] font-bold tabular-nums">{r.qty}</div>
                <div>
                  <div className="text-[10px] tabular-nums">{r.par}</div>
                  <div className="h-1 mt-0.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <Pill tone={r.tone}>{r.used}</Pill>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between rounded-lg bg-primary/5 border border-primary/20 p-2">
          <div className="flex items-center gap-1.5 text-[10px]">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="font-semibold">Auto-PO ready:</span>
            <span className="text-muted-foreground">Basmati Rice 25 kg from Sharma Traders</span>
          </div>
          <button className="text-[10px] font-bold text-primary">Send →</button>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* --------------------------- 6. PayrollMockup ---------------------------- */

export function PayrollMockup() {
  const staff = [
    { name: "Ramesh K.", role: "Head Chef", hours: 168, pay: 38000, status: "Paid", tone: "green" as const },
    { name: "Priya S.", role: "Captain", hours: 156, pay: 24000, status: "Paid", tone: "green" as const },
    { name: "Arif M.", role: "Tandoor", hours: 172, pay: 28500, status: "Pending", tone: "amber" as const },
    { name: "Suman D.", role: "Server", hours: 148, pay: 18200, status: "Pending", tone: "amber" as const },
  ];
  return (
    <BrowserFrame title="Payroll · December">
      <div className="p-3">
        <div className="grid grid-cols-3 gap-2 mb-2">
          <MetricTile label="Headcount" value="22" tone="primary" icon={Users} />
          <MetricTile label="Hours" value="3,684" delta="+3% vs Nov" tone="green" icon={Clock} />
          <MetricTile label="Payout" value="₹6.42L" delta="On budget" tone="purple" icon={IndianRupee} />
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-6 gap-2 px-2 py-1.5 bg-muted/50 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className="col-span-2">Staff</span><span>Role</span><span>Hours</span><span>Pay</span><span>Status</span>
          </div>
          {staff.map((s) => (
            <div key={s.name} className="grid grid-cols-6 gap-2 px-2 py-1.5 border-t border-border/60 items-center text-[10px]">
              <div className="col-span-2 flex items-center gap-1.5">
                <span className="h-5 w-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[9px] font-bold">{s.name[0]}</span>
                <span className="font-semibold">{s.name}</span>
              </div>
              <span className="text-muted-foreground">{s.role}</span>
              <span className="tabular-nums">{s.hours}</span>
              <span className="font-bold tabular-nums">₹{s.pay.toLocaleString("en-IN")}</span>
              <Pill tone={s.tone}>{s.status}</Pill>
            </div>
          ))}
        </div>
      </div>
    </BrowserFrame>
  );
}

/* --------------------------- 7. FinanceMockup ---------------------------- */

export function FinanceMockup() {
  const lines = [
    { label: "Sales", value: 824000, tone: "text-emerald-600" },
    { label: "Food cost", value: -248000, tone: "text-red-600" },
    { label: "Staff cost", value: -148000, tone: "text-red-600" },
    { label: "Rent & utilities", value: -92000, tone: "text-red-600" },
    { label: "Marketing & other", value: -38000, tone: "text-red-600" },
  ];
  const net = lines.reduce((s, x) => s + x.value, 0);
  const pct = (v: number) => ((Math.abs(v) / 824000) * 100).toFixed(0);
  return (
    <BrowserFrame title="Finance · Live P&L">
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[11px] font-bold">This month · all outlets</div>
            <div className="text-[9px] text-muted-foreground">Updated 2 mins ago</div>
          </div>
          <Pill tone="green"><CheckCircle2 className="h-2.5 w-2.5" /> Reconciled</Pill>
        </div>
        <div className="rounded-lg border border-border bg-background overflow-hidden">
          {lines.map((l) => (
            <div key={l.label} className="px-2.5 py-1.5 border-b border-border/60 last:border-0">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-medium">{l.label}</span>
                <span className={`font-bold tabular-nums ${l.tone}`}>{l.value > 0 ? "+" : ""}₹{Math.abs(l.value).toLocaleString("en-IN")}</span>
              </div>
              <div className="h-1 mt-1 rounded-full bg-muted overflow-hidden">
                <div className={`h-full ${l.value > 0 ? "bg-emerald-500" : "bg-red-400"}`} style={{ width: `${pct(l.value)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded-lg bg-gradient-to-r from-primary/10 to-emerald-500/10 border border-primary/20 p-2.5 flex items-center justify-between">
          <div>
            <div className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Net profit</div>
            <div className="text-base font-bold tabular-nums text-emerald-600">+₹{net.toLocaleString("en-IN")}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-muted-foreground">Margin</div>
            <div className="text-base font-bold text-primary">{((net / 824000) * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* --------------------- 8. GrowthCampaignMockup --------------------------- */

export function GrowthCampaignMockup() {
  const channels = [
    { name: "WhatsApp", sent: 1842, opened: 1356, conv: 142, tone: "green" as const },
    { name: "SMS", sent: 980, opened: 612, conv: 38, tone: "blue" as const },
    { name: "Email", sent: 2120, opened: 824, conv: 56, tone: "purple" as const },
  ];
  return (
    <BrowserFrame title="Growth · Friday Feast campaign">
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[11px] font-bold">"Friday Feast" · Live now</div>
            <div className="text-[9px] text-muted-foreground">Targeting lapsed guests · ends 11pm</div>
          </div>
          <Pill tone="green"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Sending</Pill>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          {channels.map((c) => (
            <div key={c.name} className="rounded-lg border border-border bg-background p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold">{c.name}</span>
                <Pill tone={c.tone}>{((c.conv / c.sent) * 100).toFixed(1)}%</Pill>
              </div>
              <div className="text-[9px] text-muted-foreground">Sent <span className="font-bold text-foreground tabular-nums">{c.sent.toLocaleString("en-IN")}</span></div>
              <div className="text-[9px] text-muted-foreground">Opened <span className="font-bold text-foreground tabular-nums">{c.opened.toLocaleString("en-IN")}</span></div>
              <div className="text-[9px] text-primary font-bold">Conv {c.conv}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border bg-background p-2">
          <div className="text-[10px] font-bold mb-1.5">Today's attributed revenue</div>
          <Sparkline bars={[10, 22, 18, 36, 48, 42, 58, 70, 64, 82, 76, 88]} accent="emerald" />
          <div className="flex items-center justify-between mt-1 text-[10px]">
            <span className="text-muted-foreground">Spend ₹4,200</span>
            <span className="font-bold text-emerald-600">Revenue ₹86,400 · 20.5× ROAS</span>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* -------------------------- 9. KhanaAIChatMockup ------------------------- */

export function KhanaAIChatMockup() {
  return (
    <div className="rounded-2xl overflow-hidden shadow-2xl border border-purple-500/20 bg-gradient-to-br from-[#0F172A] via-[#1a1535] to-[#0F172A] text-white">
      <div className="h-10 flex items-center px-3 gap-2 border-b border-white/10 bg-white/5">
        <span className="h-6 w-6 rounded-lg bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
          <Sparkles className="h-3 w-3" />
        </span>
        <div>
          <div className="text-[11px] font-bold leading-tight">Khana AI</div>
          <div className="text-[9px] text-white/60 leading-tight">Your restaurant co-pilot</div>
        </div>
        <Pill tone="green">●  Online</Pill>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex">
          <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white/10 backdrop-blur p-2 text-[10px]">
            What sold best last Friday night?
          </div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-gradient-to-br from-primary/30 to-purple-500/30 border border-white/10 p-2.5 text-[10px] leading-relaxed">
            Paneer Tikka is trending tonight — 72 orders by 9pm, +38% vs your usual Friday.
            Butter Naan and Mojito are pairing strongly. Want me to push them?
            <div className="grid grid-cols-3 gap-1 mt-1.5 pt-1.5 border-t border-white/15">
              <div><div className="text-[8px] text-white/60">Orders</div><div className="text-[11px] font-bold">72</div></div>
              <div><div className="text-[8px] text-white/60">Revenue</div><div className="text-[11px] font-bold">₹18.4k</div></div>
              <div><div className="text-[8px] text-white/60">Margin</div><div className="text-[11px] font-bold text-emerald-300">62%</div></div>
            </div>
          </div>
        </div>
        <div className="flex">
          <div className="max-w-[60%] rounded-2xl rounded-bl-sm bg-white/10 p-2 text-[10px]">Yes, draft a campaign.</div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-gradient-to-br from-primary/30 to-purple-500/30 border border-white/10 p-2.5 text-[10px] leading-relaxed">
            Done. "Friday Feast" — +12% combo on Paneer Tikka & Naan, sending to 1,842 lapsed guests at 5pm. Confirm?
            <div className="flex gap-1 mt-1.5">
              <button className="flex-1 h-6 rounded-md bg-primary text-[9px] font-bold">Send now</button>
              <button className="flex-1 h-6 rounded-md bg-white/10 text-[9px] font-bold">Edit</button>
            </div>
          </div>
        </div>
        <div className="rounded-full bg-white/5 border border-white/10 h-7 px-3 flex items-center text-[9px] text-white/60">
          Ask Khana AI anything about your restaurant…
        </div>
      </div>
    </div>
  );
}

/* ------------------------ 10. SuperAdminMockup --------------------------- */

export function SuperAdminMockup() {
  const tenants = [
    { name: "Tandoor House", plan: "Growth", outlets: 4, mrr: "₹14,800", health: "green" as const },
    { name: "Cafe Mocha", plan: "Starter", outlets: 1, mrr: "₹2,400", health: "green" as const },
    { name: "Spice Route", plan: "Scale", outlets: 12, mrr: "₹38,200", health: "amber" as const },
    { name: "Biryani Bay", plan: "Growth", outlets: 6, mrr: "₹18,600", health: "red" as const },
  ];
  return (
    <BrowserFrame title="Super Admin · KhanaLagao SaaS">
      <div className="p-3">
        <div className="grid grid-cols-4 gap-2 mb-2">
          <MetricTile label="Tenants" value="248" delta="+14 this wk" tone="primary" icon={Users} />
          <MetricTile label="Active outlets" value="864" delta="+42" tone="green" icon={ShieldCheck} />
          <MetricTile label="MRR" value="₹42.6L" delta="+9.4%" tone="purple" icon={IndianRupee} />
          <MetricTile label="Health" value="98.6%" delta="SLA" tone="amber" icon={CheckCircle2} />
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-6 gap-2 px-2 py-1.5 bg-muted/50 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className="col-span-2">Tenant</span><span>Plan</span><span>Outlets</span><span>MRR</span><span>Health</span>
          </div>
          {tenants.map((t) => (
            <div key={t.name} className="grid grid-cols-6 gap-2 px-2 py-1.5 border-t border-border/60 items-center text-[10px]">
              <div className="col-span-2 flex items-center gap-1.5">
                <span className="h-5 w-5 rounded-md bg-gradient-to-br from-primary to-purple-500 text-white flex items-center justify-center text-[9px] font-bold">{t.name[0]}</span>
                <span className="font-semibold truncate">{t.name}</span>
              </div>
              <Pill tone={t.plan === "Scale" ? "purple" : t.plan === "Growth" ? "primary" : "slate"}>{t.plan}</Pill>
              <span className="tabular-nums">{t.outlets}</span>
              <span className="font-bold tabular-nums">{t.mrr}</span>
              <span className={`h-2 w-2 rounded-full ${t.health === "green" ? "bg-emerald-500" : t.health === "amber" ? "bg-amber-400" : "bg-red-500 animate-pulse"}`} />
            </div>
          ))}
        </div>
      </div>
    </BrowserFrame>
  );
}

/* --------------------------- 11. ReportsMockup --------------------------- */

export function ReportsMockup() {
  return (
    <BrowserFrame title="Reports · 30-day summary">
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Pill tone="primary">30 days</Pill>
          <Pill tone="slate">All outlets</Pill>
          <Pill tone="slate"><Filter className="h-2.5 w-2.5" /> Segments</Pill>
          <span className="ml-auto text-[9px] text-muted-foreground">Export · CSV / Excel / PDF</span>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <MetricTile label="Revenue" value="₹38.4L" delta="+12.4%" tone="primary" icon={IndianRupee} />
          <MetricTile label="Orders" value="4,182" delta="+8.1%" tone="green" icon={Receipt} />
          <MetricTile label="AOV" value="₹918" delta="+₹38" tone="purple" icon={TrendingUp} />
          <MetricTile label="Repeat" value="42%" delta="+4 pts" tone="amber" icon={Users} />
        </div>
        <div className="rounded-lg border border-border bg-background p-2.5">
          <div className="text-[10px] font-bold mb-1">Daily revenue vs target</div>
          <Sparkline bars={[35, 48, 42, 58, 52, 70, 65, 78, 82, 70, 88, 92, 76, 84, 90, 95, 82, 88, 76, 92, 96, 88, 94, 98, 92, 88, 96, 100, 94, 98]} />
          <div className="flex justify-between mt-1 text-[8px] text-muted-foreground"><span>Wk 1</span><span>Wk 2</span><span>Wk 3</span><span>Wk 4</span></div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* -------------------------- 12. MobileAppMockup -------------------------- */

export function MobileAppMockup() {
  return (
    <PhoneFrame>
      <div className="h-full bg-background overflow-hidden">
        <div className="bg-gradient-to-br from-primary to-orange-500 text-white p-3 pb-5">
          <div className="text-[9px] opacity-80">Owner · Tandoor House</div>
          <div className="text-[14px] font-bold font-serif">Today, live ↓</div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <div className="rounded-lg bg-white/15 backdrop-blur p-1.5">
              <div className="text-[8px] opacity-80">Sales</div>
              <div className="text-[13px] font-bold tabular-nums">₹1.42L</div>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur p-1.5">
              <div className="text-[8px] opacity-80">Orders</div>
              <div className="text-[13px] font-bold tabular-nums">184</div>
            </div>
          </div>
        </div>
        <div className="px-3 -mt-3">
          <div className="rounded-lg bg-card border border-border shadow-lg p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <BrainCircuit className="h-3 w-3 text-purple-500" />
              <span className="text-[10px] font-bold">Khana AI · Today's tip</span>
            </div>
            <p className="text-[9px] text-muted-foreground leading-snug">Push Paneer Tikka tonight — +38% vs your usual Friday. ROAS forecast 18×.</p>
            <button className="mt-1.5 text-[9px] font-bold text-primary">Run campaign →</button>
          </div>
        </div>
        <div className="px-3 mt-3 grid grid-cols-4 gap-2">
          {[
            { i: Receipt, l: "Bills" },
            { i: ChefHat, l: "Kitchen" },
            { i: Package, l: "Stock" },
            { i: BarChart3, l: "Reports" },
          ].map(({ i: Icon, l }) => (
            <div key={l} className="flex flex-col items-center gap-1">
              <span className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon className="h-4 w-4" /></span>
              <span className="text-[9px] font-semibold">{l}</span>
            </div>
          ))}
        </div>
        <div className="px-3 mt-3 space-y-1.5">
          <div className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground">Live alerts</div>
          {[
            { i: Bell, t: "T7 ordered Paneer Tikka", tone: "primary" as const },
            { i: AlertTriangle, t: "Basmati Rice below par", tone: "red" as const },
            { i: Star, t: "New 5★ on Google", tone: "amber" as const },
          ].map(({ i: Icon, t, tone }) => (
            <div key={t} className="flex items-center gap-2 rounded-lg bg-card border border-border p-1.5">
              <Icon className={`h-3 w-3 ${tone === "red" ? "text-red-500" : tone === "amber" ? "text-amber-500" : "text-primary"}`} />
              <span className="text-[9px] flex-1">{t}</span>
            </div>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Helper map used by template pages                                          */
/* -------------------------------------------------------------------------- */

export const MOCKUPS = {
  dashboard: DashboardMockup,
  pos: POSMockup,
  qr: QRMenuMobileMockup,
  kds: KitchenKDSMockup,
  inventory: InventoryMockup,
  payroll: PayrollMockup,
  finance: FinanceMockup,
  growth: GrowthCampaignMockup,
  ai: KhanaAIChatMockup,
  superadmin: SuperAdminMockup,
  reports: ReportsMockup,
  mobile: MobileAppMockup,
} as const;

export type MockupKey = keyof typeof MOCKUPS;
