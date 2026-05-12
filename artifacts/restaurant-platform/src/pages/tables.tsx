import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useFloorTables, useUpdateTable, useCreateTable, useGetTableQr, useRestaurantInfo } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Users, QrCode, Download, X, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { FloorTable } from "@/lib/types";

const TABLE_STATUS: Record<string, { label: string; color: string }> = {
  free: { label: "Free", color: "bg-green-100 border-green-300 text-green-800" },
  occupied: { label: "Occupied", color: "bg-orange-100 border-orange-300 text-orange-800" },
  reserved: { label: "Reserved", color: "bg-blue-100 border-blue-300 text-blue-800" },
  cleaning: { label: "Cleaning", color: "bg-gray-100 border-gray-300 text-gray-600" },
};

function QrModal({ table, restaurantName, onClose }: { table: FloorTable; restaurantName: string; onClose: () => void }) {
  const { data: qrData, isLoading } = useGetTableQr(table.id);
  const rawQrUrl = qrData?.qrUrl ?? "";
  const qrUrl = rawQrUrl.startsWith("/")
    ? `${window.location.origin}${rawQrUrl}`
    : rawQrUrl;
  const qrImageUrl = qrUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrUrl)}&size=300x300&margin=10`
    : "";

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

    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text(restaurantName, 105, 30, { align: "center" });

    doc.setFontSize(16);
    doc.setFont("helvetica", "normal");
    doc.text(`Table ${table.tableNumber}`, 105, 44, { align: "center" });

    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text("Scan to order from your table", 105, 53, { align: "center" });

    const imgUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrUrl)}&size=600x600&margin=20`;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgUrl;
    await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); });

    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || 600;
      canvas.height = img.naturalHeight || 600;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      doc.addImage(dataUrl, "PNG", 55, 60, 100, 100);
    } catch {
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(qrUrl, 105, 110, { align: "center", maxWidth: 160 });
    }

    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text("Powered by TableTrack", 105, 175, { align: "center" });

    doc.save(`table-${table.tableNumber}-qr.pdf`);
  }

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
              <img
                src={qrImageUrl}
                alt={`QR for Table ${table.tableNumber}`}
                className="w-48 h-48 rounded-xl border border-border"
              />
              <p className="text-xs text-muted-foreground mt-3 text-center break-all px-2">{qrUrl}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 gap-2" onClick={downloadQr}>
                <Download className="w-4 h-4" /> Download
              </Button>
              <Button className="flex-1 gap-2" onClick={printQrSheet}>
                <Printer className="w-4 h-4" /> Print PDF
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-3">
              Customers scan this to order from Table {table.tableNumber}
            </p>
          </>
        ) : (
          <p className="text-sm text-destructive text-center py-8">Failed to load QR code.</p>
        )}
      </div>
    </div>
  );
}

function TableCard({
  table,
  onStatusChange,
  onQr,
}: {
  table: FloorTable;
  onStatusChange: (id: number, status: string) => void;
  onQr: (table: FloorTable) => void;
}) {
  const cfg = TABLE_STATUS[table.status] ?? TABLE_STATUS.free;
  return (
    <div className={cn("border-2 rounded-xl p-4 hover:shadow-md transition-all", cfg.color)}>
      <div className="flex items-start justify-between mb-2">
        <p className="font-bold text-lg">{table.tableNumber}</p>
        <div className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", cfg.color)}>{cfg.label}</div>
      </div>
      <div className="flex items-center gap-1 text-sm mb-3">
        <Users className="w-3.5 h-3.5" />
        <span>{table.capacity} seats</span>
      </div>

      <button
        onClick={() => onQr(table)}
        className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-lg border border-current/30 hover:bg-white/40 transition mb-2"
      >
        <QrCode className="w-3.5 h-3.5" /> QR Code
      </button>

      {table.status !== "free" && (
        <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => onStatusChange(table.id, "free")}>
          Mark Free
        </Button>
      )}
      {table.status === "free" && (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onStatusChange(table.id, "occupied")}>Seat</Button>
          <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onStatusChange(table.id, "reserved")}>Reserve</Button>
        </div>
      )}
    </div>
  );
}

export default function TablesPage() {
  const { data: tables = [] } = useFloorTables();
  const { data: restaurantInfo } = useRestaurantInfo();
  const updateTable = useUpdateTable();
  const createTable = useCreateTable();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [newTable, setNewTable] = useState({ tableNumber: "", capacity: "4" });
  const [qrTable, setQrTable] = useState<FloorTable | null>(null);

  const free = tables.filter((t: FloorTable) => t.status === "free").length;
  const occupied = tables.filter((t: FloorTable) => t.status === "occupied").length;
  const reserved = tables.filter((t: FloorTable) => t.status === "reserved").length;

  const handleStatusChange = async (id: number, status: string) => {
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

  return (
    <Layout>
      <PageHeader
        title="Table Management"
        subtitle={`${tables.length} tables · ${occupied} occupied · ${reserved} reserved · ${free} free`}
        actions={
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Table
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-4 mb-6">
          {[
            { label: "Free", count: free, color: "bg-green-100 text-green-700" },
            { label: "Occupied", count: occupied, color: "bg-orange-100 text-orange-700" },
            { label: "Reserved", count: reserved, color: "bg-blue-100 text-blue-700" },
          ].map(s => (
            <div key={s.label} className={cn("px-4 py-2 rounded-lg text-sm font-medium", s.color)}>
              {s.count} {s.label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {tables.map((table: FloorTable) => (
            <TableCard key={table.id} table={table} onStatusChange={handleStatusChange} onQr={setQrTable} />
          ))}
        </div>

        {tables.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-lg font-medium mb-1">No tables yet</p>
            <p className="text-sm">Add your first table to get started</p>
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-semibold mb-4">Add Table</h2>
            <div className="space-y-4">
              <div>
                <Label>Table Number</Label>
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
          onClose={() => setQrTable(null)}
        />
      )}
    </Layout>
  );
}
