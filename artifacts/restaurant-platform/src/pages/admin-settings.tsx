import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Save, Upload, Loader2 } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { apiFetch, apiAction, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type Settings = {
  appName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string;
  supportPhone: string | null;
  supportWhatsapp: string | null;
  companyAddress: string | null;
  defaultCurrency: string;
  defaultTimezone: string;
  dateFormat: string;
  timeFormat: "12h" | "24h";
  trialDays: number;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  signupEnabled: boolean;
  landingPageEnabled: boolean;
  footerText: string | null;
  socialLinks: Record<string, string>;
};

const SOCIALS = ["facebook", "instagram", "twitter", "linkedin", "youtube", "tiktok"] as const;

async function uploadImage(file: File): Promise<string> {
  const { uploadURL, objectPath } = await apiPost<{ uploadURL: string; objectPath: string }>(
    "/admin/app-settings/uploads/request-url",
    {},
  );
  const put = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  const fin = await apiPost<{ publicUrl: string }>("/admin/app-settings/uploads/finalize", { objectPath });
  return fin.publicUrl;
}

function ImagePicker({ label, value, onChange, accept = "image/*" }: { label: string; value: string | null; onChange: (url: string | null) => void; accept?: string }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const url = await uploadImage(f);
      onChange(url);
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    } finally { setBusy(false); e.target.value = ""; }
  }
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt={label} className="h-12 w-12 object-contain rounded border border-border bg-card" />
        ) : (
          <div className="h-12 w-12 rounded border border-dashed border-border bg-card/50" />
        )}
        <Input value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} placeholder="Image URL or upload below" />
        <label className="inline-flex items-center gap-2 cursor-pointer text-sm border border-input rounded px-3 py-2 hover:bg-accent">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span>Upload</span>
          <input type="file" accept={accept} className="hidden" onChange={handleFile} disabled={busy} />
        </label>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

export default function AdminSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Settings>({
    queryKey: ["admin-app-settings"],
    queryFn: () => apiFetch<Settings>("/admin/app-settings"),
  });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const update = useMutation({
    mutationFn: (patch: Partial<Settings>) => apiAction<Settings>("PUT", "/admin/app-settings", patch),
    onSuccess: (s) => {
      qc.setQueryData(["admin-app-settings"], s);
      qc.invalidateQueries({ queryKey: ["public-app-settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !form) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  function set<K extends keyof Settings>(k: K, v: Settings[K]) { setForm((f) => f ? { ...f, [k]: v } : f); }
  function setSocial(key: string, v: string) {
    setForm((f) => f ? { ...f, socialLinks: { ...f.socialLinks, [key]: v } } : f);
  }

  function handleSave() {
    if (!form) return;
    update.mutate(form);
  }

  return (
    <AdminLayout
      title="App Settings"
      subtitle="Platform-wide branding, support, localization & toggles"
      actions={
        <Button onClick={handleSave} disabled={update.isPending}>
          {update.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save changes
        </Button>
      }
    >
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <Section title="Branding" description="Application name and visual identity used across all surfaces.">
          <div>
            <Label>App name</Label>
            <Input value={form.appName} onChange={(e) => set("appName", e.target.value)} maxLength={80} />
          </div>
          <ImagePicker label="Logo" value={form.logoUrl} onChange={(v) => set("logoUrl", v)} />
          <ImagePicker label="Favicon" value={form.faviconUrl} onChange={(v) => set("faviconUrl", v)} accept="image/png,image/svg+xml,image/x-icon" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Primary color</Label>
              <div className="flex gap-2">
                <input type="color" value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} className="h-9 w-12 rounded border border-input" />
                <Input value={form.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Secondary color</Label>
              <div className="flex gap-2">
                <input type="color" value={form.secondaryColor} onChange={(e) => set("secondaryColor", e.target.value)} className="h-9 w-12 rounded border border-input" />
                <Input value={form.secondaryColor} onChange={(e) => set("secondaryColor", e.target.value)} />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Support & Contact" description="Where customers reach you for help.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Support email *</Label>
              <Input type="email" value={form.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} />
            </div>
            <div>
              <Label>Support phone</Label>
              <Input value={form.supportPhone ?? ""} onChange={(e) => set("supportPhone", e.target.value || null)} placeholder="+91 98765 43210" />
            </div>
            <div>
              <Label>WhatsApp number</Label>
              <Input value={form.supportWhatsapp ?? ""} onChange={(e) => set("supportWhatsapp", e.target.value || null)} placeholder="+91 98765 43210" />
            </div>
            <div>
              <Label>Company address</Label>
              <Input value={form.companyAddress ?? ""} onChange={(e) => set("companyAddress", e.target.value || null)} />
            </div>
          </div>
        </Section>

        <Section title="Localization" description="Defaults applied to new tenants.">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>Currency</Label>
              <Input value={form.defaultCurrency} onChange={(e) => set("defaultCurrency", e.target.value.toUpperCase())} maxLength={3} />
            </div>
            <div>
              <Label>Timezone</Label>
              <Input value={form.defaultTimezone} onChange={(e) => set("defaultTimezone", e.target.value)} />
            </div>
            <div>
              <Label>Date format</Label>
              <Input value={form.dateFormat} onChange={(e) => set("dateFormat", e.target.value)} />
            </div>
            <div>
              <Label>Time format</Label>
              <select className="w-full h-9 px-3 rounded border border-input bg-background text-sm" value={form.timeFormat} onChange={(e) => set("timeFormat", e.target.value as "12h" | "24h")}>
                <option value="12h">12-hour</option>
                <option value="24h">24-hour</option>
              </select>
            </div>
          </div>
        </Section>

        <Section title="Operational" description="Platform-wide feature toggles.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Trial duration (days)</Label>
              <Input type="number" min={0} max={365} value={form.trialDays} onChange={(e) => set("trialDays", Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-3 pt-2">
            <ToggleRow label="Signups enabled" description="When off, new restaurants cannot register." checked={form.signupEnabled} onChange={(v) => set("signupEnabled", v)} />
            <ToggleRow label="Landing page enabled" description="When off, the marketing site redirects visitors to sign-in." checked={form.landingPageEnabled} onChange={(v) => set("landingPageEnabled", v)} />
            <ToggleRow label="Maintenance mode" description="Block all non-super-admin requests with a 503." checked={form.maintenanceMode} onChange={(v) => set("maintenanceMode", v)} />
          </div>
          <div>
            <Label>Maintenance message</Label>
            <Textarea value={form.maintenanceMessage ?? ""} onChange={(e) => set("maintenanceMessage", e.target.value || null)} rows={2} />
          </div>
        </Section>

        <Section title="Footer & Social" description="Footer copy and social handles shown on marketing site & login pages.">
          <div>
            <Label>Footer text</Label>
            <Textarea value={form.footerText ?? ""} onChange={(e) => set("footerText", e.target.value || null)} rows={2} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SOCIALS.map((k) => (
              <div key={k}>
                <Label className="capitalize">{k}</Label>
                <Input value={form.socialLinks[k] ?? ""} onChange={(e) => setSocial(k, e.target.value)} placeholder={`https://${k}.com/...`} />
              </div>
            ))}
          </div>
        </Section>

        <div className="flex justify-end pb-12">
          <Button onClick={handleSave} disabled={update.isPending} size="lg">
            {update.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save changes
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 p-3 rounded border border-border">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
