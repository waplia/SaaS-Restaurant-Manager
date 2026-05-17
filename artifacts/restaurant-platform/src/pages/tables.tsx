import { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useFloorTables, useUpdateTable, useCreateTable, useGetTableQr, useRestaurantInfo,
  useReservations, useCreateReservation, useUpdateReservation, useDeleteReservation,
  useMergeTables, useSplitOrderToTable, useOrders, useOrderDetail,
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Users, QrCode, Download, X, Printer, LayoutGrid, Move, Merge, CalendarDays, Calendar, Pencil, Trash2, ChevronRight, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { FloorTable, Reservation, CreateReservationInput } from "@/lib/types";
import { format, formatDistanceToNow, parseISO, isWithinInterval, addMinutes, isPast } from "date-fns";

const TABLE_STATUS: Record<string, { label: string; bg: string; border: string; text: string; dot: string }> = {
  free: { label: "Free", bg: "bg-green-100", border: "border-green-400", text: "text-green-800", dot: "bg-green-500" },
  occupied: { label: "Occupied", bg: "bg-orange-100", border: "border-orange-400", text: "text-orange-800", dot: "bg-orange-500" },
  reserved: { label: "Reserved", bg: "bg-blue-100", border: "border-blue-400", text: "text-blue-800", dot: "bg-blue-500" },
  cleaning: { label: "Cleaning", bg: "bg-gray-100", border: "border-gray-400", text: "text-gray-600", dot: "bg-gray-400" },
  dirty: { label: "Dirty", bg: "bg-red-100", border: "border-red-400", text: "text-red-700", dot: "bg-red-500" },
};

const UNKNOWN_STATUS = { label: "Unknown", bg: "bg-muted", border: "border-border", text: "text-muted-foreground", dot: "bg-muted-foreground" };

const KL_COLORS = {
  primaryOrange: "#FF6B1A",
  deepOrange: "#E85A0C",
  charcoal: "#111827",
  warmWhite: "#FFF8F1",
  lightBg: "#FFFDF9",
  muted: "#6B7280",
  faintOrange: "#FFE5D2",
} as const;

const KL_TAGLINE = "Smart QR Menu for Modern Restaurants";

const QR_PDF_ICONS: Record<"menu" | "order" | "waiter" | "review", string> = {
  menu: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V2"/><path d="M6 11v11"/><path d="M19 2c-2.5 0-4 2.5-4 5v5a2 2 0 0 0 2 2h2v8"/></svg>`,
  order: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.2"/><circle cx="18" cy="20" r="1.2"/><path d="M2 3h2.5l2.6 12.2a1.8 1.8 0 0 0 1.8 1.4h9.5a1.8 1.8 0 0 0 1.75-1.35L21.5 7H6"/></svg>`,
  waiter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  review: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2.5 14.95 8.5 21.5 9.5 16.75 14.15 17.9 20.7 12 17.6 6.1 20.7 7.25 14.15 2.5 9.5 9.05 8.5"/></svg>`,
};

async function svgStringToPngDataUrl(svg: string, pixelSize: number): Promise<string> {
  return new Promise(resolve => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = pixelSize;
        c.height = pixelSize;
        const ctx = c.getContext("2d");
        if (!ctx) { resolve(""); return; }
        ctx.clearRect(0, 0, pixelSize, pixelSize);
        ctx.drawImage(img, 0, 0, pixelSize, pixelSize);
        resolve(c.toDataURL("image/png"));
      } catch {
        resolve("");
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(""); };
    img.src = url;
  });
}

async function loadImageToPngDataUrl(src: string, maxPx = 256): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || maxPx, img.naturalHeight || maxPx));
        const w = Math.max(1, Math.round((img.naturalWidth || maxPx) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || maxPx) * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) { resolve(""); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}

function formatTableLabel(tableNumber: string): string {
  const trimmed = String(tableNumber ?? "").trim();
  if (/^\d+$/.test(trimmed)) return `Table ${trimmed.padStart(2, "0")}`;
  return `Table ${trimmed}`;
}

