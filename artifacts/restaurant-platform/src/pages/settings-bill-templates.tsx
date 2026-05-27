/**
 * Task #674 — Bill Templates admin page.
 *
 * Lists every per-restaurant template (seeded with the 8 system defaults on
 * first visit), lets the owner edit the layout toggles + header/footer
 * lines, preview the result, and map each surface (web POS, desktop POS,
 * mobile, QR, A4, WhatsApp, email, KOT) to a chosen template. Saving the
 * channel map instantly changes what every channel prints — same data,
 * same calculations, same template across all surfaces.
 */
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPut, apiPost, apiDelete } from "@/lib/api";
import { Printer, Eye, Save, Loader2 } from "lucide-react";

interface BillTemplate {
  id: number;
  key: string;
  name: string;
  description: string | null;
  paperSize: "thermal_58" | "thermal_80" | "a4" | "a5";
  isDefault: boolean;
  isSystem: boolean;
  layout: {
    title?: string;
    headerLines?: string[];
    footerLines?: string[];
    terms?: string;
    showLogo?: boolean;
    showGstin?: boolean;
    showFssai?: boolean;
    showModifiers?: boolean;
    showItemNotes?: boolean;
    showTaxBreakdown?: boolean;
    showUpiQr?: boolean;
    showStaff?: boolean;
    showTableMeta?: boolean;
    showCustomer?: boolean;
    isKot?: boolean;
    accentColor?: string;
  };
}

interface TemplatesResponse {
  templates: BillTemplate[];
  channels: Record<string, number>;
  availableChannels: string[];
}

const CHANNEL_LABELS: Record<string, string> = {
  web_pos: "Web POS",
  desktop_pos: "Desktop POS",
  mobile_waiter: "Mobile Waiter App",
  qr_customer: "Customer QR Receipt",
  a4_pdf: "A4 PDF Download",
  thermal_print: "Thermal Print",
  whatsapp_share: "WhatsApp Share",
  email_share: "Email Share",
  kot: "Kitchen Order Ticket",
};

const PAPER_LABELS: Record<string, string> = {
  thermal_58: "Thermal 58mm",
  thermal_80: "Thermal 80mm",
  a4: "A4",
  a5: "A5",
};

