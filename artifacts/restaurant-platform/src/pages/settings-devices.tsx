import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useDevices, useDevice, useDeviceLogs, useCreateDevice, useUpdateDevice, useDeleteDevice,
  useTestPrintDevice, useUpdateDeviceStations, useSyncDevice, useDeviceHeartbeat,
  useKitchens, useStaff, DEVICE_TYPE_LABELS, PRINTER_TYPES, OFFLINE_CAPABLE_TYPES,
  type DeviceType, type DeviceStatus, type DeviceRecord,
} from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Plus, Pencil, Trash2, X, Printer, Monitor, Tablet, ScanLine, Smartphone,
  CircuitBoard, Hash, ShoppingCart, Fingerprint, RefreshCw, AlertCircle,
  CheckCircle2, Clock, Activity, ChefHat, Copy,
} from "lucide-react";

const STATUS_BADGE: Record<DeviceStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  online: { label: "Online", cls: "bg-green-100 text-green-700", icon: CheckCircle2 },
  offline: { label: "Offline", cls: "bg-gray-100 text-gray-600", icon: Clock },
  error: { label: "Error", cls: "bg-red-100 text-red-700", icon: AlertCircle },
  pairing: { label: "Pairing", cls: "bg-amber-100 text-amber-700", icon: Activity },
};

const TYPE_ICONS: Record<DeviceType, typeof Printer> = {
  thermal_printer: Printer,
  kot_printer: Printer,
  kitchen_display: Monitor,
  customer_display: Monitor,
  barcode_scanner: ScanLine,
  qr_scanner: ScanLine,
  cash_drawer: ShoppingCart,
  biometric: Fingerprint,
  android_pos: Smartphone,
  tablet_menu: Tablet,
  self_kiosk: CircuitBoard,
  token_display: Hash,
};

interface DeviceForm {
  name: string;
  type: DeviceType;
  kitchenId: number | null;
  paperSize: string;
  assignedUserId: number | null;
  isHandheld: boolean;
}

const EMPTY_FORM: DeviceForm = { name: "", type: "kot_printer", kitchenId: null, paperSize: "", assignedUserId: null, isHandheld: false };

const HANDHELD_CAPABLE_TYPES: DeviceType[] = ["android_pos", "tablet_menu"];

