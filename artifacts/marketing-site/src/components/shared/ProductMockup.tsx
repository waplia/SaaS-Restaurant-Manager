import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type MockupKind = "dashboard" | "pos" | "mobile" | "kds" | "report" | "chat";

interface Props {
  kind?: MockupKind;
  title?: string;
  accentBars?: number[];
}

export function ProductMockup({ kind = "dashboard", title = "KhanaLagao", accentBars = [40, 65, 55, 80, 50, 90, 70, 60, 95, 75, 85, 55] }: Props) {
  return (
    <div className="relative">
      <div className="aspect-[5/4] rounded-2xl overflow-hidden shadow-2xl border border-border bg-card relative">
        <div className="absolute inset-0 bg-gradient-to-br from-card via-background to-accent/30 flex flex-col">
          <div className="h-9 border-b border-border/60 flex items-center px-4 gap-2 bg-background/60 backdrop-blur">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            <div className="ml-3 h-3 w-28 rounded bg-muted" />
            <div className="ml-auto text-[10px] text-muted-foreground font-medium">{title}</div>
          </div>
          {kind === "dashboard" && <DashboardBody bars={accentBars} />}
          {kind === "pos" && <POSBody />}
          {kind === "mobile" && <MobileBody />}
          {kind === "kds" && <KDSBody />}
          {kind === "report" && <ReportBody bars={accentBars} />}
          {kind === "chat" && <ChatBody />}
        </div>
      </div>
    </div>
  );
}

function DashboardBody({ bars }: { bars: number[] }) {
  return (
    <div className="flex-1 p-5 grid grid-cols-3 gap-4">
      <div className="col-span-1 space-y-3">
        <div className="h-6 w-3/4 rounded bg-primary/20" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-5/6 rounded bg-muted" />
        <div className="h-16 w-full rounded-lg bg-primary/10 border border-primary/20" />
        <div className="h-16 w-full rounded-lg bg-muted" />
      </div>
      <div className="col-span-2 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-14 rounded-lg bg-background border border-border/60 p-2">
              <div className="h-2 w-10 rounded bg-muted mb-1.5" />
              <div className="h-3 w-14 rounded bg-foreground/70" />
            </div>
          ))}
        </div>
        <div className="h-32 rounded-lg bg-background border border-border/60 p-3 flex items-end gap-1.5">
          {bars.map((h, i) => (
            <div key={i} style={{ height: `${h}%` }} className="flex-1 rounded-t bg-gradient-to-t from-primary/60 to-primary" />
          ))}
        </div>
      </div>
    </div>
  );
}

function POSBody() {
  return (
    <div className="flex-1 p-4 grid grid-cols-5 gap-2">
      <div className="col-span-3 grid grid-cols-3 gap-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 flex flex-col items-center justify-center p-2">
            <div className="h-6 w-6 rounded-full bg-primary/30 mb-1" />
            <div className="h-1.5 w-10 rounded bg-foreground/60" />
            <div className="h-1.5 w-8 rounded bg-foreground/30 mt-1" />
          </div>
        ))}
      </div>
      <div className="col-span-2 rounded-lg bg-background border border-border/60 p-3 space-y-2 flex flex-col">
        <div className="text-[10px] font-bold text-foreground/70">CHECK #142</div>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex justify-between border-b border-border/40 pb-1.5">
            <div className="h-2 w-16 rounded bg-foreground/60" />
            <div className="h-2 w-10 rounded bg-foreground/50" />
          </div>
        ))}
        <div className="flex-1" />
        <div className="border-t border-border pt-2 flex justify-between font-bold">
          <div className="h-3 w-14 rounded bg-foreground" />
          <div className="h-3 w-16 rounded bg-primary" />
        </div>
        <div className="h-9 rounded-lg bg-primary" />
      </div>
    </div>
  );
}

