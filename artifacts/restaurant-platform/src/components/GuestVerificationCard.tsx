import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAcceptGuestVerification, useRejectGuestVerification } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { differenceInSeconds, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Check, X, Clock, AlertTriangle, MapPin } from "lucide-react";
import type { GuestVerification } from "@/lib/types";

function waitTime(iso: string): string {
  const seconds = differenceInSeconds(new Date(), parseISO(iso));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ${seconds % 60}s`;
}

function urgencyClass(iso: string): string {
  const seconds = differenceInSeconds(new Date(), parseISO(iso));
  if (seconds >= 300) return "ring-2 ring-red-400 animate-pulse"; // escalation
  if (seconds >= 120) return "ring-2 ring-amber-400"; // re-ping
  return "ring-1 ring-yellow-300";
}

interface Props {
  v: GuestVerification;
  tableLabel?: string;
  /** When true, render the compact inline variant (Requests page list). */
  compact?: boolean;
}

export function GuestVerificationCard({ v, tableLabel, compact }: Props) {
  const accept = useAcceptGuestVerification();
  const reject = useRejectGuestVerification();
  const { toast } = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("Guest not present");

  const busy = accept.isPending || reject.isPending;

  async function onAccept() {
    try {
      await accept.mutateAsync(v.orderId);
      toast({ title: `Accepted — order #${v.orderNumber} fired to kitchen` });
    } catch {
      toast({ title: "Could not accept", variant: "destructive" });
    }
  }
  async function onReject() {
    try {
      await reject.mutateAsync({ orderId: v.orderId, reason });
      toast({ title: `Order #${v.orderNumber} cancelled` });
      setRejectOpen(false);
    } catch {
      toast({ title: "Could not reject", variant: "destructive" });
    }
  }

  return (
    <>
      <div
        className={cn(
          "rounded-xl bg-yellow-50 border-2 border-yellow-300 p-4 transition-all",
          urgencyClass(v.heldAt),
          compact && "p-3",
        )}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-yellow-200 text-yellow-800 flex-shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-yellow-900">
                {tableLabel ? `Table ${tableLabel}` : v.tableId ? `Table ${v.tableId}` : "Order"}
              </p>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-200 text-yellow-900 border border-yellow-400">
                Guest verification needed
              </span>
              <span className="text-xs text-yellow-800 font-mono">#{v.orderNumber}</span>
            </div>
            <p className="text-sm text-yellow-900 mt-1">
              QR order placed without staff opening the table — verify a guest is present before firing to kitchen.
            </p>
            <div className="flex items-center gap-3 mt-2 text-xs text-yellow-800">
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> waiting {waitTime(v.heldAt)}</span>
              {v.customerName && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {v.customerName}</span>}
              <span>₹{Number(v.totalAmount).toLocaleString()}</span>
              <span>{v.items.length} {v.items.length === 1 ? "item" : "items"}</span>
            </div>
            {!compact && v.items.length > 0 && (
              <ul className="mt-2 text-xs text-yellow-900 space-y-0.5 list-disc list-inside">
                {v.items.slice(0, 6).map((it, idx) => (
                  <li key={idx}>
                    {it.quantity}× {it.name}
                    {it.notes && <span className="text-yellow-700"> — {it.notes}</span>}
                  </li>
                ))}
                {v.items.length > 6 && <li className="text-yellow-700">… and {v.items.length - 6} more</li>}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button size="sm" disabled={busy} onClick={onAccept} className="gap-1.5 bg-green-600 hover:bg-green-700">
              <Check className="w-3.5 h-3.5" /> Accept
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejectOpen(true)} className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50">
              <X className="w-3.5 h-3.5" /> Reject
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject order #{v.orderNumber}?</DialogTitle>
            <DialogDescription>
              This cancels the order, voids the held kitchen tickets and frees the table. Use this when no guest is present at the table.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason</label>
            <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={onReject} disabled={busy}>Reject order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
