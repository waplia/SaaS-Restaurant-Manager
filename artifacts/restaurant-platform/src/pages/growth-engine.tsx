import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Megaphone, Plus, Search, Calendar, BarChart3, ScrollText, Trash2, Pencil,
  Play, Pause, Send, CheckCircle2, Clock, MessageSquare, Mail, Smartphone,
  Bell, QrCode, Sparkles, Gift, Cake, Heart, UserX, Star, RotateCcw, PartyPopper,
  CloudRain, Tag, Users, Megaphone as MegaIcon, Ticket, Share2, ThumbsUp, Loader2,
} from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Status = "draft" | "scheduled" | "sent" | "paused" | "completed";
type Channel = "whatsapp" | "sms" | "email" | "push" | "qr_banner";

type Campaign = {
  id: number;
  restaurantId: number;
  name: string;
  type: string;
  channel: Channel;
  status: Status;
  audience: Record<string, unknown>;
  content: { subject?: string; body?: string; ctaText?: string; ctaUrl?: string; mediaUrl?: string };
  stats: { sent?: number; delivered?: number; opened?: number; clicked?: number; converted?: number; revenue?: number };
  scheduledAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type LogRow = {
  id: number;
  campaignId: number;
  event: string;
  actorId: number | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

type Analytics = {
  total: number;
  byStatus: Partial<Record<Status, number>>;
  byChannel: Partial<Record<Channel, number>>;
  byType: Record<string, number>;
};

// 19 campaign templates (matches the spec)
const TEMPLATES: Array<{
  type: string;
  label: string;
  icon: typeof Sparkles;
  defaultChannel: Channel;
  body: string;
  subject?: string;
  blurb: string;
}> = [
  { type: "win_back", label: "Customer Win-Back", icon: RotateCcw, defaultChannel: "whatsapp", blurb: "Re-engage customers who haven't ordered in a while", body: "We miss you, {{name}}! Come back for 15% off your next order.", subject: "We miss you!" },
  { type: "birthday", label: "Birthday Campaign", icon: Cake, defaultChannel: "whatsapp", blurb: "Send birthday wishes with a special treat", body: "Happy birthday, {{name}}! Enjoy a free dessert on us this week.", subject: "Happy Birthday from us!" },
  { type: "anniversary", label: "Anniversary Campaign", icon: Heart, defaultChannel: "email", blurb: "Celebrate customer anniversaries", body: "Hi {{name}}, it's been a year since your first visit! Here's 20% off.", subject: "Happy anniversary!" },
  { type: "inactive", label: "Inactive Customer", icon: UserX, defaultChannel: "sms", blurb: "Reach customers who went silent for 60+ days", body: "Hey {{name}}, it's been a while. Tap here for a comeback offer.", subject: "Come back for a comeback offer" },
  { type: "first_order", label: "First-Order Offer", icon: Star, defaultChannel: "push", blurb: "Welcome new customers with a discount", body: "Welcome! Your first order gets 10% off. Code: WELCOME10", subject: "Welcome — enjoy 10% off" },
  { type: "repeat_order", label: "Repeat-Order Offer", icon: ThumbsUp, defaultChannel: "whatsapp", blurb: "Reward customers who order again", body: "Thanks for coming back, {{name}}! Free delivery on your next 3 orders.", subject: "Thanks for ordering again" },
  { type: "festival", label: "Festival Campaign", icon: PartyPopper, defaultChannel: "email", blurb: "Holiday and festival promotions", body: "Celebrate {{festival}} with our special menu! Book your table now.", subject: "{{festival}} special menu" },
  { type: "slow_day", label: "Slow-Day Offer", icon: CloudRain, defaultChannel: "push", blurb: "Boost sales on quieter days", body: "It's Tuesday — enjoy 2-for-1 on starters today only!", subject: "Tuesday special — 2-for-1" },
  { type: "item_specific", label: "Item-Specific Offer", icon: Tag, defaultChannel: "whatsapp", blurb: "Promote a specific dish or category", body: "Try our new {{item}} — 20% off this week!", subject: "New on the menu" },
  { type: "segmentation", label: "Customer Segmentation", icon: Users, defaultChannel: "email", blurb: "Target a custom customer segment", body: "Personalised offer for our VIP guests.", subject: "An offer just for you" },
  { type: "whatsapp_draft", label: "WhatsApp Draft", icon: MessageSquare, defaultChannel: "whatsapp", blurb: "Free-form WhatsApp message", body: "Hi {{name}}, ", subject: "" },
  { type: "sms_draft", label: "SMS Draft", icon: Smartphone, defaultChannel: "sms", blurb: "Short text message", body: "Hi {{name}}, ", subject: "" },
  { type: "email_draft", label: "Email Draft", icon: Mail, defaultChannel: "email", blurb: "Free-form email", body: "Hi {{name}},\n\n", subject: "A note from us" },
  { type: "coupon_automation", label: "Coupon Automation", icon: Ticket, defaultChannel: "email", blurb: "Auto-issue coupons when conditions trigger", body: "Your coupon {{code}} is ready — valid for 7 days.", subject: "Your coupon is ready" },
  { type: "referral", label: "Referral Program", icon: Share2, defaultChannel: "whatsapp", blurb: "Invite-a-friend rewards", body: "Refer a friend, get ₹100 off. Your link: {{link}}", subject: "Refer a friend, get rewarded" },
  { type: "review_booster", label: "Google Review Booster", icon: Star, defaultChannel: "sms", blurb: "Ask happy customers for a Google review", body: "Thanks for dining with us! Mind leaving a quick review? {{review_link}}", subject: "Quick favour — leave us a review?" },
];

const CHANNEL_META: Record<Channel, { label: string; icon: typeof MessageSquare }> = {
  whatsapp: { label: "WhatsApp", icon: MessageSquare },
  sms: { label: "SMS", icon: Smartphone },
  email: { label: "Email", icon: Mail },
  push: { label: "Push / In-app", icon: Bell },
  qr_banner: { label: "QR Menu Banner", icon: QrCode },
};

const STATUS_META: Record<Status, { label: string; tone: string; icon: typeof Clock }> = {
  draft:     { label: "Draft",     tone: "bg-muted text-muted-foreground",                    icon: Pencil },
  scheduled: { label: "Scheduled", tone: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",     icon: Clock },
  sent:      { label: "Sent",      tone: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",   icon: Send },
  paused:    { label: "Paused",    tone: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",   icon: Pause },
  completed: { label: "Completed", tone: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300", icon: CheckCircle2 },
};

const STATUSES: Status[] = ["draft", "scheduled", "sent", "paused", "completed"];
const CHANNELS: Channel[] = ["whatsapp", "sms", "email", "push", "qr_banner"];

function templateFor(type: string) {
  return TEMPLATES.find(t => t.type === type);
}

function formatDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

export default function GrowthEnginePage() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"campaigns" | "analytics" | "logs">("campaigns");
  const [filters, setFilters] = useState<{ status: string; channel: string; type: string; q: string }>({
    status: "all", channel: "all", type: "all", q: "",
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Campaign> | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.status !== "all") p.set("status", filters.status);
    if (filters.channel !== "all") p.set("channel", filters.channel);
    if (filters.type !== "all") p.set("type", filters.type);
    if (filters.q.trim()) p.set("q", filters.q.trim());
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [filters]);

  const campaignsQ = useQuery<Campaign[]>({
    queryKey: ["growth-campaigns", restaurantId, queryString],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/campaigns${queryString}`),
    enabled: !!restaurantId,
  });

  const analyticsQ = useQuery<Analytics>({
    queryKey: ["growth-analytics", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/analytics`),
    enabled: !!restaurantId,
  });

  const logsQ = useQuery<LogRow[]>({
    queryKey: ["growth-logs", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/logs?limit=100`),
    enabled: !!restaurantId && tab === "logs",
  });

  const detailQ = useQuery<{ campaign: Campaign; logs: LogRow[] }>({
    queryKey: ["growth-campaign", restaurantId, detailId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/campaigns/${detailId}`),
    enabled: !!restaurantId && !!detailId,
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["growth-campaigns", restaurantId] });
    qc.invalidateQueries({ queryKey: ["growth-analytics", restaurantId] });
    qc.invalidateQueries({ queryKey: ["growth-logs", restaurantId] });
    if (detailId) qc.invalidateQueries({ queryKey: ["growth-campaign", restaurantId, detailId] });
  }

  const saveMut = useMutation({
    mutationFn: async (c: Partial<Campaign>) => {
      const body = {
        name: c.name,
        type: c.type,
        channel: c.channel,
        content: c.content,
        scheduledAt: c.scheduledAt,
      };
      if (c.id) return apiPatch<Campaign>(`/restaurants/${restaurantId}/growth/campaigns/${c.id}`, body);
      return apiPost<Campaign>(`/restaurants/${restaurantId}/growth/campaigns`, body);
    },
    onSuccess: () => {
      setEditorOpen(false);
      setEditing(null);
      invalidateAll();
      toast({ title: "Saved", description: "Campaign saved successfully." });
    },
    onError: (e: unknown) => toast({
      title: "Couldn't save",
      description: e instanceof ApiError ? e.message : "Please try again.",
      variant: "destructive",
    }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: Status }) =>
      apiPost<Campaign>(`/restaurants/${restaurantId}/growth/campaigns/${id}/status`, { status }),
    onSuccess: () => { invalidateAll(); toast({ title: "Status updated" }); },
    onError: (e: unknown) => toast({
      title: "Couldn't update status",
      description: e instanceof ApiError ? e.message : "Please try again.",
      variant: "destructive",
    }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/growth/campaigns/${id}`),
    onSuccess: () => {
      setDetailId(null);
      invalidateAll();
      toast({ title: "Campaign deleted" });
    },
    onError: (e: unknown) => toast({
      title: "Couldn't delete",
      description: e instanceof ApiError ? e.message : "Please try again.",
      variant: "destructive",
    }),
  });

  function openTemplate(type: string) {
    const tpl = templateFor(type);
    if (!tpl) return;
    setEditing({
      name: tpl.label,
      type: tpl.type,
      channel: tpl.defaultChannel,
      content: { subject: tpl.subject ?? "", body: tpl.body, ctaText: "", ctaUrl: "" },
      scheduledAt: null,
    });
    setPickerOpen(false);
    setEditorOpen(true);
  }

  function openEditExisting(c: Campaign) {
    setEditing(c);
    setEditorOpen(true);
  }

  return (
    <Layout>
      <PageHeader
        title="Growth Engine"
        subtitle="Run win-back, birthday, festival and referral campaigns across WhatsApp, SMS, email, push and QR banners."
        actions={
          <Button onClick={() => setPickerOpen(true)} data-testid="button-new-campaign">
            <Plus className="w-4 h-4 mr-2" /> New campaign
          </Button>
        }
      />

      {/* Status tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatTile label="Total" value={analyticsQ.data?.total ?? 0} icon={Megaphone} />
        {STATUSES.map(s => (
          <StatTile
            key={s}
            label={STATUS_META[s].label}
            value={analyticsQ.data?.byStatus?.[s] ?? 0}
            icon={STATUS_META[s].icon}
            onClick={() => { setTab("campaigns"); setFilters(f => ({ ...f, status: s })); }}
          />
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="campaigns"><Megaphone className="w-4 h-4 mr-2" />Campaigns</TabsTrigger>
          <TabsTrigger value="analytics"><BarChart3 className="w-4 h-4 mr-2" />Analytics</TabsTrigger>
          <TabsTrigger value="logs"><ScrollText className="w-4 h-4 mr-2" />Activity log</TabsTrigger>
        </TabsList>

        {/* ───────── Campaigns ───────── */}
        <TabsContent value="campaigns" className="space-y-4 mt-4">
          <Card>
            <CardContent className="p-4 flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search campaigns…"
                  value={filters.q}
                  onChange={e => setFilters({ ...filters, q: e.target.value })}
                  data-testid="input-search"
                />
              </div>
              <FilterSelect label="Status" value={filters.status} onChange={v => setFilters({ ...filters, status: v })}
                options={[{ value: "all", label: "All statuses" }, ...STATUSES.map(s => ({ value: s, label: STATUS_META[s].label }))]} />
              <FilterSelect label="Channel" value={filters.channel} onChange={v => setFilters({ ...filters, channel: v })}
                options={[{ value: "all", label: "All channels" }, ...CHANNELS.map(c => ({ value: c, label: CHANNEL_META[c].label }))]} />
              <FilterSelect label="Type" value={filters.type} onChange={v => setFilters({ ...filters, type: v })}
                options={[{ value: "all", label: "All types" }, ...TEMPLATES.map(t => ({ value: t.type, label: t.label }))]} />
              {(filters.status !== "all" || filters.channel !== "all" || filters.type !== "all" || filters.q) && (
                <Button variant="ghost" size="sm" onClick={() => setFilters({ status: "all", channel: "all", type: "all", q: "" })}>
                  Clear
                </Button>
              )}
            </CardContent>
          </Card>

          {campaignsQ.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !campaignsQ.data || campaignsQ.data.length === 0 ? (
            <EmptyState onCreate={() => setPickerOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {campaignsQ.data.map(c => (
                <CampaignCard key={c.id} c={c} onOpen={() => setDetailId(c.id)} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ───────── Analytics ───────── */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BreakdownCard title="By channel" icon={MegaIcon} data={analyticsQ.data?.byChannel ?? {}}
              labelFor={(k) => CHANNEL_META[k as Channel]?.label ?? k} />
            <BreakdownCard title="By status" icon={Clock} data={analyticsQ.data?.byStatus ?? {}}
              labelFor={(k) => STATUS_META[k as Status]?.label ?? k} />
          </div>
          <BreakdownCard title="By type" icon={Sparkles} data={analyticsQ.data?.byType ?? {}}
            labelFor={(k) => templateFor(k)?.label ?? k} />
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4" />Calendar &amp; ROI report</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              A full visual calendar and per-campaign ROI report are planned for Phase 2.
              For now, use the Campaigns tab to filter by scheduled date and channel.
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────── Logs ───────── */}
        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
            <CardContent className="p-0">
              {logsQ.isLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : !logsQ.data || logsQ.data.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">No activity yet.</div>
              ) : (
                <ul className="divide-y">
                  {logsQ.data.map(l => (
                    <li key={l.id} className="p-3 flex items-center gap-3 text-sm">
                      <Badge variant="secondary" className="font-mono text-xs">{l.event}</Badge>
                      <span className="text-muted-foreground">campaign #{l.campaignId}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{formatDate(l.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ───────── Template picker ───────── */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose a campaign template</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TEMPLATES.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.type}
                  onClick={() => openTemplate(t.type)}
                  className="text-left p-4 rounded-lg border hover-elevate active-elevate-2 transition"
                  data-testid={`template-${t.type}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-5 h-5 text-primary" />
                    <span className="font-medium">{t.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{t.blurb}</p>
                  <Badge variant="outline" className="mt-2 text-[10px]">{CHANNEL_META[t.defaultChannel].label}</Badge>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ───────── Editor ───────── */}
      <Dialog open={editorOpen} onOpenChange={(o) => { if (!o) { setEditorOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit campaign" : "New campaign"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <CampaignEditor
              campaign={editing}
              onChange={setEditing}
              onSave={() => saveMut.mutate(editing)}
              saving={saveMut.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ───────── Detail ───────── */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailQ.data ? (
            <CampaignDetail
              data={detailQ.data}
              onEdit={() => { openEditExisting(detailQ.data!.campaign); setDetailId(null); }}
              onStatus={(s) => statusMut.mutate({ id: detailQ.data!.campaign.id, status: s })}
              onDelete={() => {
                if (confirm("Delete this campaign? This cannot be undone.")) {
                  deleteMut.mutate(detailQ.data!.campaign.id);
                }
              }}
              busy={statusMut.isPending || deleteMut.isPending}
            />
          ) : (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

// ─────────────────────── helpers ───────────────────────

function StatTile({ label, value, icon: Icon, onClick }: { label: string; value: number; icon: typeof Megaphone; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "text-left rounded-lg border bg-card p-3",
        onClick && "hover-elevate active-elevate-2 cursor-pointer",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[170px]" data-testid={`select-${label.toLowerCase()}`}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <Megaphone className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-medium mb-1">No campaigns yet</h3>
        <p className="text-sm text-muted-foreground mb-4">Pick a template to draft your first win-back or festival campaign.</p>
        <Button onClick={onCreate}><Plus className="w-4 h-4 mr-2" />New campaign</Button>
      </CardContent>
    </Card>
  );
}

function CampaignCard({ c, onOpen }: { c: Campaign; onOpen: () => void }) {
  const tpl = templateFor(c.type);
  const Icon = tpl?.icon ?? Megaphone;
  const ChannelIcon = CHANNEL_META[c.channel]?.icon ?? MessageSquare;
  const StatusIcon = STATUS_META[c.status]?.icon ?? Clock;
  return (
    <button
      onClick={onOpen}
      className="text-left rounded-lg border bg-card p-4 hover-elevate active-elevate-2"
      data-testid={`campaign-${c.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium truncate">{c.name}</h3>
            <Badge className={cn("text-xs gap-1", STATUS_META[c.status]?.tone)}>
              <StatusIcon className="w-3 h-3" />{STATUS_META[c.status]?.label}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1"><ChannelIcon className="w-3 h-3" />{CHANNEL_META[c.channel]?.label}</span>
            <span>•</span>
            <span>{tpl?.label ?? c.type}</span>
            {c.scheduledAt && (<><span>•</span><span>📅 {formatDate(c.scheduledAt)}</span></>)}
          </div>
          {c.content?.body && (
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{c.content.body}</p>
          )}
        </div>
      </div>
    </button>
  );
}

function CampaignEditor({ campaign, onChange, onSave, saving }: {
  campaign: Partial<Campaign>; onChange: (c: Partial<Campaign>) => void; onSave: () => void; saving: boolean;
}) {
  const content = campaign.content ?? {};
  function patchContent(p: Partial<Campaign["content"]>) {
    onChange({ ...campaign, content: { ...content, ...p } });
  }
  return (
    <div className="space-y-4">
      <Field label="Campaign name">
        <Input value={campaign.name ?? ""} onChange={e => onChange({ ...campaign, name: e.target.value })} data-testid="input-name" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={campaign.type ?? ""} onValueChange={v => onChange({ ...campaign, type: v })}>
            <SelectTrigger data-testid="select-edit-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TEMPLATES.map(t => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Channel">
          <Select value={campaign.channel ?? ""} onValueChange={v => onChange({ ...campaign, channel: v as Channel })}>
            <SelectTrigger data-testid="select-edit-channel"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNELS.map(c => <SelectItem key={c} value={c}>{CHANNEL_META[c].label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {campaign.channel === "whatsapp" && <WhatsAppProviderBanner />}
      {(campaign.channel === "email" || campaign.channel === "push") && (
        <Field label="Subject / title">
          <Input value={content.subject ?? ""} onChange={e => patchContent({ subject: e.target.value })} data-testid="input-subject" />
        </Field>
      )}
      <Field label="Message body" hint="Use {{name}}, {{festival}}, {{item}}, {{code}}, {{link}}, {{review_link}} as placeholders.">
        <Textarea
          rows={5}
          value={content.body ?? ""}
          onChange={e => patchContent({ body: e.target.value })}
          data-testid="input-body"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CTA text (optional)">
          <Input value={content.ctaText ?? ""} onChange={e => patchContent({ ctaText: e.target.value })} placeholder="Order now" />
        </Field>
        <Field label="CTA link (optional)">
          <Input value={content.ctaUrl ?? ""} onChange={e => patchContent({ ctaUrl: e.target.value })} placeholder="https://…" />
        </Field>
      </div>
      <Field label="Schedule (optional)" hint="Leave blank to keep as draft.">
        <Input
          type="datetime-local"
          value={campaign.scheduledAt ? new Date(campaign.scheduledAt).toISOString().slice(0, 16) : ""}
          onChange={e => onChange({ ...campaign, scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
          data-testid="input-scheduled"
        />
      </Field>
      <DialogFooter>
        <Button onClick={onSave} disabled={saving || !campaign.name?.trim()} data-testid="button-save">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {campaign.id ? "Save changes" : "Save as draft"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function CampaignDetail({ data, onEdit, onStatus, onDelete, busy }: {
  data: { campaign: Campaign; logs: LogRow[] };
  onEdit: () => void;
  onStatus: (s: Status) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const c = data.campaign;
  const tpl = templateFor(c.type);
  const Icon = tpl?.icon ?? Megaphone;
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          {c.name}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={cn("gap-1", STATUS_META[c.status]?.tone)}>{STATUS_META[c.status]?.label}</Badge>
          <Badge variant="outline">{CHANNEL_META[c.channel]?.label}</Badge>
          <Badge variant="outline">{tpl?.label ?? c.type}</Badge>
          {c.scheduledAt && <Badge variant="outline">📅 {formatDate(c.scheduledAt)}</Badge>}
        </div>

        {c.content?.subject && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Subject</div>
            <div className="text-sm">{c.content.subject}</div>
          </div>
        )}
        {c.content?.body && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Message</div>
            <div className="text-sm whitespace-pre-wrap rounded border p-3 bg-muted/30">{c.content.body}</div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="w-4 h-4 mr-1" />Edit</Button>
          {c.status === "draft" && (
            <Button size="sm" disabled={busy} onClick={() => onStatus("scheduled")}>
              <Clock className="w-4 h-4 mr-1" />Mark scheduled
            </Button>
          )}
          {c.status === "scheduled" && (
            <>
              <Button size="sm" disabled={busy} onClick={() => onStatus("sent")}><Send className="w-4 h-4 mr-1" />Mark sent</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus("paused")}><Pause className="w-4 h-4 mr-1" />Pause</Button>
            </>
          )}
          {c.status === "paused" && (
            <Button size="sm" disabled={busy} onClick={() => onStatus("scheduled")}><Play className="w-4 h-4 mr-1" />Resume</Button>
          )}
          {c.status === "sent" && (
            <Button size="sm" disabled={busy} onClick={() => onStatus("completed")}><CheckCircle2 className="w-4 h-4 mr-1" />Complete</Button>
          )}
          <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete} className="ml-auto">
            <Trash2 className="w-4 h-4 mr-1" />Delete
          </Button>
        </div>

        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Activity</div>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {data.logs.length === 0 ? (
              <li className="text-sm text-muted-foreground">No activity yet.</li>
            ) : data.logs.map(l => (
              <li key={l.id} className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" className="font-mono text-[10px]">{l.event}</Badge>
                <span className="text-xs text-muted-foreground ml-auto">{formatDate(l.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function BreakdownCard({ title, icon: Icon, data, labelFor }: {
  title: string; icon: typeof Megaphone; data: Record<string, number>; labelFor: (k: string) => string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Icon className="w-4 h-4" />{title}</CardTitle></CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <div className="text-sm text-muted-foreground">No data yet.</div>
        ) : (
          <div className="space-y-2">
            {entries.map(([k, v]) => (
              <div key={k} className="flex items-center gap-3">
                <span className="text-sm w-40 truncate">{labelFor(k)}</span>
                <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${(v / max) * 100}%` }} />
                </div>
                <span className="text-sm font-medium w-10 text-right">{v}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WhatsAppProviderBanner() {
  const rid = useRestaurantId();
  type ProviderInfo = { providerType: "cloud_api" | "web_qr" | "disabled" };
  type SessionInfo = { session: { status: string } | null };
  const provider = useQuery<ProviderInfo>({
    queryKey: ["wa-provider", rid],
    queryFn: () => apiGet<ProviderInfo>(`/restaurants/${rid}/whatsapp/provider-settings`),
    enabled: !!rid,
  });
  const session = useQuery<SessionInfo>({
    queryKey: ["wa-web-qr-status", rid],
    queryFn: () => apiGet<SessionInfo>(`/restaurants/${rid}/whatsapp/web-qr/status`),
    enabled: !!rid && provider.data?.providerType === "web_qr",
    refetchInterval: 10000,
  });
  if (!provider.data) return null;
  const p = provider.data.providerType;
  if (p === "disabled") {
    return <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200 text-xs p-2.5">WhatsApp is disabled for this restaurant. Enable a provider in Settings → WhatsApp before scheduling this campaign.</div>;
  }
  if (p === "cloud_api") {
    return <div className="rounded-md border border-border bg-muted/30 text-xs p-2.5">Provider: <strong>Meta Cloud API</strong> — campaigns use approved templates and respect plan monthly limits.</div>;
  }
  const status = session.data?.session?.status;
  const connected = status === "connected";
  return (
    <div className={`rounded-md border text-xs p-2.5 ${connected ? "border-border bg-muted/30" : "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200"}`}>
      Provider: <strong>WhatsApp Web QR</strong> — {connected
        ? "session is connected. Campaign will send with safe-send caps and quiet hours applied."
        : `session is "${status ?? "disconnected"}". Campaign sends will be paused until the QR session reconnects (Settings → WhatsApp).`}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