export default function SettingsBillTemplatesPage() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TemplatesResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<BillTemplate | null>(null);
  const [channels, setChannels] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    setLoading(true);
    apiGet<TemplatesResponse>(`/api/restaurants/${restaurantId}/bill-templates`)
      .then(d => {
        setData(d);
        setChannels(d.channels ?? {});
        if (d.templates.length && selectedId == null) {
          setSelectedId(d.templates[0].id);
          setDraft(d.templates[0]);
        }
      })
      .catch(e => toast({ title: "Failed to load templates", description: String(e), variant: "destructive" }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const selectTemplate = (id: number) => {
    const t = data?.templates.find(x => x.id === id) ?? null;
    setSelectedId(id);
    setDraft(t ? structuredClone(t) : null);
  };

  const updateLayout = <K extends keyof BillTemplate["layout"]>(key: K, value: BillTemplate["layout"][K]) => {
    setDraft(d => (d ? { ...d, layout: { ...d.layout, [key]: value } } : d));
  };

  const saveTemplate = async () => {
    if (!draft || !restaurantId) return;
    setSaving(true);
    try {
      const updated = await apiPut<BillTemplate>(
        `/api/restaurants/${restaurantId}/bill-templates/${draft.id}`,
        { name: draft.name, description: draft.description, paperSize: draft.paperSize, layout: draft.layout },
      );
      setData(d => d ? { ...d, templates: d.templates.map(t => t.id === updated.id ? updated : t) } : d);
      toast({ title: "Template saved" });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const previewTemplate = async () => {
    if (!draft || !restaurantId) return;
    try {
      await apiPut<BillTemplate>(
        `/api/restaurants/${restaurantId}/bill-templates/${draft.id}`,
        { layout: draft.layout },
      );
    } catch (e) {
      void e;
    }
    const url = `/api/restaurants/${restaurantId}/bill-templates/${draft.id}/preview`;
    const w = window.open("", "_blank", "width=520,height=820");
    if (!w) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to preview the template.", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch(url, { method: "POST", credentials: "include" });
      const html = await res.text();
      w.document.write(html);
      w.document.close();
    } catch (e) {
      toast({ title: "Preview failed", description: String(e), variant: "destructive" });
      w.close();
    }
  };

  const saveChannels = async () => {
    if (!restaurantId) return;
    setSaving(true);
    try {
      const res = await apiPut<{ channels: Record<string, number> }>(
        `/api/restaurants/${restaurantId}/bill-templates/channels`,
        { channels },
      );
      setChannels(res.channels);
      toast({ title: "Channel mapping saved" });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const duplicateTemplate = async () => {
    if (!draft || !restaurantId) return;
    try {
      const created = await apiPost<BillTemplate>(`/api/restaurants/${restaurantId}/bill-templates`, {
        key: `${draft.key}_copy_${Date.now()}`,
        name: `${draft.name} (Copy)`,
        description: draft.description,
        paperSize: draft.paperSize,
        layout: draft.layout,
      });
      setData(d => d ? { ...d, templates: [...d.templates, created] } : d);
      setSelectedId(created.id);
      setDraft(created);
      toast({ title: "Template duplicated" });
    } catch (e) {
      toast({ title: "Duplicate failed", description: String(e), variant: "destructive" });
    }
  };

  const deleteTemplate = async () => {
    if (!draft || !restaurantId) return;
    if (draft.isSystem) {
      toast({ title: "System templates cannot be deleted", description: "Edit the layout instead.", variant: "destructive" });
      return;
    }
    if (!confirm(`Delete "${draft.name}"?`)) return;
    try {
      await apiDelete(`/api/restaurants/${restaurantId}/bill-templates/${draft.id}`);
      const next = data?.templates.filter(t => t.id !== draft.id) ?? [];
      setData(d => d ? { ...d, templates: next } : d);
      setSelectedId(next[0]?.id ?? null);
      setDraft(next[0] ?? null);
      toast({ title: "Template deleted" });
    } catch (e) {
      toast({ title: "Delete failed", description: String(e), variant: "destructive" });
    }
  };

  const headerLinesText = useMemo(() => (draft?.layout.headerLines ?? []).join("\n"), [draft]);
  const footerLinesText = useMemo(() => (draft?.layout.footerLines ?? []).join("\n"), [draft]);

  return (
    <Layout>
      <PageHeader
        title="Bill Templates"
        description="Design the bill once, choose which template each surface uses (POS, mobile, QR, A4, share, KOT). Every channel renders from the same frozen order snapshot, so reprints stay identical."
        icon={Printer}
      />
      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading templates…
        </div>
      )}
      {!loading && data && (
        <div className="grid lg:grid-cols-[260px_1fr_360px] gap-4 mt-4">
          {/* Template list */}
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Templates</div>
            {data.templates.map(t => (
              <button
                key={t.id}
                onClick={() => selectTemplate(t.id)}
                className={`w-full text-left rounded-md px-3 py-2 border text-sm ${selectedId === t.id ? "bg-orange-50 border-orange-300" : "bg-white border-transparent hover:bg-slate-50"}`}
              >
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">{PAPER_LABELS[t.paperSize]} {t.isSystem ? "· system" : ""}</div>
              </button>
            ))}
          </div>

          {/* Editor */}
          {draft ? (
            <div className="space-y-4 bg-white rounded-md border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 flex-1">
                  <Label>Template Name</Label>
                  <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="space-y-1 w-40">
                  <Label>Paper Size</Label>
                  <Select value={draft.paperSize} onValueChange={(v) => setDraft({ ...draft, paperSize: v as BillTemplate["paperSize"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PAPER_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Description</Label>
                <Input value={draft.description ?? ""} onChange={e => setDraft({ ...draft, description: e.target.value })} />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Document Title</Label>
                  <Input value={draft.layout.title ?? ""} placeholder="Receipt / Tax Invoice" onChange={e => updateLayout("title", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Accent Color (A4 / A5)</Label>
                  <Input type="color" value={draft.layout.accentColor ?? "#ea580c"} onChange={e => updateLayout("accentColor", e.target.value)} />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Header Lines (one per line)</Label>
                <Textarea rows={3} value={headerLinesText} onChange={e => updateLayout("headerLines", e.target.value.split("\n").filter(Boolean))} />
              </div>
              <div className="space-y-1">
                <Label>Footer Lines (one per line)</Label>
                <Textarea rows={3} value={footerLinesText} onChange={e => updateLayout("footerLines", e.target.value.split("\n").filter(Boolean))} />
              </div>
              <div className="space-y-1">
                <Label>Terms &amp; Conditions</Label>
                <Textarea rows={2} value={draft.layout.terms ?? ""} onChange={e => updateLayout("terms", e.target.value)} />
              </div>

              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 pt-2 border-t">
                {([
                  ["showLogo", "Show logo"],
                  ["showGstin", "Show GSTIN"],
                  ["showFssai", "Show FSSAI license"],
                  ["showModifiers", "Show item modifiers"],
                  ["showItemNotes", "Show item notes"],
                  ["showTaxBreakdown", "Show tax breakdown"],
                  ["showUpiQr", "Show UPI QR (Scan to Pay)"],
                  ["showStaff", "Show server / cashier name"],
                  ["showTableMeta", "Show table / order type"],
                  ["showCustomer", "Show customer details"],
                  ["isKot", "Render as KOT (no prices)"],
                ] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center justify-between gap-3 text-sm">
                    <span>{label}</span>
                    <Switch checked={!!draft.layout[k]} onCheckedChange={(v) => updateLayout(k, v)} />
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 pt-3 border-t">
                <Button onClick={saveTemplate} disabled={saving}>
                  <Save className="w-4 h-4 mr-1" /> Save
                </Button>
                <Button variant="outline" onClick={previewTemplate}>
                  <Eye className="w-4 h-4 mr-1" /> Preview
                </Button>
                <Button variant="outline" onClick={duplicateTemplate}>Duplicate</Button>
                <Button variant="ghost" onClick={deleteTemplate} disabled={draft.isSystem} className="text-red-600 ml-auto">
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground italic p-4">Select a template to edit.</div>
          )}

          {/* Channel mapping */}
          <div className="space-y-3 bg-white rounded-md border p-4 h-fit">
            <div>
              <div className="font-medium">Channel → Template</div>
              <div className="text-xs text-muted-foreground">Pick which template each surface renders with. Leave on "Default" to use the recommended template for that channel.</div>
            </div>
            {(data.availableChannels ?? []).map(ch => (
              <div key={ch} className="space-y-1">
                <Label className="text-sm">{CHANNEL_LABELS[ch] ?? ch}</Label>
                <Select
                  value={channels[ch] != null ? String(channels[ch]) : "default"}
                  onValueChange={(v) => {
                    setChannels(c => {
                      const next = { ...c };
                      if (v === "default") delete next[ch];
                      else next[ch] = Number(v);
                      return next;
                    });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default for this channel</SelectItem>
                    {data.templates.map(t => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <Button onClick={saveChannels} disabled={saving} className="w-full">
              <Save className="w-4 h-4 mr-1" /> Save channel mapping
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}
