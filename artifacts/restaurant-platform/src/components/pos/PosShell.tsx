import {
  useState, useEffect, useRef, useCallback, ReactNode,
  createContext, useContext, useMemo,
} from "react";
import { useLocation } from "wouter";
import {
  Maximize2, Minimize2, Volume2, VolumeX, LogOut, Wifi, WifiOff,
  Keyboard, Calculator as CalcIcon, Pause, RotateCcw, X, HelpCircle,
  Printer, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useRestaurantInfo } from "@/lib/hooks";
import { useBranchContext } from "@/lib/branch";
import { BranchSwitcher } from "@/components/layout/BranchSwitcher";
import { useOnlineStatus, useOfflineSyncEngine } from "@/lib/useOnlineStatus";
import { resolveImageUrl } from "@/components/ImageUploadField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Sound feedback ──────────────────────────────────────────────────────
type SoundKind = "click" | "add" | "remove" | "success" | "error" | "warn";
const SOUND_FREQ: Record<SoundKind, [number, number, number]> = {
  click: [880, 0.04, 0.05],
  add: [660, 0.06, 0.08],
  remove: [330, 0.08, 0.08],
  success: [988, 0.18, 0.12],
  error: [220, 0.25, 0.15],
  warn: [440, 0.12, 0.08],
};

let _ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!_ctx) {
      const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = W.AudioContext ?? W.webkitAudioContext;
      if (!Ctor) return null;
      _ctx = new Ctor();
    }
    return _ctx;
  } catch { return null; }
}

const SOUND_KEY = "tt_pos_sound_muted";
export function usePosSounds() {
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SOUND_KEY) === "1";
  });
  useEffect(() => {
    try { window.localStorage.setItem(SOUND_KEY, muted ? "1" : "0"); } catch { /* noop */ }
  }, [muted]);
  const play = useCallback((kind: SoundKind) => {
    if (muted) return;
    const ctx = getCtx();
    if (!ctx) return;
    try {
      const [freq, dur, vol] = SOUND_FREQ[kind];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === "error" ? "sawtooth" : kind === "success" ? "triangle" : "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    } catch { /* noop */ }
  }, [muted]);
  return { muted, setMuted, play };
}

// ─── Context shared with pos.tsx ─────────────────────────────────────────
export interface PosHandlers {
  onSearchFocus?: () => void;
  onHold?: () => void;
  onRecall?: () => void;
  onKOT?: () => void;
  onPrint?: () => void;
  onPay?: () => void;
  onNewOrder?: () => void;
  onIncQty?: () => void;
  onDecQty?: () => void;
  onDelete?: () => void;
  onPlaceOrder?: () => void;
}

interface PosShellCtx {
  play: (k: SoundKind) => void;
  setHandlers: (h: PosHandlers) => void;
  openHold: () => void;
  openCalc: () => void;
  openHelp: () => void;
}
const Ctx = createContext<PosShellCtx | null>(null);
export function usePosShell() {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePosShell must be used within <PosShell>");
  return c;
}

