import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Loader2, X, Check, AlertTriangle, Plus, Minus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { FloorTable, MenuItem } from "@/lib/types";

interface ParsedItem {
  menuItemId: number | null;
  nameGuess: string;
  quantity: number;
  notes: string | null;
  confidence: number;
}
interface VoiceParseResponse {
  transcript: string;
  language: string;
  tableId: number | null;
  tableLabel: string | null;
  items: ParsedItem[];
  unresolved: Array<{ nameGuess: string; quantity: number; notes: string | null }>;
  notes: string | null;
}

export interface VoiceOrderConfirmation {
  tableId: number | null;
  items: Array<{ menuItemId: number; quantity: number; notes?: string }>;
  notes?: string;
}

interface Props {
  restaurantId: number;
  defaultTableId: number | null;
  tables: FloorTable[];
  menuItems: MenuItem[];
  onClose: () => void;
  onConfirm: (payload: VoiceOrderConfirmation) => Promise<void> | void;
}

type SpeechRecognitionResult = {
  transcript: string;
  isFinal?: boolean;
};
interface SpeechRecognitionEvent {
  results: ArrayLike<ArrayLike<SpeechRecognitionResult>>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): { new (): SpeechRecognitionLike } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LANG_OPTIONS: { value: string; label: string }[] = [
  { value: "en-IN", label: "English (India)" },
  { value: "hi-IN", label: "Hindi" },
  { value: "en-US", label: "English (US)" },
];

