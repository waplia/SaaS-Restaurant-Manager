import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Save, Rocket, Globe, Bell, Eye, ExternalLink, Plus, X, Image as ImageIcon,
  Smartphone, AlertCircle, CheckCircle2, Info,
} from "lucide-react";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiFetch, apiAction } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

interface CustomerAppConfig {
  appName?: string;
  tagline?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  heroImageUrl?: string;
  heroHeadline?: string;
  heroSubcopy?: string;
  aboutTitle?: string;
  aboutBody?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactAddress?: string;
  gallery?: string[];
  reviewWidgetEnabled?: boolean;
  googleReviewLink?: string;
  couponCodes?: string[];
  customDomain?: string;
  pushCampaigns?: Array<{ id: string; title: string; body: string; scheduledFor?: string | null }>;
  seoTitle?: string;
  seoDescription?: string;
  ogImageUrl?: string;
  published?: boolean;
  publishedAt?: string;
}

const DEFAULT_CFG: CustomerAppConfig = {
  primaryColor: "#c2410c",
  accentColor: "#f59e0b",
  reviewWidgetEnabled: true,
  gallery: [],
  couponCodes: [],
  pushCampaigns: [],
};

export default function CustomerAppBuilderPage() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["customer-app", restaurantId],
    queryFn: () => apiFetch<{ section: string; data: CustomerAppConfig; updatedAt: string | null }>(
      `/restaurants/${restaurantId}/settings/customer-app`,
    ),
  });

  const [cfg, setCfg] = useState<CustomerAppConfig>(DEFAULT_CFG);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.data) {
      setCfg({ ...DEFAULT_CFG, ...data.data });
      setDirty(false);
    }
  }, [data]);

  function patch<K extends keyof CustomerAppConfig>(key: K, value: CustomerAppConfig[K]) {
    setCfg(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  const saveMut = useMutation({
    mutationFn: () => apiAction(
      `/restaurants/${restaurantId}/settings/customer-app`, "PUT",
      { data: cfg },
    ),
    onSuccess: () => {
      toast({ title: "Branding saved", description: "Your customer app config has been updated." });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["customer-app", restaurantId] });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const publishMut = useMutation({
    mutationFn: () => apiAction<{ data: CustomerAppConfig }>(
      `/restaurants/${restaurantId}/customer-app/publish`, "POST", {},
    ),
    onSuccess: (resp) => {
      toast({ title: "App published", description: "Your customer app is now live." });
      setCfg(prev => ({ ...prev, ...resp.data }));
      qc.invalidateQueries({ queryKey: ["customer-app", restaurantId] });
    },
    onError: (e: Error) => toast({ title: "Publish failed", description: e.message, variant: "destructive" }),
  });

  const unpublishMut = useMutation({
    mutationFn: () => apiAction<{ data: CustomerAppConfig }>(
      `/restaurants/${restaurantId}/customer-app/unpublish`, "POST", {},
    ),
    onSuccess: (resp) => {
      toast({ title: "App unpublished" });
      setCfg(prev => ({ ...prev, ...resp.data }));
      qc.invalidateQueries({ queryKey: ["customer-app", restaurantId] });
    },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const { data: restaurant } = useQuery({
    queryKey: ["restaurant", restaurantId],
    queryFn: () => apiFetch<{ id: number; name: string; slug: string }>(`/restaurants/${restaurantId}`),
  });
  const slug = restaurant?.slug ?? "";
  const previewUrl = slug ? `/app/${slug}` : null;

  const actions = (
    <div className="flex items-center gap-2">
      {previewUrl && (
        <Link href={previewUrl}>
          <Button variant="outline" size="sm" data-testid="button-preview-app">
            <Eye className="w-4 h-4 mr-2" /> Preview
          </Button>
        </Link>
      )}
      <Button
        variant="outline" size="sm"
        disabled={!dirty || saveMut.isPending}
        onClick={() => saveMut.mutate()}
        data-testid="button-save-app"
      >
        <Save className="w-4 h-4 mr-2" />
        {saveMut.isPending ? "Saving…" : "Save changes"}
      </Button>
      {cfg.published ? (
        <Button
          variant="destructive" size="sm"
          disabled={unpublishMut.isPending}
          onClick={() => unpublishMut.mutate()}
          data-testid="button-unpublish-app"
        >
          Unpublish
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={publishMut.isPending || dirty}
          onClick={() => publishMut.mutate()}
          data-testid="button-publish-app"
        >
          <Rocket className="w-4 h-4 mr-2" />
          {publishMut.isPending ? "Publishing…" : "Publish app"}
        </Button>
      )}
    </div>
  );

  return (
    <SettingsLayout
      activeKey="customer-app"
      title="White-label Customer App"
      subtitle="Configure branding, content and channels for your fully branded customer ordering & loyalty app."
      actions={actions}
    >
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6">
          <PublishBanner cfg={cfg} dirty={dirty} previewUrl={previewUrl} />

          <Tabs defaultValue="branding" className="space-y-6">
            <TabsList>
              <TabsTrigger value="branding" data-testid="tab-branding">Branding</TabsTrigger>
              <TabsTrigger value="content" data-testid="tab-content">Content</TabsTrigger>
              <TabsTrigger value="coupons" data-testid="tab-coupons">App-exclusive coupons</TabsTrigger>
              <TabsTrigger value="reviews" data-testid="tab-reviews">Review widget</TabsTrigger>
              <TabsTrigger value="channels" data-testid="tab-channels">Domain & Push</TabsTrigger>
              <TabsTrigger value="seo" data-testid="tab-seo">SEO</TabsTrigger>
            </TabsList>

            <TabsContent value="branding" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Identity</CardTitle>
                  <CardDescription>How your app introduces itself to customers.</CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>App name</Label>
                    <Input value={cfg.appName ?? ""} onChange={e => patch("appName", e.target.value)} placeholder="e.g. Spice Garden" data-testid="input-app-name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tagline</Label>
                    <Input value={cfg.tagline ?? ""} onChange={e => patch("tagline", e.target.value)} placeholder="Fresh meals. Loyal rewards." data-testid="input-tagline" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Logo URL</Label>
                    <Input value={cfg.logoUrl ?? ""} onChange={e => patch("logoUrl", e.target.value)} placeholder="https://… or /objects/…" data-testid="input-logo-url" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Colours</CardTitle>
                  <CardDescription>Primary & accent colours drive buttons, links and highlights.</CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-4">
                  <ColorField label="Primary" value={cfg.primaryColor ?? "#c2410c"} onChange={v => patch("primaryColor", v)} testId="input-primary-color" />
                  <ColorField label="Accent" value={cfg.accentColor ?? "#f59e0b"} onChange={v => patch("accentColor", v)} testId="input-accent-color" />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="content" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Hero banner</CardTitle>
                  <CardDescription>The first thing customers see when they open the app.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Hero image URL</Label>
                    <Input value={cfg.heroImageUrl ?? ""} onChange={e => patch("heroImageUrl", e.target.value)} placeholder="https://… or /objects/…" data-testid="input-hero-image" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Headline</Label>
                    <Input value={cfg.heroHeadline ?? ""} onChange={e => patch("heroHeadline", e.target.value)} placeholder="Order ahead. Skip the line." data-testid="input-hero-headline" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Sub-copy</Label>
                    <Textarea rows={2} value={cfg.heroSubcopy ?? ""} onChange={e => patch("heroSubcopy", e.target.value)} placeholder="Earn loyalty points on every order." data-testid="input-hero-subcopy" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>About</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Section title</Label>
                    <Input value={cfg.aboutTitle ?? ""} onChange={e => patch("aboutTitle", e.target.value)} placeholder="About Us" data-testid="input-about-title" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Story</Label>
                    <Textarea rows={5} value={cfg.aboutBody ?? ""} onChange={e => patch("aboutBody", e.target.value)} placeholder="Tell your story…" data-testid="input-about-body" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Contact</CardTitle>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input value={cfg.contactPhone ?? ""} onChange={e => patch("contactPhone", e.target.value)} data-testid="input-contact-phone" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input value={cfg.contactEmail ?? ""} onChange={e => patch("contactEmail", e.target.value)} data-testid="input-contact-email" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Address</Label>
                    <Textarea rows={2} value={cfg.contactAddress ?? ""} onChange={e => patch("contactAddress", e.target.value)} data-testid="input-contact-address" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Gallery</CardTitle>
                  <CardDescription>Add image URLs that scroll on the home screen.</CardDescription>
                </CardHeader>
                <CardContent>
                  <StringList
                    values={cfg.gallery ?? []}
                    onChange={v => patch("gallery", v)}
                    placeholder="https://… or /objects/…"
                    testIdPrefix="gallery"
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="coupons" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>App-exclusive coupon codes</CardTitle>
                  <CardDescription>
                    Add coupon codes from your Discounts &amp; Promotions catalogue that should
                    only be visible inside the customer app.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <StringList
                    values={cfg.couponCodes ?? []}
                    onChange={v => patch("couponCodes", v.map(s => s.trim().toUpperCase()))}
                    placeholder="APP10"
                    testIdPrefix="coupon"
                  />
                  <p className="text-xs text-muted-foreground mt-3">
                    Don't have any coupons yet? <Link href="/coupons" className="underline">Manage coupons</Link>.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reviews" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Review widget</CardTitle>
                  <CardDescription>Show a "Leave a review" prompt that opens your Google review page.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ToggleRow
                    label="Show review widget on home screen"
                    value={cfg.reviewWidgetEnabled === true}
                    onChange={v => patch("reviewWidgetEnabled", v)}
                    testId="toggle-review-widget"
                  />
                  <div className="space-y-1.5">
                    <Label>Google review link</Label>
                    <Input value={cfg.googleReviewLink ?? ""} onChange={e => patch("googleReviewLink", e.target.value)} placeholder="https://g.page/r/…/review" data-testid="input-review-link" />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="channels" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Globe className="w-4 h-4" /> Custom domain</CardTitle>
                  <CardDescription>Run your customer app on your own domain.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Domain</Label>
                    <Input value={cfg.customDomain ?? ""} onChange={e => patch("customDomain", e.target.value)} placeholder="app.yourbrand.com" data-testid="input-custom-domain" />
                  </div>
                  {cfg.customDomain && (
                    <div className="rounded-md border border-border bg-muted/40 p-4 space-y-2 text-sm">
                      <p className="font-medium flex items-center gap-2">
                        <Info className="w-4 h-4" /> DNS setup
                      </p>
                      <p className="text-muted-foreground">
                        Point a CNAME record from <code className="px-1.5 py-0.5 rounded bg-background">{cfg.customDomain}</code> to{" "}
                        <code className="px-1.5 py-0.5 rounded bg-background">apps.tabletrack.io</code>.
                        SSL is provisioned automatically once the DNS record is verified.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Domain verification is a placeholder in this release — contact support to complete activation.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Bell className="w-4 h-4" /> Push notification campaigns</CardTitle>
                  <CardDescription>Schedule announcements to send to everyone who installed your app.</CardDescription>
                </CardHeader>
                <CardContent>
                  <PushCampaignList
                    campaigns={cfg.pushCampaigns ?? []}
                    onChange={v => patch("pushCampaigns", v)}
                  />
                  <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Push delivery is queued — actual sending is enabled once your app is published to the stores.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="seo" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>SEO &amp; social preview</CardTitle>
                  <CardDescription>Used in search results and link previews when your app URL is shared.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Page title</Label>
                    <Input value={cfg.seoTitle ?? ""} onChange={e => patch("seoTitle", e.target.value)} placeholder="Order from Spice Garden" data-testid="input-seo-title" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Meta description</Label>
                    <Textarea rows={3} value={cfg.seoDescription ?? ""} onChange={e => patch("seoDescription", e.target.value)} placeholder="Order online, earn loyalty rewards, get app-only deals." data-testid="input-seo-description" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Open Graph image URL</Label>
                    <Input value={cfg.ogImageUrl ?? ""} onChange={e => patch("ogImageUrl", e.target.value)} placeholder="https://…" data-testid="input-og-image" />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </SettingsLayout>
  );
}

function PublishBanner({ cfg, dirty, previewUrl }: { cfg: CustomerAppConfig; dirty: boolean; previewUrl: string | null }) {
  if (cfg.published) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/40 p-4">
        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-green-900 dark:text-green-100">Your customer app is live</p>
            <Badge variant="outline">Published</Badge>
            {dirty && <Badge variant="secondary">Unsaved changes</Badge>}
          </div>
          <p className="text-sm text-green-900/80 dark:text-green-200/80 mt-0.5">
            {cfg.publishedAt ? `Published ${new Date(cfg.publishedAt).toLocaleString()}.` : "Customers can browse your menu, earn loyalty points and redeem app-exclusive coupons."}
          </p>
          {previewUrl && (
            <Link href={previewUrl} className="inline-flex items-center gap-1.5 text-sm text-green-700 dark:text-green-300 mt-2 underline">
              Open app <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-4">
      <Smartphone className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
      <div className="flex-1">
        <p className="font-medium text-amber-900 dark:text-amber-100">Your app is not published yet</p>
        <p className="text-sm text-amber-900/80 dark:text-amber-200/80 mt-0.5">
          Configure branding and content below, save your changes, then click <strong>Publish app</strong> to make it live.
          The menu and loyalty wallet sync automatically.
        </p>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color" value={value}
          onChange={e => onChange(e.target.value)}
          className="h-9 w-12 rounded border border-border bg-background cursor-pointer"
          aria-label={label}
        />
        <Input value={value} onChange={e => onChange(e.target.value)} className="font-mono" data-testid={testId} />
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange, testId }: { label: string; value: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="cursor-pointer">{label}</Label>
      <Switch checked={value} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}

function StringList({ values, onChange, placeholder, testIdPrefix }: {
  values: string[]; onChange: (v: string[]) => void; placeholder?: string; testIdPrefix: string;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const t = draft.trim();
    if (!t) return;
    onChange([...values, t]);
    setDraft("");
  }
  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <div className="space-y-1.5">
          {values.map((v, i) => (
            <div key={i} className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30 text-sm">
              <ImageIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="flex-1 truncate" data-testid={`${testIdPrefix}-item-${i}`}>{v}</span>
              <Button
                variant="ghost" size="sm"
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                data-testid={`${testIdPrefix}-remove-${i}`}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          data-testid={`${testIdPrefix}-input`}
        />
        <Button type="button" variant="outline" onClick={add} data-testid={`${testIdPrefix}-add`}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

interface PushCampaign { id: string; title: string; body: string; scheduledFor?: string | null }

function PushCampaignList({ campaigns, onChange }: { campaigns: PushCampaign[]; onChange: (v: PushCampaign[]) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  function add() {
    if (!title.trim() || !body.trim()) return;
    const next: PushCampaign = {
      id: `c-${Date.now()}`, title: title.trim(), body: body.trim(),
      scheduledFor: when || null,
    };
    onChange([...campaigns, next]);
    setTitle(""); setBody(""); setWhen("");
  }
  return (
    <div className="space-y-3">
      {campaigns.length === 0 && (
        <p className="text-sm text-muted-foreground">No campaigns scheduled yet.</p>
      )}
      {campaigns.map((c, i) => (
        <div key={c.id} className="flex items-start gap-2 p-3 rounded-md border border-border bg-muted/30" data-testid={`push-row-${i}`}>
          <Bell className="w-4 h-4 text-muted-foreground mt-1" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{c.title}</p>
            <p className="text-xs text-muted-foreground truncate">{c.body}</p>
            {c.scheduledFor && <p className="text-[11px] text-muted-foreground mt-0.5">Scheduled: {c.scheduledFor}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(campaigns.filter((_, idx) => idx !== i))} data-testid={`push-remove-${i}`}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      <div className="grid sm:grid-cols-3 gap-2">
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" data-testid="push-title" />
        <Input value={body} onChange={e => setBody(e.target.value)} placeholder="Message" className="sm:col-span-1" data-testid="push-body" />
        <div className="flex items-center gap-2">
          <Input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} data-testid="push-when" />
          <Button type="button" variant="outline" onClick={add} data-testid="push-add"><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
        </div>
      </div>
    </div>
  );
}
