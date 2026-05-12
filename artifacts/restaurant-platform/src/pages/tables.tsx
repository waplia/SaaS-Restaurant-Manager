import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { useFloorTables, useUpdateTable, useCreateTable } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { FloorTable } from "@/lib/types";

const TABLE_STATUS: Record<string, { label: string; color: string }> = {
  free: { label: "Free", color: "bg-green-100 border-green-300 text-green-800" },
  occupied: { label: "Occupied", color: "bg-orange-100 border-orange-300 text-orange-800" },
  reserved: { label: "Reserved", color: "bg-blue-100 border-blue-300 text-blue-800" },
  cleaning: { label: "Cleaning", color: "bg-gray-100 border-gray-300 text-gray-600" },
};

function TableCard({ table, onStatusChange }: { table: FloorTable; onStatusChange: (id: number, status: string) => void }) {
  const cfg = TABLE_STATUS[table.status] ?? TABLE_STATUS.free;
  return (
    <div className={cn("border-2 rounded-xl p-4 cursor-pointer hover:shadow-md transition-all", cfg.color)}>
      <div className="flex items-start justify-between mb-2">
        <p className="font-bold text-lg">{table.tableNumber}</p>
        <div className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", cfg.color)}>{cfg.label}</div>
      </div>
      <div className="flex items-center gap-1 text-sm mb-3">
        <Users className="w-3.5 h-3.5" />
        <span>{table.capacity} seats</span>
      </div>
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
  const updateTable = useUpdateTable();
  const createTable = useCreateTable();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [newTable, setNewTable] = useState({ tableNumber: "", capacity: "4" });

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
            <TableCard key={table.id} table={table} onStatusChange={handleStatusChange} />
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
    </Layout>
  );
}
