import { useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  usePrinters, useCreatePrinter, useUpdatePrinter, useDeletePrinter,
  useTestPrintPrinter, useSetDefaultPrinter,
  usePrintJobs, useRetryPrintJob, useCancelPrintJob, useReprintJob,
  useKitchens, useRestaurantBranches, PRINTER_ROLE_LABEL, PRINTER_CONNECTION_LABEL,
  type PrinterRecord, type PrinterRole, type PrinterConnection, type PrinterPaperSize,
  type PrintJobRecord,
} from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Plus, Pencil, Trash2, X, Printer, Star, StarOff, RefreshCw,
  CheckCircle2, AlertCircle, Clock, Bluetooth, Usb, Wifi, MonitorSmartphone,
  Play, Ban, RotateCcw, History,
} from "lucide-react";

interface PrinterForm {
  name: string;
  role: PrinterRole;
  connectionType: PrinterConnection;
  paperSize: PrinterPaperSize;
  branchId: number | null;
  kitchenId: number | null;
  autoPrint: boolean;
  enabled: boolean;
  isDefault: boolean;
  copies: number;
  charactersPerLine: number;
  feedLines: number;
  cutPaper: boolean;
  cashDrawerKick: boolean;
  buzzer: boolean;
  // connection-specific
  btAddress: string;
  btName: string;
  usbVid: string;
  usbPid: string;
  lanHost: string;
  lanPort: string;
}

const EMPTY: PrinterForm = {
  name: "", role: "bill", connectionType: "bluetooth", paperSize: "80mm",
  branchId: null, kitchenId: null,
  autoPrint: false, enabled: true, isDefault: false,
  copies: 1, charactersPerLine: 48, feedLines: 3,
  cutPaper: true, cashDrawerKick: false, buzzer: false,
  btAddress: "", btName: "", usbVid: "", usbPid: "", lanHost: "", lanPort: "9100",
};

const CONN_ICON = {
  bluetooth: Bluetooth, usb: Usb, lan: Wifi, browser: MonitorSmartphone,
} as const;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-green-100 text-green-700" },
  test_passed: { label: "Test OK", cls: "bg-green-100 text-green-700" },
  disconnected: { label: "Disconnected", cls: "bg-gray-100 text-gray-600" },
  offline: { label: "Offline", cls: "bg-gray-100 text-gray-600" },
  permission_required: { label: "Permission needed", cls: "bg-amber-100 text-amber-700" },
  test_failed: { label: "Test failed", cls: "bg-red-100 text-red-700" },
  unknown: { label: "Unknown", cls: "bg-gray-100 text-gray-500" },
};

const JOB_STATUS_BADGE: Record<string, string> = {
  queued: "bg-blue-100 text-blue-700",
  printing: "bg-indigo-100 text-indigo-700",
  printed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  retrying: "bg-amber-100 text-amber-700",
  cancelled: "bg-gray-100 text-gray-600",
};

