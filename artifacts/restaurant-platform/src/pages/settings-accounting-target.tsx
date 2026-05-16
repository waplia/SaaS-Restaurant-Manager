import { useState, useMemo } from "react";
import { useParams, Redirect, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPut, ApiError } from "@/lib/api";
import { ArrowLeft, Plus, Trash2, Download, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

const TARGETS = ["tally", "zoho_books", "quickbooks", "busy", "marg", "vyapar", "gst", "excel", "api"] as const;
type Target = (typeof TARGETS)[number];

interface CatalogField { key: string; label: string; required: boolean; secret?: boolean; placeholder?: string; }
interface Catalog {
  target: Target;
  label: string;
  description: string;
  formats: Record<"sales" | "expense" | "purchase", string[]>;
  connectionFields: CatalogField[];
  supportsPush: boolean;
}
interface TargetDetail {
  catalog: Catalog;
  connection: {
    status: "configured" | "configuration_required" | "not_configured";
    config: Record<string, string>;
    lastTestedAt: string | null;
    lastTestResult: string | null;
  };
}

interface TaxMap { id: number; sourceCode: string; targetCode: string; label: string | null; }
interface LedgerMap { id: number; sourceLedger: string; targetLedger: string; notes: string | null; }
interface AccountMap { id: number; partyType: string; partyKey: string; targetAccount: string; notes: string | null; }
interface MappingsResponse { tax: TaxMap[]; ledger: LedgerMap[]; account: AccountMap[]; }

interface ExportRun {
  id: number; target: Target; dataset: string; format: string;
  dateFrom: string; dateTo: string;
  status: "pending" | "running" | "succeeded" | "failed" | "configuration_required";
  fileUrl: string | null; fileName: string | null; rowCount: number;
  pushMode: string; error: string | null;
  startedAt: string; finishedAt: string | null;
}

export default function AccountingTargetPage() {
  const params = useParams<{ target?: string }>();
  const target = (params.target ?? "") as Target;
  const restaurantId = useRestaurantId();

  if (!TARGETS.includes(target)) {
    return <Redirect to="/settings/accounting" />;
  }

  const { data: detail, isLoading } = useQuery({
    queryKey: ["accounting-target", restaurantId, target],
    queryFn: () => apiGet<TargetDetail>(`/restaurants/${restaurantId}/accounting/targets/${target}`),
  });

  const [tab, setTab] = useState<"connection" | "mappings" | "exports">("connection");

  return (
    <SettingsLayout activeKey={"accounting" as never} title={detail?.catalog.label ?? "Accounting"}
      subtitle={detail?.catalog.description}>
      <div className="space-y-4">
        <Link href="/settings/accounting"><a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="w-3 h-3" /> All integrations</a></Link>

        <div className="border-b border-border flex gap-1">
          {(["connection", "mappings", "exports"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {isLoading || !detail ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            {tab === "connection" && <ConnectionTab restaurantId={restaurantId} target={target} detail={detail} />}
            {tab === "mappings" && <MappingsTab restaurantId={restaurantId} target={target} />}
            {tab === "exports" && <ExportsTab restaurantId={restaurantId} target={target} catalog={detail.catalog} />}
          </>
        )}
      </div>
    </SettingsLayout>
  );
}

function StatusPill({ status }: { status: TargetDetail["connection"]["status"] }) {
  if (status === "configured") return <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-xs"><CheckCircle2 className="w-3 h-3" /> Configured</span>;
  if (status === "configuration_required") return <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 px-2 py-0.5 text-xs"><AlertTriangle className="w-3 h-3" /> Configuration required</span>;
  return <span className="inline-flex items-center gap-1 rounded bg-muted text-muted-foreground border border-border px-2 py-0.5 text-xs">Not configured</span>;
}

function ConnectionTab({ restaurantId, target, detail }: { restaurantId: number; target: Target; detail: TargetDetail }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>(detail.connection.config);

  const save = useMutation({
    mutationFn: () => apiPut<{ status: string; config: Record<string, string> }>(`/restaurants/${restaurantId}/accounting/targets/${target}/connection`, { config: form }),
    onSuccess: () => {
      toast({ title: "Connection saved" });
      qc.invalidateQueries({ queryKey: ["accounting-target", restaurantId, target] });
      qc.invalidateQueries({ queryKey: ["accounting-targets", restaurantId] });
    },
    onError: (e: unknown) => toast({ title: "Save failed", description: e instanceof ApiError ? e.message : "Could not save", variant: "destructive" }),
  });

  const test = useMutation({
    mutationFn: () => apiPost<{ status: string; message: string }>(`/restaurants/${restaurantId}/accounting/targets/${target}/test`),
    onSuccess: (data) => {
      toast({ title: "Connection test", description: data.message });
      qc.invalidateQueries({ queryKey: ["accounting-target", restaurantId, target] });
    },
  });

  if (detail.catalog.connectionFields.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-5">
        <div className="flex items-center gap-2"><StatusPill status="configured" /></div>
        <p className="text-sm text-muted-foreground mt-2">This target needs no credentials — it produces a downloadable file directly. Head to the Exports tab to generate a file.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card/40 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Connection settings</h3>
          <StatusPill status={detail.connection.status} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {detail.catalog.connectionFields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">
                {f.label}{f.required && <span className="text-red-500">*</span>}
                {f.secret && <span className="ml-1 text-[10px] text-muted-foreground">(secret)</span>}
              </Label>
              <Input
                type={f.secret ? "password" : "text"}
                value={form[f.key] ?? ""}
                placeholder={f.placeholder ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending ? "Testing…" : "Test connection"}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save connection"}</Button>
        </div>
        {detail.connection.lastTestedAt && (
          <p className="text-xs text-muted-foreground">Last tested {new Date(detail.connection.lastTestedAt).toLocaleString()} — {detail.connection.lastTestResult}</p>
        )}
      </div>

      {detail.connection.status !== "configured" && detail.catalog.connectionFields.some((f) => f.required) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs text-amber-900 dark:text-amber-100">
          <strong>Configuration required.</strong> Fill in the required credentials above before pushing to {detail.catalog.label}. You can still produce file exports via the Exports tab.
        </div>
      )}
    </div>
  );
}

function MappingsTab({ restaurantId, target }: { restaurantId: number; target: Target }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["accounting-mappings", restaurantId, target],
    queryFn: () => apiGet<MappingsResponse>(`/restaurants/${restaurantId}/accounting/targets/${target}/mappings`),
  });

  const [tax, setTax] = useState<Array<{ sourceCode: string; targetCode: string; label: string }>>([]);
  const [ledger, setLedger] = useState<Array<{ sourceLedger: string; targetLedger: string; notes: string }>>([]);
  const [account, setAccount] = useState<Array<{ partyType: string; partyKey: string; targetAccount: string; notes: string }>>([]);

  useMemo(() => {
    if (data) {
      setTax(data.tax.map((r) => ({ sourceCode: r.sourceCode, targetCode: r.targetCode, label: r.label ?? "" })));
      setLedger(data.ledger.map((r) => ({ sourceLedger: r.sourceLedger, targetLedger: r.targetLedger, notes: r.notes ?? "" })));
      setAccount(data.account.map((r) => ({ partyType: r.partyType, partyKey: r.partyKey, targetAccount: r.targetAccount, notes: r.notes ?? "" })));
    }
  }, [data]);

  const saveTax = useMutation({
    mutationFn: () => apiPut(`/restaurants/${restaurantId}/accounting/targets/${target}/mappings/tax`, { items: tax.filter((t) => t.sourceCode && t.targetCode) }),
    onSuccess: () => { toast({ title: "Tax mappings saved" }); qc.invalidateQueries({ queryKey: ["accounting-mappings", restaurantId, target] }); },
  });
  const saveLedger = useMutation({
    mutationFn: () => apiPut(`/restaurants/${restaurantId}/accounting/targets/${target}/mappings/ledger`, { items: ledger.filter((t) => t.sourceLedger && t.targetLedger) }),
    onSuccess: () => { toast({ title: "Ledger mappings saved" }); qc.invalidateQueries({ queryKey: ["accounting-mappings", restaurantId, target] }); },
  });
  const saveAccount = useMutation({
    mutationFn: () => apiPut(`/restaurants/${restaurantId}/accounting/targets/${target}/mappings/account`, { items: account.filter((t) => t.partyKey && t.targetAccount) }),
    onSuccess: () => { toast({ title: "Account mappings saved" }); qc.invalidateQueries({ queryKey: ["accounting-mappings", restaurantId, target] }); },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* Tax */}
      <Card title="Tax code mappings" subtitle="Map source GST/tax codes to your accounting system's tax codes." onSave={() => saveTax.mutate()} saving={saveTax.isPending}>
        <Table headers={["Source code", "Target code", "Label", ""]}>
          {tax.map((row, i) => (
            <tr key={i} className="border-t border-border">
              <td className="p-2"><Input value={row.sourceCode} placeholder="gst:5" onChange={(e) => updateRow(setTax, i, { sourceCode: e.target.value })} /></td>
              <td className="p-2"><Input value={row.targetCode} placeholder="GST5" onChange={(e) => updateRow(setTax, i, { targetCode: e.target.value })} /></td>
              <td className="p-2"><Input value={row.label} placeholder="Optional" onChange={(e) => updateRow(setTax, i, { label: e.target.value })} /></td>
              <td className="p-2 text-right"><Button size="icon" variant="ghost" onClick={() => removeRow(setTax, i)}><Trash2 className="w-4 h-4" /></Button></td>
            </tr>
          ))}
        </Table>
        <Button variant="outline" size="sm" onClick={() => setTax((s) => [...s, { sourceCode: "", targetCode: "", label: "" }])}><Plus className="w-3 h-3 mr-1" /> Add row</Button>
      </Card>

      {/* Ledger */}
      <Card title="Ledger mappings" subtitle="Map source ledgers (e.g. sales:dine_in) to your chart of accounts." onSave={() => saveLedger.mutate()} saving={saveLedger.isPending}>
        <Table headers={["Source ledger", "Target ledger", "Notes", ""]}>
          {ledger.map((row, i) => (
            <tr key={i} className="border-t border-border">
              <td className="p-2"><Input value={row.sourceLedger} placeholder="sales:dine_in" onChange={(e) => updateRow(setLedger, i, { sourceLedger: e.target.value })} /></td>
              <td className="p-2"><Input value={row.targetLedger} placeholder="Sales – Dine In" onChange={(e) => updateRow(setLedger, i, { targetLedger: e.target.value })} /></td>
              <td className="p-2"><Input value={row.notes} placeholder="Optional" onChange={(e) => updateRow(setLedger, i, { notes: e.target.value })} /></td>
              <td className="p-2 text-right"><Button size="icon" variant="ghost" onClick={() => removeRow(setLedger, i)}><Trash2 className="w-4 h-4" /></Button></td>
            </tr>
          ))}
        </Table>
        <Button variant="outline" size="sm" onClick={() => setLedger((s) => [...s, { sourceLedger: "", targetLedger: "", notes: "" }])}><Plus className="w-3 h-3 mr-1" /> Add row</Button>
      </Card>

      {/* Account */}
      <Card title="Party / account mappings" subtitle="Map vendors, customers or generic parties to specific accounts." onSave={() => saveAccount.mutate()} saving={saveAccount.isPending}>
        <Table headers={["Party type", "Party key", "Target account", "Notes", ""]}>
          {account.map((row, i) => (
            <tr key={i} className="border-t border-border">
              <td className="p-2"><Input value={row.partyType} placeholder="vendor / customer" onChange={(e) => updateRow(setAccount, i, { partyType: e.target.value })} /></td>
              <td className="p-2"><Input value={row.partyKey} placeholder="Acme Foods" onChange={(e) => updateRow(setAccount, i, { partyKey: e.target.value })} /></td>
              <td className="p-2"><Input value={row.targetAccount} placeholder="Sundry Creditors – Acme" onChange={(e) => updateRow(setAccount, i, { targetAccount: e.target.value })} /></td>
              <td className="p-2"><Input value={row.notes} placeholder="Optional" onChange={(e) => updateRow(setAccount, i, { notes: e.target.value })} /></td>
              <td className="p-2 text-right"><Button size="icon" variant="ghost" onClick={() => removeRow(setAccount, i)}><Trash2 className="w-4 h-4" /></Button></td>
            </tr>
          ))}
        </Table>
        <Button variant="outline" size="sm" onClick={() => setAccount((s) => [...s, { partyType: "vendor", partyKey: "", targetAccount: "", notes: "" }])}><Plus className="w-3 h-3 mr-1" /> Add row</Button>
      </Card>
    </div>
  );
}

function ExportsTab({ restaurantId, target, catalog }: { restaurantId: number; target: Target; catalog: Catalog }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const [dataset, setDataset] = useState<"sales" | "expense" | "purchase">("sales");
  const [format, setFormat] = useState<string>(catalog.formats.sales[0]!);
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);
  const [pushMode, setPushMode] = useState<"file" | "push">("file");

  const { data: runs = [] } = useQuery({
    queryKey: ["accounting-runs", restaurantId, target],
    queryFn: () => apiGet<ExportRun[]>(`/restaurants/${restaurantId}/accounting/targets/${target}/exports`),
    refetchInterval: 5000,
  });

  const trigger = useMutation({
    mutationFn: () => apiPost<ExportRun & { status: string; error: string | null }>(`/restaurants/${restaurantId}/accounting/targets/${target}/exports`, {
      dataset, format, dateFrom, dateTo, pushMode,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["accounting-runs", restaurantId, target] });
      if (res.status === "succeeded") toast({ title: "Export ready", description: `${res.rowCount} rows. ${res.fileName ?? ""}` });
      else if (res.status === "configuration_required") toast({ title: "Configuration required", description: res.error ?? "Missing credentials", variant: "destructive" });
      else toast({ title: "Export failed", description: res.error ?? "Unknown error", variant: "destructive" });
    },
    onError: (e: unknown) => toast({ title: "Export failed", description: e instanceof ApiError ? e.message : "Request failed", variant: "destructive" }),
  });

  const formatsForDataset = catalog.formats[dataset] ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card/40 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Generate export</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Dataset</Label>
            <select className="w-full rounded border border-border bg-background h-9 px-2 text-sm" value={dataset}
              onChange={(e) => { const d = e.target.value as typeof dataset; setDataset(d); setFormat(catalog.formats[d][0]!); }}>
              <option value="sales">Sales</option>
              <option value="expense">Expenses</option>
              <option value="purchase">Purchases</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Format</Label>
            <select className="w-full rounded border border-border bg-background h-9 px-2 text-sm" value={format} onChange={(e) => setFormat(e.target.value)}>
              {formatsForDataset.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Delivery</Label>
            <select className="w-full rounded border border-border bg-background h-9 px-2 text-sm" value={pushMode} onChange={(e) => setPushMode(e.target.value as "file" | "push")}>
              <option value="file">Download file</option>
              {catalog.supportsPush && <option value="push">Push to API</option>}
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => trigger.mutate()} disabled={trigger.isPending}>
            {trigger.isPending ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Run export
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/40">
        <div className="px-4 py-3 border-b border-border text-sm font-semibold">Recent runs</div>
        <Table headers={["Started", "Dataset", "Format", "Period", "Mode", "Rows", "Status", "File"]}>
          {runs.length === 0 && (
            <tr><td className="p-4 text-center text-xs text-muted-foreground" colSpan={8}>No exports yet.</td></tr>
          )}
          {runs.map((r) => (
            <tr key={r.id} className="border-t border-border text-xs">
              <td className="p-2 whitespace-nowrap">{new Date(r.startedAt).toLocaleString()}</td>
              <td className="p-2">{r.dataset}</td>
              <td className="p-2 uppercase">{r.format}</td>
              <td className="p-2 whitespace-nowrap">{r.dateFrom} → {r.dateTo}</td>
              <td className="p-2">{r.pushMode}</td>
              <td className="p-2 text-right">{r.rowCount}</td>
              <td className="p-2">
                <Badge variant={r.status === "succeeded" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>
                  {r.status.replace(/_/g, " ")}
                </Badge>
                {r.error && <div className="mt-1 text-[10px] text-destructive line-clamp-2">{r.error}</div>}
              </td>
              <td className="p-2">
                {r.fileUrl ? (
                  <a href={`/api/restaurants/${restaurantId}/storage${r.fileUrl}`} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1"><Download className="w-3 h-3" /> {r.fileName ?? "download"}</a>
                ) : "—"}
              </td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}

function Card({ title, subtitle, children, onSave, saving }: { title: string; subtitle?: string; children: React.ReactNode; onSave: () => void; saving: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <Button size="sm" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
      {children}
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground"><tr>
          {headers.map((h, i) => <th key={i} className="text-left p-2 font-medium">{h}</th>)}
        </tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function updateRow<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) {
  setter((s) => s.map((row, idx) => idx === i ? { ...row, ...patch } : row));
}
function removeRow<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number) {
  setter((s) => s.filter((_, idx) => idx !== i));
}