export function VoiceOrderModal({
  restaurantId, defaultTableId, tables, menuItems, onClose, onConfirm,
}: Props) {
  const { toast } = useToast();
  const SR = useMemo(() => getSpeechRecognitionCtor(), []);
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);
  const [language, setLanguage] = useState("en-IN");
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [parsed, setParsed] = useState<VoiceParseResponse | null>(null);
  const [editableItems, setEditableItems] = useState<ParsedItem[]>([]);
  const [tableId, setTableId] = useState<number | null>(defaultTableId);

  useEffect(() => {
    return () => {
      try { recognizerRef.current?.abort?.(); } catch { /* noop */ }
      try { recognizerRef.current?.stop(); } catch { /* noop */ }
    };
  }, []);

  const startRecording = () => {
    if (!SR) {
      toast({
        title: "Voice not supported",
        description: "Your browser does not support speech recognition. Use Chrome / Edge, or type the order below.",
        variant: "destructive",
      });
      return;
    }
    try {
      const rec = new SR();
      rec.lang = language;
      rec.interimResults = true;
      rec.continuous = true;
      let finalText = "";
      rec.onresult = (e) => {
        let interim = "";
        const results = e.results;
        for (let i = 0; i < results.length; i++) {
          const alt = results[i]?.[0];
          if (!alt) continue;
          if (alt.isFinal) finalText += alt.transcript + " ";
          else interim += alt.transcript;
        }
        setTranscript((finalText + interim).trim());
      };
      rec.onerror = (ev) => {
        const err = ev.error ?? "unknown";
        if (err !== "no-speech" && err !== "aborted") {
          toast({ title: "Mic error", description: err, variant: "destructive" });
        }
      };
      rec.onend = () => setRecording(false);
      recognizerRef.current = rec;
      rec.start();
      setRecording(true);
      setTranscript("");
      setParsed(null);
    } catch (e) {
      toast({ title: "Could not start mic", description: (e as Error).message, variant: "destructive" });
    }
  };

  const stopRecording = () => {
    try { recognizerRef.current?.stop(); } catch { /* noop */ }
    setRecording(false);
  };

  const handleParse = async () => {
    const text = transcript.trim();
    if (!text) {
      toast({ title: "Nothing to parse", description: "Speak or type the order first.", variant: "destructive" });
      return;
    }
    setParsing(true);
    try {
      const res = await apiPost<VoiceParseResponse>(
        `/restaurants/${restaurantId}/voice-orders/parse`,
        { transcript: text, language, tableId: defaultTableId },
      );
      setParsed(res);
      setEditableItems(res.items);
      setTableId(res.tableId ?? defaultTableId);
    } catch (e) {
      const err = e as Error & { data?: { error?: string; code?: string } };
      toast({
        title: "Voice parsing failed",
        description: err.data?.error ?? err.message,
        variant: "destructive",
      });
    } finally {
      setParsing(false);
    }
  };

  const updateQty = (idx: number, delta: number) => {
    setEditableItems((p) => p.map((it, i) => i === idx
      ? { ...it, quantity: Math.max(1, Math.min(50, it.quantity + delta)) }
      : it));
  };
  const setItemId = (idx: number, id: number | null) => {
    setEditableItems((p) => p.map((it, i) => i === idx
      ? { ...it, menuItemId: id, confidence: id ? 1 : 0 }
      : it));
  };
  const removeItem = (idx: number) => {
    setEditableItems((p) => p.filter((_, i) => i !== idx));
  };

  const validItems = editableItems.filter((it) => it.menuItemId != null);

  const handleConfirm = async () => {
    if (validItems.length === 0) {
      toast({ title: "No items", description: "Resolve at least one item before sending.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm({
        tableId,
        items: validItems.map((it) => ({
          menuItemId: it.menuItemId as number,
          quantity: it.quantity,
          notes: it.notes ?? undefined,
        })),
        notes: parsed?.notes ?? undefined,
      });
      onClose();
    } catch (e) {
      toast({ title: "Could not create order", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Mic className="w-4 h-4 text-primary" /> Voice order
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-2">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={recording}
              className="h-9 px-2 rounded-md border border-border bg-background text-sm"
            >
              {LANG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Button
              size="sm"
              variant={recording ? "destructive" : "default"}
              onClick={recording ? stopRecording : startRecording}
              disabled={parsing || submitting}
            >
              {recording ? <><MicOff className="w-3.5 h-3.5 mr-1.5" />Stop</> : <><Mic className="w-3.5 h-3.5 mr-1.5" />Push to talk</>}
            </Button>
            {!SR && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                Browser mic unavailable — type below
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Transcript</label>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={3}
              placeholder='e.g. "table 5 par do butter naan, ek paneer tikka, teen lassi"'
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm resize-none"
            />
            <Button size="sm" onClick={handleParse} disabled={parsing || recording || !transcript.trim()}>
              {parsing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Parse with AI
            </Button>
          </div>

          {parsed && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground">Table</label>
                <select
                  value={tableId == null ? "" : String(tableId)}
                  onChange={(e) => setTableId(e.target.value === "" ? null : Number(e.target.value))}
                  className="h-8 px-2 rounded-md border border-border bg-background text-sm flex-1"
                >
                  <option value="">— No table —</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>Table {t.tableNumber}</option>
                  ))}
                </select>
              </div>

              {editableItems.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No items extracted. Adjust the transcript and try again.</p>
              )}

              {editableItems.map((it, idx) => {
                const lowConf = (it.confidence ?? 0) < 0.7;
                return (
                  <div key={idx} className={cn(
                    "rounded-lg border p-3 space-y-2",
                    lowConf ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20" : "border-border",
                  )}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground truncate">
                        Heard: <span className="text-foreground italic">{it.nameGuess}</span>
                      </span>
                      {lowConf && (
                        <span className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="w-3 h-3" /> Confirm match
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={it.menuItemId == null ? "" : String(it.menuItemId)}
                        onChange={(e) => setItemId(idx, e.target.value === "" ? null : Number(e.target.value))}
                        className="h-8 px-2 rounded-md border border-border bg-background text-sm flex-1 min-w-0"
                      >
                        <option value="">— Pick item —</option>
                        {menuItems.map((m) => (
                          <option key={m.id} value={m.id}>{m.name} (₹{m.price})</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => updateQty(idx, -1)}>
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-6 text-center text-sm font-medium">{it.quantity}</span>
                        <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => updateQty(idx, 1)}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => removeItem(idx)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    {it.notes && (
                      <Input
                        value={it.notes}
                        onChange={(e) => setEditableItems((p) => p.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))}
                        className="h-8 text-xs"
                        placeholder="Note"
                      />
                    )}
                  </div>
                );
              })}

              {parsed.unresolved.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs space-y-1">
                  <p className="font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Couldn’t match these
                  </p>
                  {parsed.unresolved.map((u, i) => (
                    <p key={i} className="text-amber-700 dark:text-amber-300">
                      {u.quantity}× {u.nameGuess}{u.notes ? ` — ${u.notes}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleConfirm}
            disabled={!parsed || validItems.length === 0 || submitting}
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
            Create order ({validItems.length})
          </Button>
        </div>
      </div>
    </div>
  );
}