export default function SettingsPrintersPage() {
  const { user } = useAuth();
  const canWrite = !!user && (user.isSuperAdmin || user.role === "owner" || user.role === "manager");

  const printersQ = usePrinters();
  const { data: kitchens = [] } = useKitchens();
  const { data: branches = [] } = useRestaurantBranches();
  const create = useCreatePrinter();
  const update = useUpdatePrinter();
  const del = useDeletePrinter();
  const testPrint = useTestPrintPrinter();
  const setDefault = useSetDefaultPrinter();
  const { toast } = useToast();

  const [tab, setTab] = useState<"list" | "history">("list");
  const [filterRole, setFilterRole] = useState<PrinterRole | "">("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PrinterRecord | null>(null);
  const [form, setForm] = useState<PrinterForm>(EMPTY);

  const printers = printersQ.data ?? [];
  const filtered = useMemo(() =>
    printers.filter(p => !filterRole || p.role === filterRole), [printers, filterRole]);

  function openCreate() {
    setEditing(null); setForm(EMPTY); setShowModal(true);
  }
  function openEdit(p: PrinterRecord) {
    setEditing(p);
    setForm({
      name: p.name, role: p.role, connectionType: p.connectionType, paperSize: p.paperSize,
      branchId: p.branchId, kitchenId: p.kitchenId,
      autoPrint: p.autoPrint, enabled: p.enabled, isDefault: p.isDefault,
      copies: p.copies, charactersPerLine: p.charactersPerLine, feedLines: p.feedLines,
      cutPaper: p.cutPaper, cashDrawerKick: p.cashDrawerKick, buzzer: p.buzzer,
      btAddress: String(p.connection?.address ?? ""),
      btName: String(p.connection?.deviceName ?? ""),
      usbVid: String(p.connection?.vendorId ?? ""),
      usbPid: String(p.connection?.productId ?? ""),
      lanHost: String(p.connection?.host ?? ""),
      lanPort: String(p.connection?.port ?? 9100),
    });
    setShowModal(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const connection: Record<string, unknown> =
      form.connectionType === "bluetooth" ? { address: form.btAddress, deviceName: form.btName } :
      form.connectionType === "usb" ? { vendorId: form.usbVid, productId: form.usbPid } :
      form.connectionType === "lan" ? { host: form.lanHost, port: Number(form.lanPort) || 9100 } :
      {};
    const data: Partial<PrinterRecord> = {
      name: form.name.trim(),
      role: form.role,
      connectionType: form.connectionType,
      paperSize: form.paperSize,
      branchId: form.branchId,
      kitchenId: form.kitchenId,
      autoPrint: form.autoPrint,
      enabled: form.enabled,
      isDefault: form.isDefault,
      copies: form.copies,
      charactersPerLine: form.charactersPerLine,
      feedLines: form.feedLines,
      cutPaper: form.cutPaper,
      cashDrawerKick: form.cashDrawerKick,
      buzzer: form.buzzer,
      connection,
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...data });
        toast({ title: "Printer updated" });
      } else {
        await create.mutateAsync(data);
        toast({ title: "Printer added" });
      }
      setShowModal(false);
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function handleTest(p: PrinterRecord) {
    try {
      await testPrint.mutateAsync(p.id);
      toast({ title: "Test print queued", description: `Sent to ${p.name}` });
    } catch (err) {
      toast({ title: "Couldn't queue test print", description: (err as Error).message, variant: "destructive" });
    }
  }
  async function handleSetDefault(p: PrinterRecord) {
    try {
      await setDefault.mutateAsync(p.id);
      toast({ title: `${p.name} set as default for ${PRINTER_ROLE_LABEL[p.role]}` });
    } catch (err) {
      toast({ title: "Couldn't set default", description: (err as Error).message, variant: "destructive" });
    }
  }
  async function handleDelete(p: PrinterRecord) {
    if (!confirm(`Remove printer "${p.name}"?`)) return;
    try {
      await del.mutateAsync(p.id);
      toast({ title: "Printer removed" });
    } catch (err) {
      toast({ title: "Couldn't remove", description: (err as Error).message, variant: "destructive" });
    }
  }

  return (
    <Layout>
      <PageHeader
        title="Printers"
        description="Configure Bluetooth, USB and network thermal printers for bills, KOTs and tokens."
        actions={
          canWrite ? (
            <Button onClick={openCreate} data-testid="button-add-printer">
              <Plus className="h-4 w-4 mr-2" />Add printer
            </Button>
          ) : null
        }
      />

      <div className="flex items-center gap-2 mt-4 mb-4 border-b">
        <button
          className={cn("px-4 py-2 text-sm border-b-2 -mb-px",
            tab === "list" ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground")}
          onClick={() => setTab("list")}
        >
          Configured printers
        </button>
        <button
          className={cn("px-4 py-2 text-sm border-b-2 -mb-px",
            tab === "history" ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground")}
          onClick={() => setTab("history")}
        >
          <History className="inline h-4 w-4 mr-1" />Print history
        </button>
      </div>

      {tab === "list" ? (
        <>
          <div className="flex items-center gap-2 mb-3 text-sm">
            <Label className="text-xs text-muted-foreground">Role:</Label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={filterRole}
              onChange={e => setFilterRole(e.target.value as PrinterRole | "")}
            >
              <option value="">All</option>
              {(Object.keys(PRINTER_ROLE_LABEL) as PrinterRole[]).map(r => (
                <option key={r} value={r}>{PRINTER_ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>

          {printersQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="border rounded-lg p-8 text-center bg-muted/30">
              <Printer className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm">No printers configured yet.</p>
              {canWrite && (
                <Button className="mt-3" onClick={openCreate}>Add your first printer</Button>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(p => {
                const Icon = CONN_ICON[p.connectionType];
                const status = STATUS_BADGE[p.status] ?? STATUS_BADGE.unknown!;
                const kitchen = kitchens.find(k => k.id === p.kitchenId);
                return (
                  <div key={p.id} className="border rounded-lg p-4 bg-card flex flex-col gap-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium leading-tight">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {PRINTER_CONNECTION_LABEL[p.connectionType]} · {p.paperSize}
                          </p>
                        </div>
                      </div>
                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full", status.cls)}>
                        {status.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 text-[11px] mt-1">
                      <span className="bg-secondary px-2 py-0.5 rounded">
                        {PRINTER_ROLE_LABEL[p.role]}
                      </span>
                      {p.isDefault && (
                        <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded flex items-center gap-1">
                          <Star className="h-3 w-3" />Default
                        </span>
                      )}
                      {p.autoPrint && (
                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Auto-print</span>
                      )}
                      {!p.enabled && (
                        <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded">Disabled</span>
                      )}
                      {kitchen && (
                        <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{kitchen.name}</span>
                      )}
                    </div>
                    {p.lastTestError && (
                      <p className="text-[11px] text-red-600 truncate" title={p.lastTestError}>
                        <AlertCircle className="inline h-3 w-3 mr-1" />{p.lastTestError}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-1 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => handleTest(p)} disabled={!p.enabled}>
                        <Play className="h-3 w-3 mr-1" />Test
                      </Button>
                      {canWrite && (
                        <>
                          {!p.isDefault && p.enabled && (
                            <Button size="sm" variant="ghost" onClick={() => handleSetDefault(p)}>
                              <StarOff className="h-3 w-3 mr-1" />Set default
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                            <Pencil className="h-3 w-3 mr-1" />Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleDelete(p)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <PrintHistory />
      )}

      {showModal && (
        <PrinterFormModal
          form={form}
          setForm={setForm}
          editing={editing}
          kitchens={kitchens}
          branches={branches}
          onSave={save}
          onClose={() => setShowModal(false)}
          saving={create.isPending || update.isPending}
        />
      )}
    </Layout>
  );
}

function PrinterFormModal({
  form, setForm, editing, kitchens, branches, onSave, onClose, saving,
}: {
  form: PrinterForm;
  setForm: (f: PrinterForm) => void;
  editing: PrinterRecord | null;
  kitchens: Array<{ id: number; name: string }>;
  branches: Array<{ id: number; name: string }>;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  // Branch picker is searchable when the restaurant has more than a handful
  // of outlets — for smaller chains a plain dropdown is faster.
  const [branchSearch, setBranchSearch] = useState("");
  const branchOptions = useMemo(
    () => branches.filter(b => !branchSearch || b.name.toLowerCase().includes(branchSearch.toLowerCase())),
    [branches, branchSearch],
  );
  function patch(p: Partial<PrinterForm>) { setForm({ ...form, ...p }); }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-card">
          <h2 className="font-semibold">{editing ? "Edit printer" : "Add printer"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Display name</Label>
            <Input value={form.name} onChange={e => patch({ name: e.target.value })} placeholder="Counter Bill Printer" />
          </div>
          <div>
            <Label>Role</Label>
            <select
              className="w-full border rounded px-2 py-2 text-sm"
              value={form.role}
              onChange={e => patch({ role: e.target.value as PrinterRole })}
            >
              {(Object.keys(PRINTER_ROLE_LABEL) as PrinterRole[]).map(r => (
                <option key={r} value={r}>{PRINTER_ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Connection</Label>
            <select
              className="w-full border rounded px-2 py-2 text-sm"
              value={form.connectionType}
              onChange={e => patch({ connectionType: e.target.value as PrinterConnection })}
            >
              {(Object.keys(PRINTER_CONNECTION_LABEL) as PrinterConnection[]).map(c => (
                <option key={c} value={c}>{PRINTER_CONNECTION_LABEL[c]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Paper size</Label>
            <select
              className="w-full border rounded px-2 py-2 text-sm"
              value={form.paperSize}
              onChange={e => {
                const ps = e.target.value as PrinterPaperSize;
                patch({ paperSize: ps, charactersPerLine: ps === "58mm" ? 32 : 48 });
              }}
            >
              <option value="80mm">80mm (48 cols)</option>
              <option value="58mm">58mm (32 cols)</option>
            </select>
          </div>
          <div>
            <Label>Kitchen station (KOT only)</Label>
            <select
              className="w-full border rounded px-2 py-2 text-sm"
              value={form.kitchenId ?? ""}
              onChange={e => patch({ kitchenId: e.target.value ? Number(e.target.value) : null })}
              disabled={form.role !== "kot" && form.role !== "kitchen" && form.role !== "bar"}
            >
              <option value="">— Any —</option>
              {kitchens.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label>Outlet / branch</Label>
            {branches.length > 6 && (
              <Input
                placeholder="Search outlets…"
                value={branchSearch}
                onChange={e => setBranchSearch(e.target.value)}
                className="mb-2"
              />
            )}
            <select
              className="w-full border rounded px-2 py-2 text-sm"
              value={form.branchId ?? ""}
              onChange={e => patch({ branchId: e.target.value ? Number(e.target.value) : null })}
              data-testid="select-printer-branch"
            >
              <option value="">— Shared across all outlets —</option>
              {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Assign to a specific outlet so KOTs/bills from that branch only route here.
              Leave unset to make this a restaurant-wide default.
            </p>
          </div>

          {form.connectionType === "bluetooth" && (
            <>
              <div>
                <Label>Bluetooth address (MAC)</Label>
                <Input value={form.btAddress} onChange={e => patch({ btAddress: e.target.value })} placeholder="00:11:22:33:44:55" />
              </div>
              <div>
                <Label>Device name (optional)</Label>
                <Input value={form.btName} onChange={e => patch({ btName: e.target.value })} />
              </div>
            </>
          )}
          {form.connectionType === "usb" && (
            <>
              <div>
                <Label>USB Vendor ID</Label>
                <Input value={form.usbVid} onChange={e => patch({ usbVid: e.target.value })} placeholder="0x04b8" />
              </div>
              <div>
                <Label>USB Product ID</Label>
                <Input value={form.usbPid} onChange={e => patch({ usbPid: e.target.value })} placeholder="0x0202" />
              </div>
            </>
          )}
          {form.connectionType === "lan" && (
            <>
              <div>
                <Label>Host / IP</Label>
                <Input value={form.lanHost} onChange={e => patch({ lanHost: e.target.value })} placeholder="192.168.1.50" />
              </div>
              <div>
                <Label>Port</Label>
                <Input value={form.lanPort} onChange={e => patch({ lanPort: e.target.value })} placeholder="9100" />
              </div>
            </>
          )}

          <div>
            <Label>Copies</Label>
            <Input type="number" min={1} max={10} value={form.copies}
              onChange={e => patch({ copies: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
          </div>
          <div>
            <Label>Characters per line</Label>
            <Input type="number" min={16} max={96} value={form.charactersPerLine}
              onChange={e => patch({ charactersPerLine: Number(e.target.value) || 48 })} />
          </div>
          <div>
            <Label>Feed lines after print</Label>
            <Input type="number" min={0} max={10} value={form.feedLines}
              onChange={e => patch({ feedLines: Math.max(0, Number(e.target.value) || 0) })} />
          </div>

          <div className="sm:col-span-2 grid grid-cols-2 gap-2 mt-2">
            <Checkbox label="Cut paper" checked={form.cutPaper} onChange={v => patch({ cutPaper: v })} />
            <Checkbox label="Open cash drawer" checked={form.cashDrawerKick} onChange={v => patch({ cashDrawerKick: v })} />
            <Checkbox label="Buzzer" checked={form.buzzer} onChange={v => patch({ buzzer: v })} />
            <Checkbox label="Auto-print on event" checked={form.autoPrint} onChange={v => patch({ autoPrint: v })} />
            <Checkbox label="Enabled" checked={form.enabled} onChange={v => patch({ enabled: v })} />
            <Checkbox label="Set as default for role" checked={form.isDefault} onChange={v => patch({ isDefault: v })} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t sticky bottom-0 bg-card">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function PrintHistory() {
  const jobsQ = usePrintJobs({ limit: 200 });
  const printersQ = usePrinters();
  const retry = useRetryPrintJob();
  const cancel = useCancelPrintJob();
  const reprint = useReprintJob();
  const { toast } = useToast();

  const printers = printersQ.data ?? [];
  const printerName = (id: number | null) =>
    id ? (printers.find(p => p.id === id)?.name ?? `#${id}`) : "—";

  const jobs = jobsQ.data ?? [];
  if (jobsQ.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (jobs.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center bg-muted/30">
        <Clock className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm">No print jobs yet.</p>
      </div>
    );
  }
  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2">Time</th>
            <th className="text-left px-3 py-2">Type</th>
            <th className="text-left px-3 py-2">Printer</th>
            <th className="text-left px-3 py-2">Ref</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Retries</th>
            <th className="text-right px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j: PrintJobRecord) => (
            <tr key={j.id} className="border-t hover:bg-muted/20">
              <td className="px-3 py-2 text-xs">{new Date(j.createdAt).toLocaleString()}</td>
              <td className="px-3 py-2">{j.printType}</td>
              <td className="px-3 py-2">{printerName(j.printerId)}</td>
              <td className="px-3 py-2 text-xs">
                {j.invoiceNumber || j.kotNumber || (j.orderId ? `Order #${j.orderId}` : "—")}
              </td>
              <td className="px-3 py-2">
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full", JOB_STATUS_BADGE[j.status])}>
                  {j.status}
                </span>
                {j.error && (
                  <span className="block text-[10px] text-red-600 mt-0.5 truncate max-w-[220px]" title={j.error}>
                    {j.error}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-xs">{j.retryCount}/{j.maxRetries}</td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  {(j.status === "failed" || j.status === "retrying") && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      await retry.mutateAsync(j.id);
                      toast({ title: "Retry queued" });
                    }}>
                      <RotateCcw className="h-3 w-3 mr-1" />Retry
                    </Button>
                  )}
                  {(j.status === "printed" || j.status === "failed") && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      await reprint.mutateAsync(j.id);
                      toast({ title: "Reprint queued" });
                    }}>
                      <RefreshCw className="h-3 w-3 mr-1" />Reprint
                    </Button>
                  )}
                  {(j.status === "queued" || j.status === "retrying") && (
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => {
                      await cancel.mutateAsync(j.id);
                      toast({ title: "Cancelled" });
                    }}>
                      <Ban className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