function MobileBody() {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="aspect-[9/16] w-40 rounded-2xl border-2 border-foreground/20 bg-background shadow-xl overflow-hidden">
        <div className="h-5 bg-foreground/5 border-b border-border/40 flex items-center justify-center">
          <div className="h-1 w-12 rounded-full bg-foreground/20" />
        </div>
        <div className="p-3 space-y-2">
          <div className="h-3 w-2/3 rounded bg-primary/40" />
          <div className="h-2 w-full rounded bg-muted" />
          <div className="h-2 w-5/6 rounded bg-muted" />
          <div className="h-16 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 mt-2" />
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            <div className="h-10 rounded bg-muted" />
            <div className="h-10 rounded bg-muted" />
            <div className="h-10 rounded bg-muted" />
            <div className="h-10 rounded bg-muted" />
          </div>
          <div className="h-7 rounded-md bg-primary mt-2" />
        </div>
      </div>
    </div>
  );
}

function KDSBody() {
  return (
    <div className="flex-1 p-4 grid grid-cols-4 gap-2 bg-foreground/95">
      {[
        { num: "T7", time: "02:14", color: "bg-green-500" },
        { num: "T3", time: "05:48", color: "bg-amber-400" },
        { num: "T12", time: "08:02", color: "bg-red-500" },
        { num: "DLV", time: "01:32", color: "bg-blue-400" },
      ].map((tkt, i) => (
        <div key={i} className="rounded-lg bg-background/95 p-2 space-y-1.5 flex flex-col">
          <div className="flex justify-between items-center">
            <div className="text-[10px] font-bold">{tkt.num}</div>
            <div className={`h-2 w-2 rounded-full ${tkt.color}`} />
          </div>
          <div className="h-1.5 w-3/4 rounded bg-foreground/60" />
          <div className="h-1.5 w-full rounded bg-foreground/30" />
          <div className="h-1.5 w-5/6 rounded bg-foreground/30" />
          <div className="h-1.5 w-2/3 rounded bg-foreground/30" />
          <div className="flex-1" />
          <div className="text-[9px] text-muted-foreground">{tkt.time}</div>
        </div>
      ))}
    </div>
  );
}

function ReportBody({ bars }: { bars: number[] }) {
  return (
    <div className="flex-1 p-5 space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-lg bg-background border border-border/60 p-2">
            <div className="h-2 w-10 rounded bg-muted mb-1" />
            <div className="h-3 w-12 rounded bg-primary/70" />
          </div>
        ))}
      </div>
      <div className="h-40 rounded-lg bg-background border border-border/60 p-3 flex items-end gap-1">
        {bars.map((h, i) => (
          <div key={i} style={{ height: `${h}%` }} className={`flex-1 rounded-t ${i % 3 === 0 ? "bg-primary" : "bg-primary/40"}`} />
        ))}
      </div>
      <div className="h-12 rounded-lg bg-gradient-to-r from-primary/20 to-primary/5" />
    </div>
  );
}

function ChatBody() {
  return (
    <div className="flex-1 p-4 space-y-2 flex flex-col">
      <div className="flex">
        <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-muted p-2.5 text-[10px] font-medium">What sold best on Friday night last week?</div>
      </div>
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary/15 border border-primary/30 p-2.5 text-[10px]">
          Paneer Tikka (₹18,400, 72 orders), Butter Naan (218 units) and Mojito (96 glasses). Want me to push them tonight?
        </div>
      </div>
      <div className="flex">
        <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-muted p-2.5 text-[10px]">Yes — bump margin items.</div>
      </div>
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary/15 border border-primary/30 p-2.5 text-[10px]">
          Campaign drafted: "Friday Feast" with +12% combo on Paneer Tikka & Naan. Sending to 1,842 lapsed guests at 5pm. Confirm?
        </div>
      </div>
      <div className="flex-1" />
      <div className="rounded-full border border-border h-7 px-3 flex items-center text-[9px] text-muted-foreground">Ask Khana AI…</div>
    </div>
  );
}

export function FloatingBadge({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className={`absolute z-10 flex items-center gap-2 rounded-xl border border-border bg-background/95 backdrop-blur shadow-lg px-3 py-2 ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function MetricBadge({ icon: Icon, label, value, color = "text-primary" }: { icon: LucideIcon; label: string; value: string; color?: string }) {
  return (
    <>
      <Icon className={`h-4 w-4 ${color}`} />
      <div>
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className="text-sm font-bold">{value}</div>
      </div>
    </>
  );
}