export default function SettingsDevicesPage() {
  const { user } = useAuth();
  const canWrite = !!user && (user.isSuperAdmin || user.role === "owner" || user.role === "manager");
  const { data: devices = [], isLoading, refetch } = useDevices();
  const { data: kitchens = [] } = useKitchens();
  const { data: waiterStaff = [] } = useStaff("waiter");
  const create = useCreateDevice();
  const update = useUpdateDevice();
  const del = useDeleteDevice();
  const testPrint = useTestPrintDevice();
  const sync = useSyncDevice();
  const heartbeat = useDeviceHeartbeat();
  const { toast } = useToast();

  const [filterType, setFilterType] = useState<DeviceType | "">("");
  const [filterStatus, setFilterStatus] = useState<DeviceStatus | "">("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DeviceRecord | null>(null);
  const [form, setForm] = useState<DeviceForm>(EMPTY_FORM);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pairingToken, setPairingToken] = useState<string | null>(null);

  const filtered = useMemo(() => devices.filter(d =>
    (!filterType || d.type === filterType) &&
    (!filterStatus || d.status === filterStatus),
  ), [devices, filterType, filterStatus]);

  const summary = useMemo(() => ({
    total: devices.length,
    online: devices.filter(d => d.status === "online").length,
    offline: devices.filter(d => d.status === "offline").length,
    error: devices.filter(d => d.status === "error").length,
  }), [devices]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPairingToken(null);
    setShowModal(true);
  };

  const openEdit = (d: DeviceRecord) => {
    setEditing(d);
    setForm({
      name: d.name,
      type: d.type,
      kitchenId: d.kitchenId,
      paperSize: d.paperSize ?? "",
      assignedUserId: d.assignedUserId ?? null,
      isHandheld: !!d.isHandheld,
    });
    setPairingToken(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          name: form.name.trim(),
          kitchenId: form.kitchenId,
          paperSize: form.paperSize.trim() || null,
          assignedUserId: form.assignedUserId,
          isHandheld: form.isHandheld,
        });
        toast({ title: "Device updated" });
        setShowModal(false);
      } else {
        const created = await create.mutateAsync({
          name: form.name.trim(),
          type: form.type,
          kitchenId: form.kitchenId,
          paperSize: form.paperSize.trim() || undefined,
          assignedUserId: form.assignedUserId,
          isHandheld: form.isHandheld,
        });
        setPairingToken(created.pairingToken ?? created.registrationToken ?? null);
        toast({ title: "Device registered", description: "Share the pairing token with the device agent to bring it online." });
      }
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  const handleDelete = async (d: DeviceRecord) => {
    if (!confirm(`Remove device "${d.name}"? It will stop receiving print jobs and sync.`)) return;
    try {
      await del.mutateAsync(d.id);
      toast({ title: "Device removed" });
      if (selectedId === d.id) setSelectedId(null);
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  const handleTestPrint = async (d: DeviceRecord) => {
    try {
      const r = await testPrint.mutateAsync(d.id);
      toast({
        title: r.success ? "Test print queued" : "Could not reach device",
        description: r.success ? "Watch the device logs for a print event." : `Status: ${d.status}. Try a heartbeat first.`,
        variant: r.success ? "default" : "destructive",
      });
    } catch (e) {
      toast({ title: "Test print failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  return (
    <Layout>
      <PageHeader
        title="Devices & Hardware"
        subtitle="Register and monitor printers, displays, scanners, and POS terminals across your outlets. Configure where Kitchen Order Tickets and receipts route."
        actions={canWrite ? <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" /> Register Device</Button> : null}
      />

      <div className="p-6 max-w-6xl">
        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <SummaryTile label="Total devices" value={summary.total} icon={CircuitBoard} />
          <SummaryTile label="Online" value={summary.online} icon={CheckCircle2} tone="green" />
          <SummaryTile label="Offline" value={summary.offline} icon={Clock} tone="gray" />
          <SummaryTile label="Errors" value={summary.error} icon={AlertCircle} tone="red" />
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select className="border border-input rounded-md px-2 py-1.5 text-sm bg-background" value={filterType} onChange={e => setFilterType(e.target.value as DeviceType | "")}>
            <option value="">All types</option>
            {Object.entries(DEVICE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="border border-input rounded-md px-2 py-1.5 text-sm bg-background" value={filterStatus} onChange={e => setFilterStatus(e.target.value as DeviceStatus | "")}>
            <option value="">All statuses</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="error">Error</option>
            <option value="pairing">Pairing</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh</Button>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-sm text-muted-foreground">Loading devices…</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Device</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Type</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Kitchen / Station</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Last seen</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => {
                  const Icon = TYPE_ICONS[d.type] ?? CircuitBoard;
                  const badge = STATUS_BADGE[d.status];
                  const BIcon = badge.icon;
                  const kitchen = kitchens.find(k => k.id === d.kitchenId);
                  return (
                    <tr key={d.id} className={cn("border-b border-border last:border-0 hover:bg-muted/10 cursor-pointer", selectedId === d.id && "bg-muted/30")}
                        onClick={() => setSelectedId(d.id)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{d.name}</span>
                          {d.consecutiveErrors > 0 && (
                            <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">{d.consecutiveErrors} err</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{DEVICE_TYPE_LABELS[d.type]}</td>
                      <td className="px-4 py-3 text-sm">
                        {kitchen ? (
                          <span className="inline-flex items-center gap-1"><ChefHat className="w-3 h-3" />{kitchen.name}</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full", badge.cls)}>
                          <BIcon className="w-3 h-3" /> {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "Never"}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {canWrite && PRINTER_TYPES.includes(d.type) && (
                            <Button size="sm" variant="ghost" onClick={() => handleTestPrint(d)} disabled={testPrint.isPending}>
                              <Printer className="w-3.5 h-3.5 mr-1" /> Test
                            </Button>
                          )}
                          {canWrite && OFFLINE_CAPABLE_TYPES.includes(d.type) && (
                            <Button size="sm" variant="ghost" onClick={() => sync.mutate(d.id)} disabled={sync.isPending}>
                              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Sync
                            </Button>
                          )}
                          {canWrite && (
                            <Button size="sm" variant="ghost" onClick={() => heartbeat.mutate(d.id)} title="Mark online (simulate heartbeat)">
                              <Activity className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {canWrite && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(d)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {canWrite && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(d)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-muted-foreground">
                      <CircuitBoard className="w-10 h-10 mx-auto mb-3 opacity-20" />
                      <p className="text-sm">No devices registered{filterType || filterStatus ? " for this filter" : ""}</p>
                      {canWrite && <p className="text-xs mt-1">Register a printer, KDS, scanner, or POS terminal to get started.</p>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {selectedId != null && (
          <DeviceDetailPanel deviceId={selectedId} onClose={() => setSelectedId(null)} canWrite={canWrite} />
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
              <h2 className="text-lg font-semibold">{editing ? "Edit Device" : "Register Device"}</h2>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            {pairingToken ? (
              <div className="p-6 space-y-3">
                <p className="text-sm">Device created. Share this pairing token with the device agent (it appears once).</p>
                <div className="bg-muted rounded-md p-3 font-mono text-xs break-all flex items-start justify-between gap-2">
                  <span>{pairingToken}</span>
                  <button onClick={() => { navigator.clipboard.writeText(pairingToken); toast({ title: "Copied" }); }} className="text-muted-foreground hover:text-foreground shrink-0">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">The agent must POST to <code>/api/restaurants/&lt;id&gt;/devices/&lt;id&gt;/heartbeat</code> with header <code>X-Device-Token</code> set to this value.</p>
                <div className="flex justify-end pt-2">
                  <Button onClick={() => { setShowModal(false); setPairingToken(null); }}>Done</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-6 space-y-3">
                  <div>
                    <Label>Name <span className="text-destructive">*</span></Label>
                    <Input placeholder="e.g. Grill Printer #1" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Type</Label>
                    <select
                      className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background"
                      value={form.type}
                      disabled={!!editing}
                      onChange={e => setForm(p => ({ ...p, type: e.target.value as DeviceType }))}
                    >
                      {Object.entries(DEVICE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    {editing && <p className="text-[10px] text-muted-foreground mt-1">Type cannot be changed after registration.</p>}
                  </div>
                  {(PRINTER_TYPES.includes(form.type) || form.type === "kitchen_display") && (
                    <div>
                      <Label>Kitchen / Station</Label>
                      <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.kitchenId ?? ""} onChange={e => setForm(p => ({ ...p, kitchenId: e.target.value ? Number(e.target.value) : null }))}>
                        <option value="">— None —</option>
                        {kitchens.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                      </select>
                    </div>
                  )}
                  {PRINTER_TYPES.includes(form.type) && (
                    <div>
                      <Label>Paper Size</Label>
                      <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.paperSize} onChange={e => setForm(p => ({ ...p, paperSize: e.target.value }))}>
                        <option value="">— Default —</option>
                        <option value="thermal-58mm">Thermal 58mm</option>
                        <option value="thermal-80mm">Thermal 80mm</option>
                        <option value="a5">A5</option>
                        <option value="a4">A4</option>
                      </select>
                    </div>
                  )}
                  {HANDHELD_CAPABLE_TYPES.includes(form.type) && (
                    <>
                      <div className="border-t border-border pt-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={form.isHandheld}
                            onChange={e => setForm(p => ({ ...p, isHandheld: e.target.checked }))}
                          />
                          <span>Use as <strong>Handheld POS</strong> (tableside ordering)</span>
                        </label>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Waiters sign in on this device to take orders at the table.
                        </p>
                      </div>
                      <div>
                        <Label>Assigned Waiter</Label>
                        <select
                          className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background"
                          value={form.assignedUserId ?? ""}
                          onChange={e => setForm(p => ({ ...p, assignedUserId: e.target.value ? Number(e.target.value) : null }))}
                        >
                          <option value="">— Unassigned —</option>
                          {waiterStaff.map(s => <option key={s.id} value={s.id}>{s.name ?? s.email}</option>)}
                        </select>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Sales from this device count towards the assigned waiter in reports.
                        </p>
                      </div>
                    </>
                  )}
                </div>
                <div className="px-6 pb-5 flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
                  <Button className="flex-1" onClick={handleSave} disabled={create.isPending || update.isPending}>
                    {editing ? "Update" : "Register"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}

function SummaryTile({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof CheckCircle2; tone?: "green" | "red" | "gray" }) {
  const colorCls = tone === "green" ? "text-green-600" : tone === "red" ? "text-red-600" : tone === "gray" ? "text-muted-foreground" : "text-primary";
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center bg-muted", colorCls)}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
    </div>
  );
}

function DeviceDetailPanel({ deviceId, onClose, canWrite }: { deviceId: number; onClose: () => void; canWrite: boolean }) {
  const { data: device } = useDevice(deviceId);
  const { data: logs = [] } = useDeviceLogs(deviceId, 50);
  const { data: kitchens = [] } = useKitchens();
  const updateStations = useUpdateDeviceStations();
  const { toast } = useToast();
  const [stationIds, setStationIds] = useState<number[] | null>(null);

  const currentStations = device?.stations.map(s => s.kitchenId) ?? [];
  const ids = stationIds ?? currentStations;

  const toggleKitchen = (kid: number) => {
    setStationIds(prev => {
      const base = prev ?? currentStations;
      return base.includes(kid) ? base.filter(x => x !== kid) : [...base, kid];
    });
  };

  const saveStations = async () => {
    if (stationIds == null) return;
    try {
      await updateStations.mutateAsync({ id: deviceId, kitchenIds: stationIds });
      toast({ title: "Station mappings updated" });
      setStationIds(null);
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  };

  if (!device) return null;
  const isPrinterOrKDS = PRINTER_TYPES.includes(device.type) || device.type === "kitchen_display";

  return (
    <div className="mt-6 bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/30">
        <div>
          <h3 className="font-semibold text-sm">{device.name}</h3>
          <p className="text-xs text-muted-foreground">{DEVICE_TYPE_LABELS[device.type]} · ID #{device.id}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
        {/* Station mappings */}
        {isPrinterOrKDS && (
          <div className="p-5">
            <h4 className="font-medium text-sm mb-1">Kitchen station mappings</h4>
            <p className="text-xs text-muted-foreground mb-3">Tickets for these kitchens will be routed to this device.</p>
            <div className="space-y-1.5">
              {kitchens.map(k => (
                <label key={k.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canWrite}
                    checked={ids.includes(k.id)}
                    onChange={() => toggleKitchen(k.id)}
                  />
                  <ChefHat className="w-3.5 h-3.5 text-muted-foreground" />
                  {k.name}
                </label>
              ))}
              {kitchens.length === 0 && <p className="text-xs text-muted-foreground">No kitchens defined yet.</p>}
            </div>
            {canWrite && stationIds != null && (
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={saveStations} disabled={updateStations.isPending}>Save mappings</Button>
                <Button size="sm" variant="ghost" onClick={() => setStationIds(null)}>Reset</Button>
              </div>
            )}
          </div>
        )}

        {/* Logs */}
        <div className="p-5">
          <h4 className="font-medium text-sm mb-1">Recent activity</h4>
          <p className="text-xs text-muted-foreground mb-3">Last 50 events for this device.</p>
          <div className="space-y-1.5 max-h-72 overflow-auto pr-1">
            {logs.map(l => (
              <div key={l.id} className="text-xs border border-border rounded-md p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono uppercase text-[10px] tracking-wide text-muted-foreground">{l.eventType}</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
                </div>
                {l.message && <div className="mt-1">{l.message}</div>}
              </div>
            ))}
            {logs.length === 0 && <p className="text-xs text-muted-foreground">No events yet.</p>}
          </div>
        </div>
      </div>

      {device.sync && OFFLINE_CAPABLE_TYPES.includes(device.type) && (
        <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground flex items-center gap-4">
          <span><strong>Last sync:</strong> {device.sync.lastSyncAt ? new Date(device.sync.lastSyncAt).toLocaleString() : "Never"}</span>
          <span><strong>Pending:</strong> {device.sync.pendingCount} item(s)</span>
        </div>
      )}
    </div>
  );
}
