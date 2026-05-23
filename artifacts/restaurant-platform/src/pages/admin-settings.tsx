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
import { useAppSettings } from "@/lib/appSettings";

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
  authPasswordLoginEnabled: boolean;
  authMobileOtpLoginEnabled: boolean;
  authEmailOtpLoginEnabled: boolean;
  authTwoFactorEnabled: boolean;
  authSelfRegistrationRequireMobileOtp: boolean;
  authOtpDefaultChannel: "sms" | "whatsapp";
  googleSignInEnabled: boolean;
  googleClientId: string | null;
  googleIosClientId: string | null;
  googleAndroidClientId: string | null;
  googleRequirePhoneAfterSignup: boolean;
  hasGoogleClientSecret?: boolean;
  googleClientSecret?: string;
  footerText: string | null;
  socialLinks: Record<string, string>;
};

const SOCIALS = ["facebook", "instagram", "twitter", "linkedin", "youtube", "tiktok"] as const;

async function uploadImage(file: File): Promise<string> {
  const contentType = file.type || "application/octet-stream";
  const presign = await apiPost<{
    uploadURL: string;
    objectPath: string;
    maxBytes?: number;
    allowedMimeTypes?: string[];
  }>("/admin/app-settings/uploads/request-url", {
    name: file.name,
    size: file.size,
    contentType,
  });

  // Client-side guards using the limits the server just told us about, so a
  // user sees a clear message before we even attempt the (slow) PUT.
  if (presign.maxBytes && file.size > presign.maxBytes) {
    throw new Error(`Image is too large (${Math.round(file.size / 1024)} KB). Max ${Math.round(presign.maxBytes / 1024)} KB.`);
  }
  if (presign.allowedMimeTypes && presign.allowedMimeTypes.length > 0 && !presign.allowedMimeTypes.includes(contentType.toLowerCase())) {
    throw new Error(`Image type "${contentType}" isn't allowed. Allowed: ${presign.allowedMimeTypes.join(", ")}.`);
  }

  const put = await fetch(presign.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!put.ok) {
    // Storage providers return XML; try to surface anything human-readable.
    let detail = "";
    try { detail = (await put.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`Couldn't upload the file to storage (status ${put.status})${detail ? `: ${detail}` : ""}`);
  }

  // Finalize occasionally races GCS's read-your-write window. Retry a couple
  // of times so a "not found" reply doesn't surface as a hard failure.
  let lastErr: unknown;
  for (const wait of [0, 400, 900]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const fin = await apiPost<{ publicUrl: string }>("/admin/app-settings/uploads/finalize", { objectPath: presign.objectPath });
      return fin.publicUrl;
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      if (status !== 404) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Couldn't finalize the upload");
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
  const publicSettings = useAppSettings();
  const { data, isLoading } = useQuery<Settings>({
    queryKey: ["admin-app-settings"],
    queryFn: () => apiFetch<Settings>("/admin/app-settings"),
  });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const update = useMutation({
    mutationFn: (patch: Partial<Settings>) => apiAction<Settings>("/admin/app-settings", "PUT", patch),
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
          <ImagePicker label="Favicon" value={form.faviconUrl} onChange={(v) => set("faviconUrl", v)} accept="image/png,image/jpeg,image/webp" />
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

        <Section title="Login & registration" description="Choose which login methods are available and how new restaurants sign up.">
          <div className="space-y-3">
            <ToggleRow label="Password login" description="Allow staff to sign in with email + password." checked={form.authPasswordLoginEnabled} onChange={(v) => set("authPasswordLoginEnabled", v)} />
            <ToggleRow label="Mobile OTP login" description="Allow staff to sign in with a one-time code sent to their phone (SMS or WhatsApp)." checked={form.authMobileOtpLoginEnabled} onChange={(v) => set("authMobileOtpLoginEnabled", v)} />
            <ToggleRow label="Email OTP login" description="Allow staff to sign in with a one-time code sent to their email." checked={form.authEmailOtpLoginEnabled} onChange={(v) => set("authEmailOtpLoginEnabled", v)} />
            <ToggleRow label="Two-factor authentication" description="Allow staff to enable 2FA on their account. When off, individual 2FA settings are ignored." checked={form.authTwoFactorEnabled} onChange={(v) => set("authTwoFactorEnabled", v)} />
            <ToggleRow label="Require mobile OTP on self-serve signup" description="When on, new restaurants must verify their phone before completing signup." checked={form.authSelfRegistrationRequireMobileOtp} onChange={(v) => set("authSelfRegistrationRequireMobileOtp", v)} />
          </div>
          <div>
            <Label>Default OTP channel for mobile</Label>
            <select className="w-full h-9 px-3 rounded border border-input bg-background text-sm" value={form.authOtpDefaultChannel} onChange={(e) => set("authOtpDefaultChannel", e.target.value as "sms" | "whatsapp")}>
              <option value="sms">SMS</option>
              <option value="whatsapp" disabled={publicSettings.whatsappEnabled === false}>
                WhatsApp{publicSettings.whatsappEnabled === false ? " (not configured)" : ""}
              </option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              {publicSettings.whatsappEnabled === false
                ? "WhatsApp provider credentials (Twilio) are not configured, so the SMS/WhatsApp chooser is hidden across the app and all OTPs are sent via SMS. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM to enable WhatsApp."
                : "Used as the pre-selected channel in the login & signup screens."}
            </p>
          </div>
        </Section>

        <Section title="Google Sign-In" description="Let restaurants sign in with Google. Credentials are stored encrypted and are never returned to the browser. Whitelist the redirect URI in Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client.">
          <div className="space-y-3">
            <ToggleRow
              label="Enable Google sign-in"
              description="When off, the Google button is hidden on web & mobile and all Google auth requests are rejected."
              checked={form.googleSignInEnabled}
              onChange={(v) => set("googleSignInEnabled", v)}
            />
            <ToggleRow
              label="Require phone verification after Google signup"
              description="New accounts created via Google must add and verify a phone number before they can finish signing in."
              checked={form.googleRequirePhoneAfterSignup}
              onChange={(v) => set("googleRequirePhoneAfterSignup", v)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Google Client ID</Label>
              <Input
                value={form.googleClientId ?? ""}
                onChange={(e) => set("googleClientId", e.target.value || null)}
                placeholder="123456789-abc.apps.googleusercontent.com"
                autoComplete="off"
              />
            </div>
            <div>
              <Label>Google Client Secret</Label>
              <Input
                type="password"
                value={form.googleClientSecret ?? ""}
                onChange={(e) => set("googleClientSecret", e.target.value)}
                placeholder={form.hasGoogleClientSecret ? "•••••••••• (saved — leave blank to keep)" : "Paste the OAuth client secret"}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {form.hasGoogleClientSecret ? "A secret is already saved. Type a new value to replace it, or leave blank to keep the existing one." : "Stored encrypted at rest. Restaurant admins can never read it."}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>iOS OAuth Client ID (optional)</Label>
              <Input
                value={form.googleIosClientId ?? ""}
                onChange={(e) => set("googleIosClientId", e.target.value || null)}
                placeholder="123456789-ios.apps.googleusercontent.com"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Required for native iOS sign-in (standalone Expo / TestFlight / App Store builds). Create an "iOS" OAuth client in Google Cloud Console using your iOS bundle identifier.
              </p>
            </div>
            <div>
              <Label>Android OAuth Client ID (optional)</Label>
              <Input
                value={form.googleAndroidClientId ?? ""}
                onChange={(e) => set("googleAndroidClientId", e.target.value || null)}
                placeholder="123456789-android.apps.googleusercontent.com"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Required for native Android sign-in. Create an "Android" OAuth client in Google Cloud Console using your Android package name + SHA-1 fingerprint.
              </p>
            </div>
          </div>
          <div>
            <Label>Redirect URI (whitelist this in Google Cloud)</Label>
            <Input value={typeof window !== "undefined" ? `${window.location.origin}/app/auth/google/callback` : ""} readOnly />
          </div>
          <div className="flex justify-start">
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                try {
                  const res = await apiPost<{ ok: boolean; error?: string; redirectUri?: string }>(
                    "/admin/app-settings/google/test", {},
                  );
                  if (res.ok) toast({ title: "Google credentials look valid", description: `Redirect URI: ${res.redirectUri ?? "(set PUBLIC_APP_URL)"}` });
                  else toast({ title: "Test failed", description: res.error ?? "Unknown error", variant: "destructive" });
                } catch (e) {
                  toast({ title: "Test failed", description: (e as Error).message, variant: "destructive" });
                }
              }}
            >
              Test connection
            </Button>
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