// ─── Held bills (localStorage) ───────────────────────────────────────────
const HOLD_KEY = "tt_pos_held_bills";
export interface HeldBill {
  id: string;
  label: string;
  heldAt: number;
  payload: unknown;
}
function loadHeld(): HeldBill[] {
  try {
    const raw = window.localStorage.getItem(HOLD_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as HeldBill[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveHeld(list: HeldBill[]) {
  try { window.localStorage.setItem(HOLD_KEY, JSON.stringify(list)); } catch { /* noop */ }
}
export function holdBill(label: string, payload: unknown): HeldBill {
  const bill: HeldBill = { id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label, heldAt: Date.now(), payload };
  saveHeld([bill, ...loadHeld()].slice(0, 20));
  return bill;
}
export function listHeld(): HeldBill[] { return loadHeld(); }
export function removeHeld(id: string) { saveHeld(loadHeld().filter(b => b.id !== id)); }

// ─── Header clock ────────────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
  return now;
}

// ─── Shortcuts help modal ────────────────────────────────────────────────
const SHORTCUTS: Array<[string, string]> = [
  ["F2", "Focus item search"],
  ["F4", "Hold current bill"],
  ["F5", "Recall held bill"],
  ["F6", "Print KOT"],
  ["F7", "Print receipt"],
  ["F8", "Pay / Charge"],
  ["Ctrl + Enter", "Place order"],
  ["+ / −", "Increase / decrease last item qty"],
  ["Delete", "Remove last item"],
  ["Esc", "Close modal / clear focus"],
  ["?", "Show this help"],
];

function ShortcutsHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-semibold flex items-center gap-2"><Keyboard className="w-4 h-4 text-primary" /> Keyboard shortcuts</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-1.5">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
              <span className="text-sm text-muted-foreground">{d}</span>
              <kbd className="px-2 py-0.5 text-xs font-mono font-semibold bg-muted text-foreground border border-border rounded">{k}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Calculator widget ───────────────────────────────────────────────────
function CalculatorWidget({ onClose }: { onClose: () => void }) {
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [reset, setReset] = useState(true);

  const press = (ch: string) => {
    if (/\d/.test(ch)) {
      setDisplay(d => (reset || d === "0") ? ch : d + ch);
      setReset(false);
    } else if (ch === ".") {
      if (!display.includes(".")) setDisplay(d => (reset ? "0." : d + "."));
      setReset(false);
    } else if (ch === "C") {
      setDisplay("0"); setPrev(null); setOp(null); setReset(true);
    } else if (ch === "←") {
      setDisplay(d => d.length <= 1 ? "0" : d.slice(0, -1));
    } else if (["+", "−", "×", "÷"].includes(ch)) {
      const cur = parseFloat(display);
      if (prev != null && op && !reset) {
        const r = compute(prev, cur, op);
        setDisplay(String(r)); setPrev(r);
      } else setPrev(cur);
      setOp(ch); setReset(true);
    } else if (ch === "=") {
      const cur = parseFloat(display);
      if (prev != null && op) {
        const r = compute(prev, cur, op);
        setDisplay(String(r)); setPrev(null); setOp(null); setReset(true);
      }
    }
  };
  const compute = (a: number, b: number, o: string) => {
    if (o === "+") return +(a + b).toFixed(6);
    if (o === "−") return +(a - b).toFixed(6);
    if (o === "×") return +(a * b).toFixed(6);
    if (o === "÷") return b === 0 ? 0 : +(a / b).toFixed(6);
    return b;
  };
  const keys = [
    "C", "←", "÷", "×",
    "7", "8", "9", "−",
    "4", "5", "6", "+",
    "1", "2", "3", "=",
    "0", ".",
  ];
  return (
    <div className="fixed bottom-4 right-4 z-[90] w-64 bg-card border border-border rounded-xl shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold flex items-center gap-1.5"><CalcIcon className="w-3.5 h-3.5 text-primary" />Calculator</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
      </div>
      <div className="p-3 space-y-2">
        <div className="bg-muted/40 rounded-md px-3 py-2 text-right text-2xl font-mono font-semibold truncate" data-testid="calc-display">{display}</div>
        <div className="grid grid-cols-4 gap-1.5">
          {keys.map(k => (
            <button
              key={k}
              onClick={() => press(k)}
              className={cn(
                "py-2 rounded-md text-sm font-semibold active:scale-95 transition-transform",
                k === "=" ? "bg-primary text-primary-foreground row-span-2 col-start-4" :
                ["+", "−", "×", "÷"].includes(k) ? "bg-primary/10 text-primary" :
                k === "C" ? "bg-destructive/10 text-destructive" :
                "bg-muted hover:bg-muted/70",
                k === "0" && "col-span-2",
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Held bills drawer ───────────────────────────────────────────────────
function HeldBillsDrawer({
  onClose, onRecall,
}: {
  onClose: () => void;
  onRecall: (bill: HeldBill) => void;
}) {
  const [bills, setBills] = useState<HeldBill[]>(() => loadHeld());
  return (
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-semibold flex items-center gap-2"><Pause className="w-4 h-4 text-primary" /> Held bills <span className="text-xs text-muted-foreground">({bills.length})</span></h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {bills.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No held bills</p>
          ) : bills.map(b => (
            <div key={b.id} className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-accent/40">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{b.label}</p>
                <p className="text-[11px] text-muted-foreground">{new Date(b.heldAt).toLocaleString()}</p>
              </div>
              <Button
                size="sm"
                variant="default"
                onClick={() => { onRecall(b); removeHeld(b.id); setBills(loadHeld()); onClose(); }}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" />Recall
              </Button>
              <button
                onClick={() => { removeHeld(b.id); setBills(loadHeld()); }}
                className="text-muted-foreground hover:text-destructive p-1"
                aria-label="Delete held bill"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main shell ──────────────────────────────────────────────────────────
export interface PosShellProps {
  children: ReactNode;
  handlers?: PosHandlers;
  onRecallBill?: (bill: HeldBill) => void;
}

export function PosShell({ children, handlers, onRecallBill }: PosShellProps) {
  useOfflineSyncEngine();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { data: restaurant } = useRestaurantInfo();
  const { hasMultipleBranches, branches, selectedBranchId } = useBranchContext();
  const { online } = useOnlineStatus();
  const { muted, setMuted, play } = usePosSounds();
  const now = useClock();
  const handlersRef = useRef<PosHandlers>({});
  handlersRef.current = handlers ?? {};

  const [isFull, setIsFull] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [showHold, setShowHold] = useState(false);

  useEffect(() => {
    const f = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      play("click");
    } catch { /* noop */ }
  }, [play]);

  const handleExit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    navigate("/dashboard");
  }, [navigate]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const isField = tag === "input" || tag === "textarea" || tag === "select" || (e.target as HTMLElement | null)?.isContentEditable;
      const h = handlersRef.current;
      // Function keys always work
      if (e.key === "F2") { e.preventDefault(); h.onSearchFocus?.(); play("click"); return; }
      if (e.key === "F4") { e.preventDefault(); h.onHold?.(); play("warn"); return; }
      if (e.key === "F5") { e.preventDefault(); setShowHold(true); play("click"); return; }
      if (e.key === "F6") { e.preventDefault(); h.onKOT?.(); play("click"); return; }
      if (e.key === "F7") { e.preventDefault(); h.onPrint?.(); play("click"); return; }
      if (e.key === "F8") { e.preventDefault(); h.onPay?.(); play("success"); return; }
      if (e.key === "Escape") {
        if (showHelp) { setShowHelp(false); return; }
        if (showCalc) { setShowCalc(false); return; }
        if (showHold) { setShowHold(false); return; }
        if (isField) (e.target as HTMLElement).blur();
        return;
      }
      if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); h.onPlaceOrder?.(); play("success"); return; }
      if (isField) return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); setShowHelp(s => !s); return; }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); h.onIncQty?.(); play("add"); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); h.onDecQty?.(); play("remove"); return; }
      if (e.key === "Delete") { e.preventDefault(); h.onDelete?.(); play("remove"); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [play, showHelp, showCalc, showHold]);

  const ctx = useMemo<PosShellCtx>(() => ({
    play,
    setHandlers: (h) => { handlersRef.current = h; },
    openHold: () => setShowHold(true),
    openCalc: () => setShowCalc(true),
    openHelp: () => setShowHelp(true),
  }), [play]);

  const outletName = useMemo(() => {
    if (!hasMultipleBranches) return null;
    if (selectedBranchId == null) return "All branches";
    return branches.find(b => b.id === selectedBranchId)?.name ?? null;
  }, [hasMultipleBranches, selectedBranchId, branches]);

  const cashierName = user?.name ?? "Cashier";
  const cashierRole = user?.role ?? "";

  return (
    <Ctx.Provider value={ctx}>
      <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground">
        {/* Compact POS header */}
        <header className="flex items-center gap-3 px-3 sm:px-4 h-14 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {restaurant?.logoUrl ? (
              <img src={resolveImageUrl(restaurant.logoUrl) ?? ""} alt="" className="w-9 h-9 rounded-lg object-cover bg-muted flex-shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold flex-shrink-0">
                {restaurant?.name?.[0] ?? "P"}
              </div>
            )}
            <div className="min-w-0 hidden sm:block">
              <p className="text-sm font-semibold leading-tight truncate">{restaurant?.name ?? "POS"}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">POS Terminal</p>
            </div>
          </div>

          {hasMultipleBranches && (
            <div className="hidden md:block">
              <BranchSwitcher />
            </div>
          )}
          {outletName && !hasMultipleBranches && (
            <span className="hidden md:inline-flex items-center text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground">{outletName}</span>
          )}

          <div className="flex-1" />

          {/* Status pills */}
          <div className="hidden lg:flex items-center gap-1.5">
            <span className={cn(
              "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md",
              online ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                     : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
            )}>
              {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {online ? "Online" : "Offline"}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-muted text-muted-foreground">
              <Printer className="w-3 h-3" /> Ready
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-muted text-muted-foreground">
              <Activity className="w-3 h-3" /> KOT
            </span>
          </div>

          {/* Cashier + clock */}
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-xs font-semibold truncate max-w-[140px]" title={cashierName}>{cashierName}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{cashierRole}</span>
          </div>
          <div className="hidden md:flex flex-col items-end leading-tight font-mono">
            <span className="text-sm font-semibold tabular-nums">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            <span className="text-[10px] text-muted-foreground">{now.toLocaleDateString([], { day: "2-digit", month: "short" })}</span>
          </div>

          {/* Action icons */}
          <div className="flex items-center gap-0.5 ml-1 border-l border-border pl-2">
            <IconBtn title="Calculator" onClick={() => { setShowCalc(s => !s); play("click"); }}><CalcIcon className="w-4 h-4" /></IconBtn>
            <IconBtn title="Held bills (F5)" onClick={() => { setShowHold(true); play("click"); }}><Pause className="w-4 h-4" /></IconBtn>
            <IconBtn title={muted ? "Unmute sounds" : "Mute sounds"} onClick={() => setMuted(m => !m)}>{muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</IconBtn>
            <IconBtn title="Shortcuts (?)" onClick={() => setShowHelp(true)}><HelpCircle className="w-4 h-4" /></IconBtn>
            <IconBtn title={isFull ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>{isFull ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</IconBtn>
            <button
              onClick={handleExit}
              className="ml-1 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
              data-testid="pos-exit"
            >
              <LogOut className="w-3.5 h-3.5" /> Exit
            </button>
          </div>
        </header>

        {/* Offline banner */}
        {!online && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs px-4 py-1.5 flex items-center gap-2 flex-shrink-0">
            <WifiOff className="w-3.5 h-3.5" />
            You're offline — orders are queued locally and will sync automatically once you're back online.
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {children}
        </main>
      </div>

      {showHelp && <ShortcutsHelpModal onClose={() => setShowHelp(false)} />}
      {showCalc && <CalculatorWidget onClose={() => setShowCalc(false)} />}
      {showHold && (
        <HeldBillsDrawer
          onClose={() => setShowHold(false)}
          onRecall={(b) => { onRecallBill?.(b); play("success"); }}
        />
      )}
    </Ctx.Provider>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="w-8 h-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {children}
    </button>
  );
}

// ─── Hook for pos.tsx to register handlers ───────────────────────────────
export function usePosHandlers(handlers: PosHandlers) {
  const { setHandlers } = usePosShell();
  useEffect(() => {
    setHandlers(handlers);
    return () => setHandlers({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, Object.values(handlers));
}

// Re-export for convenience
export { Input as PosInput, Button as PosButton };
