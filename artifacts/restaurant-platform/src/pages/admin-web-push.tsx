import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiAction } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Bell, Send, RefreshCcw, Save } from "lucide-react";
import { toast } from "sonner";

type ProviderType = "vapid" | "fcm" | "onesignal" | "custom";

type WebPushProviderConfig = {
  provider: ProviderType;
  fallbackProvider: ProviderType | null;
  globalEnabled: boolean;
  vapid: { publicKey: string | null; privateKeyMasked: string | null; subject: string | null };
  fcm: Record<string, unknown>;
  onesignal: Record<string, unknown>;
  custom: Record<string, unknown>;
  defaults: { iconUrl: string | null; badgeUrl: string | null; fallbackImage: string | null; clickUrl: string | null };
  planLimits: Record<string, Record<string, unknown>>;
  tenantOverrides: Record<string, Record<string, unknown>>;
};

type AdminPushStats = {
  totalSubscriptions: number;
  activeSubscriptions: number;
  sent24h: number;
  failed24h: number;
  clicked24h: number;
};

type SubTab = "provider" | "defaults" | "limits" | "stats";

export default function AdminWebPushTab() {
  const [tab, setTab] = useState<SubTab>("provider");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border">
        {(["provider", "defaults", "limits", "stats"] as SubTab[]).map(k => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm capitalize border-b-2 transition-colors ${
              tab === k ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      {tab === "provider" && <ProviderTab />}
      {tab === "defaults" && <DefaultsTab />}
      {tab === "limits" && <LimitsTab />}
      {tab === "stats" && <StatsTab />}
    </div>
  );
}

function useProvider() {
  return useQuery<WebPushProviderConfig>({
    queryKey: ["admin", "web-push", "provider"],
    queryFn: () => apiFetch("/admin/web-push/provider"),
  });
}

function ProviderTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useProvider();
  const [provider, setProvider] = useState<ProviderType>("vapid");
  const [fallback, setFallback] = useState<string>("");
  const [enabled, setEnabled] = useState(true);
  const [vapidPublic, setVapidPublic] = useState("");
  const [vapidPrivate, setVapidPrivate] = useState("");
  const [vapidSubject, setVapidSubject] = useState("");
  const [fcmJson, setFcmJson] = useState("");
  const [oneJson, setOneJson] = useState("");
  const [customJson, setCustomJson] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [testEndpoint, setTestEndpoint] = useState("");

  if (data && !loaded) {
    setProvider(data.provider);
    setFallback(data.fallbackProvider ?? "");
    setEnabled(data.globalEnabled);
    setVapidPublic(data.vapid.publicKey ?? "");
    setVapidSubject(data.vapid.subject ?? "");
    setFcmJson(JSON.stringify(data.fcm ?? {}, null, 2));
    setOneJson(JSON.stringify(data.onesignal ?? {}, null, 2));
    setCustomJson(JSON.stringify(data.custom ?? {}, null, 2));
    setLoaded(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        provider,
        fallbackProvider: fallback || null,
        globalEnabled: enabled,
      };
      const vapid: Record<string, unknown> = {};
      if (vapidPublic) vapid.publicKey = vapidPublic;
      if (vapidPrivate) vapid.privateKey = vapidPrivate;
      if (vapidSubject) vapid.subject = vapidSubject;
      if (Object.keys(vapid).length) body.vapid = vapid;
      try { body.fcm = JSON.parse(fcmJson || "{}"); } catch { throw new Error("FCM config is not valid JSON"); }
      try { body.onesignal = JSON.parse(oneJson || "{}"); } catch { throw new Error("OneSignal config is not valid JSON"); }
      try { body.custom = JSON.parse(customJson || "{}"); } catch { throw new Error("Custom config is not valid JSON"); }
      return apiAction("/admin/web-push/provider", "PUT", body);
    },
    onSuccess: () => {
      toast.success("Provider configuration saved");
      setVapidPrivate("");
      qc.invalidateQueries({ queryKey: ["admin", "web-push", "provider"] });
      setLoaded(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => apiAction("/admin/web-push/test", "POST", { endpoint: testEndpoint }),
    onSuccess: () => toast.success("Test push sent"),
    onError: (e: Error) => toast.error(e.message ?? "Failed"),
  });

  if (isLoading || !data) return <div className="p-8 text-center text-muted-foreground text-sm">Loading provider…</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-foreground flex items-center gap-2"><Bell className="w-4 h-4" /> Active provider</p>
            <p className="text-xs text-muted-foreground mt-0.5">Determines how Web Push notifications are delivered platform-wide.</p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="enabled" className="text-sm">Globally enabled</Label>
            <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Provider</Label>
            <Select value={provider} onValueChange={v => setProvider(v as ProviderType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vapid">VAPID (web-push)</SelectItem>
                <SelectItem value="fcm">Firebase Cloud Messaging</SelectItem>
                <SelectItem value="onesignal">OneSignal</SelectItem>
                <SelectItem value="custom">Custom HTTP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Fallback provider (optional)</Label>
            <Select value={fallback || "none"} onValueChange={v => setFallback(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="vapid">VAPID</SelectItem>
                <SelectItem value="fcm">FCM</SelectItem>
                <SelectItem value="onesignal">OneSignal</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <p className="font-semibold text-foreground">VAPID keys</p>
        <p className="text-xs text-muted-foreground">Used by the standard Web Push API. Public key is exposed to browsers; private key is encrypted at rest and never returned.</p>
        <div>
          <Label className="text-xs">Public key</Label>
          <Input value={vapidPublic} onChange={e => setVapidPublic(e.target.value)} placeholder="BPx..." />
        </div>
        <div>
          <Label className="text-xs">Private key {data.vapid.privateKeyMasked && <span className="text-muted-foreground">(current: {data.vapid.privateKeyMasked})</span>}</Label>
          <Input value={vapidPrivate} onChange={e => setVapidPrivate(e.target.value)} placeholder="Leave blank to keep existing" type="password" />
        </div>
        <div>
          <Label className="text-xs">Subject (mailto: or https://)</Label>
          <Input value={vapidSubject} onChange={e => setVapidSubject(e.target.value)} placeholder="mailto:ops@example.com" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <p className="font-semibold text-foreground">FCM config (JSON)</p>
        <Textarea rows={5} value={fcmJson} onChange={e => setFcmJson(e.target.value)} className="font-mono text-xs" />
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <p className="font-semibold text-foreground">OneSignal config (JSON)</p>
        <Textarea rows={4} value={oneJson} onChange={e => setOneJson(e.target.value)} className="font-mono text-xs" />
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <p className="font-semibold text-foreground">Custom HTTP config (JSON)</p>
        <Textarea rows={4} value={customJson} onChange={e => setCustomJson(e.target.value)} className="font-mono text-xs" />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save provider config
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <p className="font-semibold text-foreground">Send test push</p>
        <p className="text-xs text-muted-foreground">Paste a subscription endpoint to send a verification push using the saved provider.</p>
        <div className="flex gap-2">
          <Input value={testEndpoint} onChange={e => setTestEndpoint(e.target.value)} placeholder="https://fcm.googleapis.com/fcm/send/..." />
          <Button onClick={() => test.mutate()} disabled={!testEndpoint || test.isPending} variant="outline">
            {test.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Test
          </Button>
        </div>
      </div>
    </div>
  );
}

function DefaultsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useProvider();
  const [icon, setIcon] = useState("");
  const [badge, setBadge] = useState("");
  const [fallbackImg, setFallbackImg] = useState("");
  const [click, setClick] = useState("");
  const [loaded, setLoaded] = useState(false);

  if (data && !loaded) {
    setIcon(data.defaults.iconUrl ?? "");
    setBadge(data.defaults.badgeUrl ?? "");
    setFallbackImg(data.defaults.fallbackImage ?? "");
    setClick(data.defaults.clickUrl ?? "");
    setLoaded(true);
  }

  const save = useMutation({
    mutationFn: () => apiAction("/admin/web-push/provider", "PUT", {
      defaults: { iconUrl: icon || null, badgeUrl: badge || null, fallbackImage: fallbackImg || null, clickUrl: click || null },
    }),
    onSuccess: () => {
      toast.success("Defaults saved");
      qc.invalidateQueries({ queryKey: ["admin", "web-push", "provider"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <p className="font-semibold text-foreground">Platform fallback assets</p>
        <p className="text-xs text-muted-foreground">Used when a restaurant or template doesn't supply its own icon/badge/click URL.</p>
        <div><Label className="text-xs">Default icon URL</Label><Input value={icon} onChange={e => setIcon(e.target.value)} /></div>
        <div><Label className="text-xs">Default badge URL</Label><Input value={badge} onChange={e => setBadge(e.target.value)} /></div>
        <div><Label className="text-xs">Fallback rich image URL</Label><Input value={fallbackImg} onChange={e => setFallbackImg(e.target.value)} /></div>
        <div><Label className="text-xs">Default click URL</Label><Input value={click} onChange={e => setClick(e.target.value)} /></div>
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}Save defaults
          </Button>
        </div>
      </div>
    </div>
  );
}

function LimitsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useProvider();
  const [planJson, setPlanJson] = useState("");
  const [overridesJson, setOverridesJson] = useState("");
  const [loaded, setLoaded] = useState(false);

  if (data && !loaded) {
    setPlanJson(JSON.stringify(data.planLimits ?? {}, null, 2));
    setOverridesJson(JSON.stringify(data.tenantOverrides ?? {}, null, 2));
    setLoaded(true);
  }

  const save = useMutation({
    mutationFn: () => {
      let planLimits, tenantOverrides;
      try { planLimits = JSON.parse(planJson || "{}"); } catch { throw new Error("Plan limits is not valid JSON"); }
      try { tenantOverrides = JSON.parse(overridesJson || "{}"); } catch { throw new Error("Tenant overrides is not valid JSON"); }
      return apiAction("/admin/web-push/provider", "PUT", { planLimits, tenantOverrides });
    },
    onSuccess: () => {
      toast.success("Limits saved");
      qc.invalidateQueries({ queryKey: ["admin", "web-push", "provider"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <p className="font-semibold text-foreground">Per-plan limits</p>
        <p className="text-xs text-muted-foreground">JSON map of <code>planSlug → {`{ monthlyCap, dailyCap, allowRichImages, allowMarketing }`}</code>.</p>
        <Textarea rows={10} value={planJson} onChange={e => setPlanJson(e.target.value)} className="font-mono text-xs" />
      </div>
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <p className="font-semibold text-foreground">Tenant overrides</p>
        <p className="text-xs text-muted-foreground">JSON map of <code>tenantId → {`{ monthlyCap, dailyCap, ... }`}</code>. Takes priority over plan limits.</p>
        <Textarea rows={8} value={overridesJson} onChange={e => setOverridesJson(e.target.value)} className="font-mono text-xs" />
      </div>
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}Save limits
        </Button>
      </div>
    </div>
  );
}

function StatsTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<AdminPushStats>({
    queryKey: ["admin", "web-push", "stats"],
    queryFn: () => apiFetch("/admin/web-push/stats"),
    refetchInterval: 30000,
  });

  if (isLoading || !data) return <div className="p-8 text-center text-muted-foreground text-sm">Loading stats…</div>;

  const cards = [
    { label: "Total subscriptions", value: data.totalSubscriptions },
    { label: "Active subscriptions", value: data.activeSubscriptions },
    { label: "Sent (24h)", value: data.sent24h },
    { label: "Failed (24h)", value: data.failed24h },
    { label: "Clicked (24h)", value: data.clicked24h },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => refetch()} variant="outline" size="sm" disabled={isFetching}>
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCcw className="w-4 h-4 mr-2" />}Refresh
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-2xl font-bold text-foreground">{c.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