function QrModal({ table, restaurantName, restaurantId, restaurantLogoUrl, onClose }: { table: FloorTable; restaurantName: string; restaurantId: number | null; restaurantLogoUrl: string | null; onClose: () => void }) {
  const { data: qrData, isLoading } = useGetTableQr(table.id);
  const rawQrUrl = qrData?.qrUrl ?? "";
  const qrUrl = rawQrUrl.startsWith("/") ? `${window.location.origin}${rawQrUrl}` : rawQrUrl;
  const svgData = (qrData as { svgData?: string } | undefined)?.svgData ?? "";
  const svgBlob = svgData ? `data:image/svg+xml;base64,${btoa(svgData)}` : "";
  const qrImageUrl = svgBlob || (qrUrl ? `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrUrl)}&size=300x300&margin=10` : "");

  const brandingPrefKey = restaurantId != null ? `kl.qr.showBranding.${restaurantId}` : "";
  const [showBranding, setShowBranding] = useState<boolean>(() => {
    if (typeof window === "undefined" || !brandingPrefKey) return false;
    return window.localStorage.getItem(brandingPrefKey) === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined" || !brandingPrefKey) return;
    window.localStorage.setItem(brandingPrefKey, showBranding ? "1" : "0");
  }, [showBranding, brandingPrefKey]);

  function downloadQr() {
    if (!qrImageUrl) return;
    const a = document.createElement("a");
    a.href = qrImageUrl;
    a.download = `table-${table.tableNumber}-qr.png`;
    a.target = "_blank";
    a.click();
  }

  async function printQrSheet() {
    if (!qrUrl) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = 210, H = 297;

    // Background warm white
    doc.setFillColor(KL_COLORS.warmWhite);
    doc.rect(0, 0, W, H, "F");

    // Subtle "K" watermarks in two corners (away from QR), faint orange.
    doc.setTextColor(KL_COLORS.faintOrange);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(220);
    doc.text("K", -8, 78, { baseline: "alphabetic" });
    doc.text("K", W - 10, H - 12, { align: "right", baseline: "alphabetic" });

    // Card frame: margin 12mm, rounded orange border
    const M = 12;
    doc.setDrawColor(KL_COLORS.primaryOrange);
    doc.setLineWidth(1.4);
    doc.roundedRect(M, M, W - 2 * M, H - 2 * M, 6, 6, "S");
    // Inner hairline accent
    doc.setDrawColor(KL_COLORS.faintOrange);
    doc.setLineWidth(0.3);
    doc.roundedRect(M + 2.2, M + 2.2, W - 2 * (M + 2.2), H - 2 * (M + 2.2), 4.5, 4.5, "S");

    let cursorY = 32;

    // Optional restaurant branding (logo + name) — subtle, above the headline
    if (showBranding && (restaurantLogoUrl || restaurantName)) {
      if (restaurantLogoUrl) {
        const logoPng = await loadImageToPngDataUrl(restaurantLogoUrl, 256);
        if (logoPng) {
          try { doc.addImage(logoPng, "PNG", W / 2 - 7, cursorY - 6, 14, 14); } catch { /* noop */ }
          cursorY += 11;
        }
      }
      if (restaurantName) {
        doc.setTextColor(KL_COLORS.muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.text(restaurantName, W / 2, cursorY, { align: "center" });
        cursorY += 8;
      }
      cursorY += 2;
    } else {
      cursorY = 42;
    }

    // Headline
    doc.setTextColor(KL_COLORS.charcoal);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(34);
    doc.text("Scan to Order", W / 2, cursorY + 8, { align: "center" });

    // Sub-headline
    doc.setTextColor(KL_COLORS.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("Your menu is one scan away.", W / 2, cursorY + 16, { align: "center" });

    // Action line with 4 small icons + labels
    const labels: Array<{ key: keyof typeof QR_PDF_ICONS; text: string }> = [
      { key: "menu", text: "Menu" },
      { key: "order", text: "Order" },
      { key: "waiter", text: "Waiter" },
      { key: "review", text: "Review" },
    ];
    const iconPngs = await Promise.all(labels.map(l => svgStringToPngDataUrl(QR_PDF_ICONS[l.key], 192)));
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(KL_COLORS.charcoal);
    const iconSize = 5; // mm
    const gap = 3; // mm between icon and label
    const sep = 7; // mm between groups
    const labelWidths = labels.map(l => doc.getTextWidth(l.text));
    const totalWidth = labels.reduce((s, _, i) => s + iconSize + gap + labelWidths[i], 0) + sep * (labels.length - 1);
    let x = (W - totalWidth) / 2;
    const rowY = cursorY + 26;
    for (let i = 0; i < labels.length; i++) {
      const png = iconPngs[i];
      if (png) {
        try { doc.addImage(png, "PNG", x, rowY - iconSize + 0.6, iconSize, iconSize); } catch { /* noop */ }
      }
      doc.text(labels[i].text, x + iconSize + gap, rowY);
      x += iconSize + gap + labelWidths[i] + sep;
    }

    // QR area — large, centered, with white card behind
    const qrSize = 110;
    const qrPadding = 6;
    const qrBoxSize = qrSize + qrPadding * 2;
    const qrBoxX = (W - qrBoxSize) / 2;
    const qrBoxY = cursorY + 36;
    doc.setFillColor("#FFFFFF");
    doc.setDrawColor(KL_COLORS.faintOrange);
    doc.setLineWidth(0.5);
    doc.roundedRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 3, 3, "FD");

    const qrSourceSvg = svgData;
    const qrPngDataUrl = qrSourceSvg
      ? await svgStringToPngDataUrl(qrSourceSvg, 1400)
      : await loadImageToPngDataUrl(
          svgBlob || `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrUrl)}&size=1200x1200&margin=20`,
          1400,
        );
    if (qrPngDataUrl) {
      try {
        doc.addImage(qrPngDataUrl, "PNG", qrBoxX + qrPadding, qrBoxY + qrPadding, qrSize, qrSize);
      } catch {
        doc.setFontSize(9);
        doc.setTextColor(KL_COLORS.muted);
        doc.text(qrUrl, W / 2, qrBoxY + qrBoxSize / 2, { align: "center", maxWidth: qrSize });
      }
    } else {
      doc.setFontSize(9);
      doc.setTextColor(KL_COLORS.muted);
      doc.text(qrUrl, W / 2, qrBoxY + qrBoxSize / 2, { align: "center", maxWidth: qrSize });
    }

    // Table number — large, prominent, under QR
    const tableLabelY = qrBoxY + qrBoxSize + 18;
    doc.setTextColor(KL_COLORS.charcoal);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(38);
    doc.text(formatTableLabel(table.tableNumber), W / 2, tableLabelY, { align: "center" });

    // Divider
    const dividerY = tableLabelY + 12;
    doc.setDrawColor(KL_COLORS.faintOrange);
    doc.setLineWidth(0.4);
    doc.line(W / 2 - 30, dividerY, W / 2 + 30, dividerY);

    // KhanaLagao wordmark + tagline + footer credit
    doc.setTextColor(KL_COLORS.primaryOrange);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("KhanaLagao", W / 2, dividerY + 11, { align: "center" });

    doc.setTextColor(KL_COLORS.charcoal);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(KL_TAGLINE, W / 2, dividerY + 18, { align: "center" });

    doc.setTextColor(KL_COLORS.muted);
    doc.setFontSize(8);
    doc.text("Powered by KhanaLagao  •  khanalagao.com", W / 2, H - M - 4, { align: "center" });

    doc.save(`table-${table.tableNumber}-qr.pdf`);
  }

  const canShowBranding = Boolean(restaurantLogoUrl || restaurantName);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Table {table.tableNumber} QR</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Generating QR…</div>
        ) : qrUrl ? (
          <>
            <div className="flex flex-col items-center mb-5">
              {svgData ? (
                <div className="w-48 h-48 rounded-xl border border-border overflow-hidden bg-white flex items-center justify-center p-2"
                  dangerouslySetInnerHTML={{ __html: svgData }} />
              ) : (
                <img src={qrImageUrl} alt={`QR Table ${table.tableNumber}`} className="w-48 h-48 rounded-xl border border-border" />
              )}
              <p className="text-xs text-muted-foreground mt-3 text-center break-all px-2">{qrUrl}</p>
            </div>
            {canShowBranding && (
              <label className="flex items-center gap-2 mb-3 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showBranding}
                  onChange={e => setShowBranding(e.target.checked)}
                  className="h-3.5 w-3.5 accent-orange-500"
                />
                Show restaurant branding on PDF
              </label>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={downloadQr}><Download className="w-4 h-4" /> Download</Button>
              <Button className="flex-1 gap-2" onClick={printQrSheet}><Printer className="w-4 h-4" /> Print PDF</Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-destructive text-center py-8">Failed to load QR code.</p>
        )}
      </div>
    </div>
  );
}

function SplitOrderModal({
  table,
  allTables,
  onClose,
}: {
  table: FloorTable;
  allTables: FloorTable[];
  onClose: () => void;
}) {
  const { data: ordersData } = useOrders({ tableId: table.id, status: "pending" });
  const { data: preparingData } = useOrders({ tableId: table.id, status: "preparing" });
  const activeOrderId = ordersData?.data?.[0]?.id ?? preparingData?.data?.[0]?.id;
  const { data: orderDetail, isLoading: detailLoading } = useOrderDetail(activeOrderId);
  const splitOrder = useSplitOrderToTable();
  const { toast } = useToast();

  const items = orderDetail?.items ?? [];
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [targetTableId, setTargetTableId] = useState<number | "">("");

  const handleConfirm = async () => {
    if (!orderDetail) { toast({ title: "No active order found on this table", variant: "destructive" }); return; }
    if (selectedItemIds.length === 0) { toast({ title: "Select at least one item to move", variant: "destructive" }); return; }
    if (!targetTableId) { toast({ title: "Select a target table", variant: "destructive" }); return; }
    if (selectedItemIds.length === items.length) { toast({ title: "Cannot move all items — use Merge instead", variant: "destructive" }); return; }
    try {
      await splitOrder.mutateAsync({ orderId: orderDetail.id, targetTableId: Number(targetTableId), itemIds: selectedItemIds });
      toast({ title: "Order split!", description: `${selectedItemIds.length} item(s) moved to Table ${allTables.find(t => t.id === Number(targetTableId))?.tableNumber}.` });
      onClose();
    } catch {
      toast({ title: "Split failed", variant: "destructive" });
    }
  };

  const toggleItem = (id: number) => setSelectedItemIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Split Order — Table {table.tableNumber}</h2>
            <p className="text-sm text-muted-foreground">Select items to move to another table</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>

        {detailLoading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading order…</p>
        ) : !activeOrderId || !orderDetail ? (
          <p className="text-sm text-muted-foreground text-center py-8">No active order on this table</p>
        ) : items.length < 2 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Need at least 2 items to split an order</p>
        ) : (
          <>
            <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Items to move</p>
              {items.map(item => (
                <label key={item.id} className={cn("flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors", selectedItemIds.includes(item.id) ? "border-primary bg-primary/5" : "border-border hover:bg-accent")}>
                  <input type="checkbox" checked={selectedItemIds.includes(item.id)} onChange={() => toggleItem(item.id)} className="accent-primary" />
                  <span className="font-medium text-sm flex-1">{item.menuItemName ?? `Item #${item.id}`}</span>
                  <span className="text-xs text-muted-foreground">{item.quantity}×</span>
                  <span className="text-xs font-medium">₹{(Number(item.unitPrice) * item.quantity).toFixed(0)}</span>
                </label>
              ))}
            </div>

            <div className="mb-5">
              <Label className="text-xs">Move to table</Label>
              <select
                className="w-full h-9 text-sm border border-input rounded-md px-2 bg-background mt-1"
                value={targetTableId}
                onChange={e => setTargetTableId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Select table…</option>
                {allTables.filter(t => t.id !== table.id).map(t => (
                  <option key={t.id} value={t.id}>Table {t.tableNumber} ({TABLE_STATUS[t.status]?.label ?? t.status})</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1 gap-2" onClick={handleConfirm} disabled={splitOrder.isPending || selectedItemIds.length === 0 || !targetTableId}>
                <Scissors className="w-4 h-4" /> Split {selectedItemIds.length > 0 ? `(${selectedItemIds.length})` : ""}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TableCard({
  table,
  reservation,
  onStatusChange,
  onQr,
  onSplit,
  mergeMode,
  mergeSelected,
  onMergeSelect,
}: {
  table: FloorTable;
  reservation?: Reservation;
  onStatusChange: (id: number, status: string) => void;
  onQr: (t: FloorTable) => void;
  onSplit: (t: FloorTable) => void;
  mergeMode: boolean;
  mergeSelected: number[];
  onMergeSelect: (id: number) => void;
}) {
  const cfg = TABLE_STATUS[table.status] ?? UNKNOWN_STATUS;
  const isMergeSelected = mergeSelected.includes(table.id);

  return (
    <div
      onClick={mergeMode ? () => onMergeSelect(table.id) : undefined}
      className={cn(
        "border-2 rounded-xl p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-default",
        mergeMode && "cursor-pointer",
        isMergeSelected && "ring-4 ring-primary ring-offset-2",
        cfg.bg, cfg.border, cfg.text,
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-bold text-lg">{table.tableNumber}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <div className={cn("w-2 h-2 rounded-full", cfg.dot)} />
            <p className="text-xs font-medium">{cfg.label}</p>
          </div>
        </div>
        {isMergeSelected && (
          <div className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">Selected</div>
        )}
      </div>
      {table.status === "reserved" && reservation ? (
        <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-2">
          <p className="text-xs font-semibold text-blue-800 truncate">{reservation.guestName}</p>
          <p className="text-xs text-blue-600">Reserved at {format(parseISO(reservation.scheduledAt), "h:mm a")}</p>
          <p className="text-xs text-blue-500">{reservation.partySize} guests</p>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-sm mb-3">
          <Users className="w-3.5 h-3.5" />
          <span>{table.capacity} seats</span>
        </div>
      )}
      {table.status !== "reserved" && reservation && ["pending", "confirmed"].includes(reservation.status) && (() => {
        const start = parseISO(reservation.scheduledAt);
        const minsAway = Math.round((start.getTime() - Date.now()) / 60_000);
        if (minsAway < -10 || minsAway > 180) return null;
        return (
          <div className="mb-2 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 text-[11px] text-amber-800">
            <span className="font-semibold">⏰ Reserved at {format(start, "h:mm a")}</span>
            <span className="ml-1 text-amber-700">· {reservation.guestName} · {reservation.partySize}p</span>
          </div>
        );
      })()}

      {!mergeMode && (
        <>
          <button onClick={() => onQr(table)}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-lg border border-current/30 hover:bg-white/40 transition mb-2">
            <QrCode className="w-3.5 h-3.5" /> QR Code
          </button>
          {table.status === "occupied" && (
            <Button size="sm" variant="outline" className="w-full text-xs mb-1 gap-1" onClick={() => onSplit(table)}>
              <Scissors className="w-3 h-3" /> Split Order
            </Button>
          )}
          {table.status !== "free" && (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onStatusChange(table.id, "free")}>Mark Free</Button>
              {table.status === "occupied" && (
                <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onStatusChange(table.id, "dirty")}>Dirty</Button>
              )}
            </div>
          )}
          {table.status === "free" && (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onStatusChange(table.id, "occupied")}>Seat</Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onStatusChange(table.id, "reserved")}>Reserve</Button>
            </div>
          )}
          {table.status === "dirty" && (
            <Button size="sm" variant="outline" className="w-full text-xs mt-1" onClick={() => onStatusChange(table.id, "cleaning")}>Mark Cleaning</Button>
          )}
          {table.status === "cleaning" && (
            <Button size="sm" variant="outline" className="w-full text-xs mt-1" onClick={() => onStatusChange(table.id, "free")}>Mark Clean</Button>
          )}
        </>
      )}
    </div>
  );
}

function FloorPlanTable({
  table,
  onDrop,
  onQr,
  mergeMode,
  mergeSelected,
  onMergeSelect,
}: {
  table: FloorTable;
  onDrop: (id: number, x: number, y: number) => void;
  onQr: (t: FloorTable) => void;
  mergeMode: boolean;
  mergeSelected: number[];
  onMergeSelect: (id: number) => void;
}) {
  const cfg = TABLE_STATUS[table.status] ?? UNKNOWN_STATUS;
  const isMergeSelected = mergeSelected.includes(table.id);
  const dragOffset = useRef({ dx: 0, dy: 0 });
  const elemRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (mergeMode) { onMergeSelect(table.id); return; }
    e.preventDefault();
    const rect = elemRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };

    const onMove = (ev: MouseEvent) => {
      const parent = elemRef.current?.parentElement?.getBoundingClientRect();
      if (!parent || !elemRef.current) return;
      const x = Math.max(0, Math.min(ev.clientX - parent.left - dragOffset.current.dx, parent.width - 100));
      const y = Math.max(0, Math.min(ev.clientY - parent.top - dragOffset.current.dy, parent.height - 80));
      elemRef.current.style.left = `${x}px`;
      elemRef.current.style.top = `${y}px`;
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const parent = elemRef.current?.parentElement?.getBoundingClientRect();
      if (!parent) return;
      const x = Math.max(0, Math.min(ev.clientX - parent.left - dragOffset.current.dx, parent.width - 100));
      const y = Math.max(0, Math.min(ev.clientY - parent.top - dragOffset.current.dy, parent.height - 80));
      onDrop(table.id, Math.round(x), Math.round(y));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [mergeMode, onMergeSelect, onDrop, table.id]);

  return (
    <div
      ref={elemRef}
      onMouseDown={handleMouseDown}
      style={{ left: table.positionX || 20, top: table.positionY || 20 }}
      className={cn(
        "absolute w-24 select-none transition-shadow",
        mergeMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        isMergeSelected && "ring-4 ring-primary ring-offset-1 rounded-xl",
      )}
    >
      <div className={cn("border-2 rounded-xl p-2 text-center shadow-sm hover:shadow-md transition-shadow", cfg.bg, cfg.border, cfg.text)}>
        <div className="flex items-center justify-center gap-1 mb-1">
          <div className={cn("w-2 h-2 rounded-full", cfg.dot)} />
          {isMergeSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
        </div>
        <p className="font-bold text-sm">{table.tableNumber}</p>
        <p className="text-xs text-muted-foreground">{table.capacity}p</p>
        <p className={cn("text-xs font-medium mt-0.5", cfg.text)}>{cfg.label}</p>
        {!mergeMode && (
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => onQr(table)}
            className="mt-1 text-xs underline text-muted-foreground hover:text-foreground transition-colors"
          >
            QR
          </button>
        )}
      </div>
    </div>
  );
}

function ReservationPanel({
  tables,
  onClose,
}: {
  tables: FloorTable[];
  onClose: () => void;
}) {
  const { data: reservations = [], refetch } = useReservations();
  const createReservation = useCreateReservation();
  const updateReservation = useUpdateReservation();
  const deleteReservation = useDeleteReservation();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CreateReservationInput>({
    guestName: "", partySize: 2, scheduledAt: "", tableId: undefined, guestPhone: "", notes: "",
  });

  const now = new Date();
  const upcoming = [...(reservations as Reservation[])]
    .filter(r => r.status !== "cancelled")
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const handleCreate = async () => {
    if (!form.guestName || !form.scheduledAt) {
      toast({ title: "Guest name and time required", variant: "destructive" });
      return;
    }
    try {
      if (editingId) {
        await updateReservation.mutateAsync({ id: editingId, ...form });
        toast({ title: "Reservation updated" });
      } else {
        await createReservation.mutateAsync(form);
        toast({ title: "Reservation added" });
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ guestName: "", partySize: 2, scheduledAt: "", tableId: undefined, guestPhone: "", notes: "" });
      void refetch();
    } catch {
      toast({ title: "Failed to save reservation", variant: "destructive" });
    }
  };

  const handleEdit = (r: Reservation) => {
    setEditingId(r.id);
    setForm({
      guestName: r.guestName,
      partySize: r.partySize,
      scheduledAt: r.scheduledAt ? r.scheduledAt.slice(0, 16) : "",
      tableId: r.tableId ?? undefined,
      guestPhone: r.guestPhone ?? "",
      notes: r.notes ?? "",
    });
    setShowForm(true);
  };

  const handleCancel = async (id: number) => {
    try {
      await updateReservation.mutateAsync({ id, status: "cancelled" });
      toast({ title: "Reservation cancelled" });
      void refetch();
    } catch {
      toast({ title: "Failed to cancel", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteReservation.mutateAsync(id);
      toast({ title: "Reservation deleted" });
      void refetch();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  function getArrivalLabel(scheduledAt: string) {
    const t = parseISO(scheduledAt);
    if (isPast(t)) return { text: formatDistanceToNow(t, { addSuffix: true }), past: true };
    return { text: formatDistanceToNow(t, { addSuffix: true }), past: false };
  }

  function isSoon(scheduledAt: string) {
    const t = parseISO(scheduledAt);
    return isWithinInterval(now, { start: t, end: addMinutes(t, 15) }) || isWithinInterval(now, { start: addMinutes(t, -15), end: t });
  }

  return (
    <div className="w-80 border-l border-border bg-card flex flex-col h-full shrink-0">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-foreground">Reservations</h3>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {upcoming.length === 0 && !showForm && (
          <div className="text-center py-8 text-muted-foreground text-sm">No upcoming reservations</div>
        )}

        {upcoming.map((r: Reservation) => {
          const arr = getArrivalLabel(r.scheduledAt);
          const soon = isSoon(r.scheduledAt);
          const tbl = tables.find(t => t.id === r.tableId);
          return (
            <div key={r.id} className={cn("border rounded-xl p-3 space-y-1.5 text-sm transition-all", soon ? "border-orange-300 bg-orange-50" : "border-border bg-background")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">{r.guestName}</p>
                  <p className="text-xs text-muted-foreground">{r.partySize} guests{tbl ? ` · Table ${tbl.tableNumber}` : ""}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => handleEdit(r)} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDelete(r.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{format(parseISO(r.scheduledAt), "MMM d, h:mm a")}</span>
              </div>
              <div className={cn("text-xs font-medium", arr.past ? "text-red-600" : soon ? "text-orange-600" : "text-muted-foreground")}>
                {arr.text}
                {soon && !arr.past && " · Arriving soon!"}
              </div>
              {r.guestPhone && <p className="text-xs text-muted-foreground">{r.guestPhone}</p>}
              {r.notes && <p className="text-xs text-muted-foreground italic">{r.notes}</p>}
              {!arr.past && (
                <button onClick={() => handleCancel(r.id)} className="text-xs text-destructive hover:underline">Cancel reservation</button>
              )}
            </div>
          );
        })}
      </div>

      {showForm ? (
        <div className="border-t border-border p-4 space-y-3">
          <h4 className="font-medium text-sm">{editingId ? "Edit Reservation" : "New Reservation"}</h4>
          <div>
            <Label className="text-xs">Guest Name *</Label>
            <Input className="h-8 text-sm" value={form.guestName} onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))} placeholder="Guest name" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs">Party Size</Label>
              <Input className="h-8 text-sm" type="number" min="1" value={form.partySize} onChange={e => setForm(f => ({ ...f, partySize: Number(e.target.value) }))} />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Table</Label>
              <select className="w-full h-8 text-sm border border-input rounded-md px-2 bg-background"
                value={form.tableId ?? ""}
                onChange={e => setForm(f => ({ ...f, tableId: e.target.value ? Number(e.target.value) : undefined }))}>
                <option value="">Any</option>
                {tables.filter(t => t.status === "free" || t.status === "reserved").map(t => (
                  <option key={t.id} value={t.id}>Table {t.tableNumber}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Date & Time *</Label>
            <Input className="h-8 text-sm" type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input className="h-8 text-sm" value={form.guestPhone ?? ""} onChange={e => setForm(f => ({ ...f, guestPhone: e.target.value }))} placeholder="+91 ..." />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Input className="h-8 text-sm" value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Special requests..." />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</Button>
            <Button size="sm" className="flex-1" onClick={handleCreate} disabled={createReservation.isPending || updateReservation.isPending}>
              {editingId ? "Update" : "Add"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t border-border p-4">
          <Button className="w-full gap-2" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" /> Add Reservation
          </Button>
        </div>
      )}
    </div>
  );
}

export default function TablesPage() {
  const { data: tables = [] } = useFloorTables();
  const { data: restaurantInfo } = useRestaurantInfo();
  const { data: reservations = [] } = useReservations();
  const updateTable = useUpdateTable();
  const createTable = useCreateTable();
  const mergeTables = useMergeTables();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<"grid" | "floorplan">("grid");
  const [showAdd, setShowAdd] = useState(false);
  const [newTable, setNewTable] = useState({ tableNumber: "", capacity: "4" });
  const [qrTable, setQrTable] = useState<FloorTable | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<number[]>([]);
  const [showReservations, setShowReservations] = useState(false);
  const [splitTable, setSplitTable] = useState<FloorTable | null>(null);

  const free = tables.filter((t: FloorTable) => t.status === "free").length;
  const occupied = tables.filter((t: FloorTable) => t.status === "occupied").length;
  const reserved = tables.filter((t: FloorTable) => t.status === "reserved").length;
  const totalCovers = tables.filter((t: FloorTable) => t.status === "occupied").reduce((s: number, t: FloorTable) => s + t.capacity, 0);

  const handleStatusChange = async (id: number, status: string) => {
    if (status === "occupied") {
      const now = new Date();
      const conflict = (reservations as Reservation[]).find(r => {
        if (r.tableId !== id) return false;
        if (!["pending", "confirmed"].includes(r.status)) return false;
        const start = parseISO(r.scheduledAt);
        const end = addMinutes(start, r.durationMinutes ?? 90);
        return start.getTime() <= now.getTime() + 2 * 60 * 60_000 && end.getTime() > now.getTime();
      });
      if (conflict) {
        const when = format(parseISO(conflict.scheduledAt), "h:mm a");
        const ok = window.confirm(
          `⚠ This table has a ${conflict.status} reservation for ${conflict.guestName} (party of ${conflict.partySize}) at ${when}.\n\nSeat anyway?`,
        );
        if (!ok) return;
      }
    }
    try {
      await updateTable.mutateAsync({ id, status });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const handleAddTable = async () => {
    if (!newTable.tableNumber) return;
    try {
      await createTable.mutateAsync({ tableNumber: newTable.tableNumber, capacity: Number(newTable.capacity) });
      toast({ title: "Table added!" });
      setShowAdd(false);
      setNewTable({ tableNumber: "", capacity: "4" });
    } catch {
      toast({ title: "Failed to add table", variant: "destructive" });
    }
  };

  const handleDrop = useCallback(async (id: number, x: number, y: number) => {
    try {
      await updateTable.mutateAsync({ id, positionX: x, positionY: y } as Parameters<typeof updateTable.mutateAsync>[0]);
    } catch {
    }
  }, [updateTable]);

  const handleMergeSelect = (id: number) => {
    setMergeSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const handleMergeConfirm = async () => {
    if (mergeSelected.length !== 2) {
      toast({ title: "Select exactly 2 tables to merge", variant: "destructive" });
      return;
    }
    try {
      await mergeTables.mutateAsync({ sourceTableId: mergeSelected[0], targetTableId: mergeSelected[1] });
      toast({ title: "Tables merged!", description: "Orders have been combined." });
      setMergeMode(false);
      setMergeSelected([]);
    } catch {
      toast({ title: "Merge failed", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (reservations.length === 0) return;
    const check = () => {
      const now = new Date();
      (reservations as Reservation[]).forEach(r => {
        if (r.status === "cancelled" || !r.tableId) return;
        const scheduled = parseISO(r.scheduledAt);
        const window15 = isWithinInterval(now, { start: addMinutes(scheduled, -15), end: scheduled });
        if (window15) {
          const tbl = (tables as FloorTable[]).find(t => t.id === r.tableId);
          if (tbl && tbl.status === "free") {
            void updateTable.mutateAsync({ id: r.tableId, status: "reserved" });
          }
        }
      });
    };
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [reservations, tables, updateTable]);

  const upcomingCount = (reservations as Reservation[]).filter(r => r.status !== "cancelled" && !isPast(parseISO(r.scheduledAt))).length;

  return (
    <Layout>
      <PageHeader
        title="Table Management"
        subtitle={`${tables.length} tables · ${occupied} occupied (${totalCovers} covers) · ${reserved} reserved · ${free} free`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button onClick={() => setViewMode("grid")}
                className={cn("px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors", viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
                <LayoutGrid className="w-3.5 h-3.5" /> Grid
              </button>
              <button onClick={() => setViewMode("floorplan")}
                className={cn("px-3 py-1.5 text-sm flex items-center gap-1.5 border-l border-border transition-colors", viewMode === "floorplan" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
                <Move className="w-3.5 h-3.5" /> Floor Plan
              </button>
            </div>
            <Button
              variant={mergeMode ? "default" : "outline"}
              size="sm"
              onClick={() => { setMergeMode(v => !v); setMergeSelected([]); }}
            >
              <Merge className="w-4 h-4 mr-1.5" />
              {mergeMode ? "Cancel Merge" : "Merge"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="relative"
              onClick={() => setShowReservations(v => !v)}
            >
              <CalendarDays className="w-4 h-4 mr-1.5" /> Reservations
              {upcomingCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">{upcomingCount}</span>
              )}
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Table
            </Button>
          </div>
        }
      />

      {mergeMode && (
        <div className="mx-6 mt-0 mb-0 bg-primary/10 border border-primary/30 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Merge className="w-4 h-4 text-primary" />
            <span className="font-medium text-primary">Merge Mode</span>
            <span className="text-muted-foreground">
              {mergeSelected.length === 0 ? "Select the source table" : mergeSelected.length === 1 ? "Now select the target table" : "Ready to merge"}
            </span>
            {mergeSelected.length > 0 && (
              <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                {mergeSelected.map(id => (tables as FloorTable[]).find(t => t.id === id)?.tableNumber ?? id).join(" → ")}
              </span>
            )}
          </div>
          <Button size="sm" disabled={mergeSelected.length !== 2 || mergeTables.isPending} onClick={handleMergeConfirm}>
            <ChevronRight className="w-4 h-4 mr-1" /> Merge Tables
          </Button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          {viewMode === "grid" ? (
            <>
              <div className="flex gap-4 mb-6">
                {[
                  { label: "Free", count: free, cls: "bg-green-100 text-green-700" },
                  { label: "Occupied", count: occupied, cls: "bg-orange-100 text-orange-700" },
                  { label: "Reserved", count: reserved, cls: "bg-blue-100 text-blue-700" },
                  { label: "Covers", count: totalCovers, cls: "bg-muted text-muted-foreground" },
                ].map(s => (
                  <div key={s.label} className={cn("px-4 py-2 rounded-lg text-sm font-medium", s.cls)}>
                    {s.count} {s.label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {(tables as FloorTable[]).map(table => (
                  <TableCard
                    key={table.id}
                    table={table}
                    reservation={(reservations as Reservation[]).find(r => r.tableId === table.id && r.status !== "cancelled")}
                    onStatusChange={handleStatusChange}
                    onQr={setQrTable}
                    onSplit={setSplitTable}
                    mergeMode={mergeMode}
                    mergeSelected={mergeSelected}
                    onMergeSelect={handleMergeSelect}
                  />
                ))}
              </div>
              {tables.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                  <p className="text-lg font-medium mb-1">No tables yet</p>
                  <p className="text-sm mb-3">Add your first table to get started</p>
                  <a href="/onboarding" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    Open the setup wizard →
                  </a>
                </div>
              )}
            </>
          ) : (
            <div className="relative w-full bg-muted/30 rounded-2xl border-2 border-dashed border-border/60 overflow-hidden" style={{ minHeight: "600px" }}>
              <div className="absolute top-3 left-3 text-xs text-muted-foreground">Drag tables to position them on the floor plan</div>
              {(tables as FloorTable[]).map(table => (
                <FloorPlanTable
                  key={table.id}
                  table={table}
                  onDrop={handleDrop}
                  onQr={setQrTable}
                  mergeMode={mergeMode}
                  mergeSelected={mergeSelected}
                  onMergeSelect={handleMergeSelect}
                />
              ))}
              {tables.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                  Add tables to see them on the floor plan
                </div>
              )}
            </div>
          )}
        </div>

        {showReservations && (
          <ReservationPanel tables={tables as FloorTable[]} onClose={() => setShowReservations(false)} />
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-semibold mb-4">Add Table</h2>
            <div className="space-y-4">
              <div>
                <Label>Table Number / Name</Label>
                <Input placeholder="e.g. T11" value={newTable.tableNumber} onChange={e => setNewTable(p => ({ ...p, tableNumber: e.target.value }))} />
              </div>
              <div>
                <Label>Capacity (seats)</Label>
                <Input type="number" min="1" value={newTable.capacity} onChange={e => setNewTable(p => ({ ...p, capacity: e.target.value }))} />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAddTable} disabled={createTable.isPending}>Add</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {qrTable && (
        <QrModal
          table={qrTable}
          restaurantName={restaurantInfo?.name ?? "Restaurant"}
          restaurantId={restaurantInfo?.id ?? null}
          restaurantLogoUrl={restaurantInfo?.logoUrl ?? null}
          onClose={() => setQrTable(null)}
        />
      )}

      {splitTable && (
        <SplitOrderModal table={splitTable} allTables={tables as FloorTable[]} onClose={() => setSplitTable(null)} />
      )}
    </Layout>
  );
}
