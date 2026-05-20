import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Megaphone, Plus, Search, Calendar, BarChart3, ScrollText, Trash2, Pencil,
  Play, Pause, Send, CheckCircle2, Clock, MessageSquare, Mail, Smartphone,
  Bell, QrCode, Sparkles, Gift, Cake, Heart, UserX, Star, RotateCcw, PartyPopper,
  CloudRain, Tag, Users, Ticket, Share2, ThumbsUp, Loader2, Target, Layers,
  ArrowLeft, ArrowRight, FlaskConical, Eye, X, Repeat, AlertTriangle, Plus as PlusIcon,
  TrendingUp, DollarSign, CheckCircle, XCircle, CircleSlash, Settings2,
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─────────── Types ───────────
type Status = "draft" | "scheduled" | "sending" | "sent" | "paused" | "completed" | "cancelled";
type Channel = "whatsapp" | "sms" | "email" | "push" | "qr_banner";
type Goal = "acquisition" | "retention" | "win_back" | "loyalty" | "promotion" | "announcement" | "birthday" | "anniversary" | "review" | "feedback" | "abandoned_cart" | "festival";
type ScheduleKind = "now" | "scheduled" | "recurring";

type StepContent = {
  subject?: string; body?: string; html?: string; title?: string;
  ctaText?: string; ctaUrl?: string; imageUrl?: string;
};

type Step = {
  id?: number; order: number; channel: Channel;
  templateKey?: string | null; templateId?: number | null;
  content: StepContent; delayMinutes: number; waitForEvent?: string | null;
};

type Audience = {
  customerIds?: number[];
  segment?: "all" | "new" | "repeat" | "vip" | "inactive" | "birthday" | "anniversary" | "high_value" | "custom";
  pushAudience?: "all" | "marketing" | "order_updates";
  rules?: {
    minTotalOrders?: number; maxTotalOrders?: number; minTotalSpent?: number;
    inactiveDays?: number; activeWithinDays?: number; birthdayThisMonth?: boolean;
    requireEmail?: boolean; requirePhone?: boolean;
    requireWhatsAppOptIn?: boolean; requireEmailOptIn?: boolean;
    excludeIds?: number[];
  };
  limit?: number;
};

type Campaign = {
  id: number;
  restaurantId: number;
  name: string;
  type: string;
  channel: Channel;
  status: Status;
  goal: Goal;
  isOmnichannel: boolean;
  channels: Array<{ channel: string; order: number; templateKey?: string }>;
  audience: Audience;
  content: StepContent;
  stats: Record<string, number>;
  scheduleKind: ScheduleKind;
  recurrence?: { frequency?: "daily"|"weekly"|"monthly"; hour?: number; minute?: number; until?: string } | null;
  timezone: string;
  attributionWindowHours: number;
  scheduledAt: string | null;
  sentAt: string | null;
  pausedAt: string | null;
  cancelledAt: string | null;
  lastDispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PlanInfo = {
  flags: { sms: boolean; whatsapp: boolean; email: boolean; push: boolean; omnichannel: boolean; ai: boolean; advancedSegments: boolean; recurring: boolean };
  limits: { monthly: number; audience: number; recurring: number };
  usage: { monthly: number; recurring: number };
};

type AnalyticsOverview = {
  total: number;
  byStatus: Partial<Record<Status, number>>;
  byChannel: Partial<Record<Channel, number>>;
  byType: Record<string, number>;
  byGoal: Record<string, number>;
  sends: { sent?: number; converted?: number; failed?: number };
};

type CampaignAnalytics = {
  funnel: { sent: number; failed: number; skipped: number; converted: number };
  revenue: number;
  byChannel: Record<string, { sent: number; failed: number; converted: number }>;
  timeline: Array<{ event: string; channel: string | null; at: string; customerId: number | null; reason: string | null }>;
  recipients: Array<{ customerId: number | null; channel: string | null; status: string; sentAt: string; reason: string | null }>;
};

type Preview = {
  total: number;
  reachable: { email: number; sms: number; whatsapp: number; push?: number };
  audienceKind?: "customers" | "subscribers";
  sample: Array<{ id: number; name: string; email: string | null; phone: string | null; subtitle?: string | null }>;
};

// ─────────── Catalog ───────────
const GOALS: Array<{ key: Goal; label: string; blurb: string; icon: typeof Target; defaults: { type: string; channels: Channel[] } }> = [
  { key: "win_back",      label: "Win back lapsed guests", blurb: "Re-engage customers who haven't visited in a while", icon: RotateCcw, defaults: { type: "win_back", channels: ["whatsapp", "email"] } },
  { key: "retention",     label: "Drive repeat orders",    blurb: "Reward and remind your regulars",                    icon: Repeat,    defaults: { type: "repeat_order", channels: ["whatsapp"] } },
  { key: "acquisition",   label: "Attract new customers",  blurb: "Welcome first-time guests with an offer",            icon: Sparkles,  defaults: { type: "first_order", channels: ["email", "push"] } },
  { key: "birthday",      label: "Birthday wishes",        blurb: "Send a treat on their birthday",                     icon: Cake,      defaults: { type: "birthday", channels: ["whatsapp"] } },
  { key: "anniversary",   label: "Anniversary",            blurb: "Celebrate milestone visits",                         icon: Heart,     defaults: { type: "anniversary", channels: ["email"] } },
  { key: "promotion",     label: "Promote an item / offer", blurb: "Push a dish, combo or limited offer",               icon: Tag,       defaults: { type: "item_specific", channels: ["whatsapp", "sms"] } },
  { key: "festival",      label: "Festival or event",      blurb: "Tie a campaign to a date or festival",               icon: PartyPopper, defaults: { type: "festival", channels: ["email", "whatsapp"] } },
  { key: "review",        label: "Ask for a review",       blurb: "Nudge happy diners for a Google review",             icon: Star,      defaults: { type: "review_booster", channels: ["sms"] } },
  { key: "loyalty",       label: "Loyalty announcement",   blurb: "Tell members about new rewards",                     icon: Gift,      defaults: { type: "loyalty", channels: ["email", "push"] } },
  { key: "announcement",  label: "General announcement",   blurb: "A one-off broadcast",                                icon: Megaphone, defaults: { type: "broadcast", channels: ["email"] } },
  { key: "abandoned_cart",label: "Recover abandoned carts", blurb: "Nudge customers who didn't check out",              icon: ThumbsUp,  defaults: { type: "win_back", channels: ["whatsapp"] } },
  { key: "feedback",      label: "Collect feedback",       blurb: "Ask a recent guest how it went",                     icon: MessageSquare, defaults: { type: "review_booster", channels: ["email"] } },
];

const CHANNEL_META: Record<Channel, { label: string; icon: typeof MessageSquare; flagKey: keyof PlanInfo["flags"] | null }> = {
  whatsapp:  { label: "WhatsApp",      icon: MessageSquare, flagKey: "whatsapp" },
  sms:       { label: "SMS",           icon: Smartphone,    flagKey: "sms" },
  email:     { label: "Email",         icon: Mail,          flagKey: "email" },
  push:      { label: "Web Push",      icon: Bell,          flagKey: "push" },
  qr_banner: { label: "QR Banner",     icon: QrCode,        flagKey: null },
};

const STATUS_META: Record<Status, { label: string; tone: string }> = {
  draft:     { label: "Draft",     tone: "bg-muted text-muted-foreground" },
  scheduled: { label: "Scheduled", tone: "bg-blue-100 text-blue-700" },
  sending:   { label: "Sending",   tone: "bg-amber-100 text-amber-800" },
  sent:      { label: "Sent",      tone: "bg-green-100 text-green-700" },
  paused:    { label: "Paused",    tone: "bg-amber-100 text-amber-700" },
  completed: { label: "Completed", tone: "bg-purple-100 text-purple-700" },
  cancelled: { label: "Cancelled", tone: "bg-rose-100 text-rose-700" },
};

const SEGMENTS = [
  { key: "all" as const,        label: "Everyone",          blurb: "All active customers" },
  { key: "new" as const,        label: "New customers",     blurb: "Ordered once or never" },
  { key: "repeat" as const,     label: "Repeat customers",  blurb: "Ordered 2+ times" },
  { key: "vip" as const,        label: "VIP customers",     blurb: "Tagged as VIP" },
  { key: "high_value" as const, label: "High value",        blurb: "Spent ₹5,000 or more" },
  { key: "inactive" as const,   label: "Inactive (60+ days)", blurb: "Haven't ordered recently" },
  { key: "birthday" as const,   label: "Birthday this month", blurb: "Birthday in current month" },
  { key: "anniversary" as const,label: "Anniversary this month", blurb: "Anniversary in current month" },
  { key: "custom" as const,     label: "Custom",            blurb: "Build your own from rules" },
];

const TEMPLATE_LIBRARY: Array<{ key: string; goal: Goal; channel: Channel; subject: string; body: string }> = [
  { key: "winback_whatsapp", goal: "win_back",    channel: "whatsapp", subject: "We miss you!",            body: "Hey {{name}}, we miss you at {{restaurant}}! Come back for 15% off your next order." },
  { key: "winback_email",    goal: "win_back",    channel: "email",    subject: "We've missed you",        body: "Hi {{name}},\n\nIt's been a while since your last visit to {{restaurant}}. Here's 15% off to welcome you back." },
  { key: "birthday_wa",      goal: "birthday",    channel: "whatsapp", subject: "Happy Birthday!",          body: "Happy birthday, {{first_name}}! 🎂 Enjoy a free dessert at {{restaurant}} this week." },
  { key: "anniversary_email",goal: "anniversary", channel: "email",    subject: "Happy anniversary!",       body: "Hi {{name}},\n\nIt's been a year since your first visit to {{restaurant}}. Here's 20% off your next meal." },
  { key: "firstorder_email", goal: "acquisition", channel: "email",    subject: "Welcome to {{restaurant}}!", body: "Welcome, {{first_name}}! Your first order gets 10% off. Use code WELCOME10." },
  { key: "review_sms",       goal: "review",      channel: "sms",      subject: "",                          body: "Thanks for dining at {{restaurant}}! Mind leaving a quick Google review? {{cta_url}}" },
  { key: "promo_sms",        goal: "promotion",   channel: "sms",      subject: "",                          body: "{{first_name}}, today only: 20% off at {{restaurant}}. Reply STOP to opt out." },
  { key: "festival_email",   goal: "festival",    channel: "email",    subject: "Special menu this weekend", body: "Hi {{name}}, celebrate with us — our festival menu is live. Book now: {{cta_url}}" },
  { key: "loyalty_push",     goal: "loyalty",     channel: "push",     subject: "New rewards unlocked",      body: "You've unlocked new rewards in your loyalty wallet — open the app to claim." },
  { key: "broadcast_email",  goal: "announcement",channel: "email",    subject: "An update from {{restaurant}}", body: "Hi {{name}},\n\nWe wanted to let you know that..." },
];

// ─────────── Helpers ───────────
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString() : "—";
const fmtNum = (n: number | undefined | null) => (n ?? 0).toLocaleString();

function makeEmptyAudience(): Audience { return { segment: "all", rules: {} }; }
function makeEmptyContent(): StepContent { return { subject: "", body: "", ctaText: "", ctaUrl: "" }; }
function makeEmptyDraft(): Partial<Campaign> {
  return {
    name: "", type: "custom", channel: "email", status: "draft", goal: "retention",
    isOmnichannel: false, channels: [], audience: makeEmptyAudience(),
    content: makeEmptyContent(), scheduleKind: "now", timezone: "Asia/Kolkata",
    attributionWindowHours: 72,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════════
export default function GrowthEnginePage() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"campaigns" | "analytics" | "logs" | "templates">("campaigns");
  const [filters, setFilters] = useState<{ status?: Status; channel?: Channel; goal?: Goal; q?: string }>({});
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardCampaign, setWizardCampaign] = useState<Campaign | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.status) p.set("status", filters.status);
    if (filters.channel) p.set("channel", filters.channel);
    if (filters.goal) p.set("goal", filters.goal);
    if (filters.q) p.set("q", filters.q);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [filters]);

  const campaignsQ = useQuery<Campaign[]>({
    queryKey: ["growth-campaigns", restaurantId, qs],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/campaigns${qs}`),
    enabled: !!restaurantId,
  });
  const analyticsQ = useQuery<AnalyticsOverview>({
    queryKey: ["growth-analytics", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/analytics`),
    enabled: !!restaurantId,
  });
  const logsQ = useQuery<Array<{ id: number; event: string; payload: Record<string, unknown> | null; createdAt: string; campaignId: number }>>({
    queryKey: ["growth-logs", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/logs?limit=100`),
    enabled: !!restaurantId && tab === "logs",
  });
  const planQ = useQuery<PlanInfo>({
    queryKey: ["growth-plan", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/plan-info`),
    enabled: !!restaurantId,
  });

  const openWizard = (c: Campaign | null) => { setWizardCampaign(c); setWizardOpen(true); };

  const startNew = async () => {
    try {
      const c = await apiPost<Campaign>(`/restaurants/${restaurantId}/growth/campaigns/draft`, {});
      openWizard(c);
      qc.invalidateQueries({ queryKey: ["growth-campaigns", restaurantId] });
    } catch (e) {
      toast({ title: "Could not create draft", description: (e as ApiError)?.message ?? "", variant: "destructive" });
    }
  };

  const deleteC = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/growth/campaigns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["growth-campaigns", restaurantId] }),
  });
  const pauseC = useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${restaurantId}/growth/campaigns/${id}/pause`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["growth-campaigns", restaurantId] }),
  });
  const resumeC = useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${restaurantId}/growth/campaigns/${id}/resume`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["growth-campaigns", restaurantId] }),
  });
  const cloneC = useMutation({
    mutationFn: (id: number) => apiPost<Campaign>(`/restaurants/${restaurantId}/growth/campaigns/${id}/clone`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["growth-campaigns", restaurantId] }),
  });

  const campaigns = campaignsQ.data ?? [];
  const overview = analyticsQ.data;

  return (
    <Layout>
      <PageHeader
        title="Growth Engine"
        subtitle="Omnichannel marketing: WhatsApp, SMS, Email and Web Push"
        actions={
          <Button onClick={startNew}>
            <Plus className="mr-2 h-4 w-4" /> New campaign
          </Button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatTile icon={<Megaphone className="h-5 w-5" />} label="Total" value={overview?.total ?? 0} />
        <StatTile icon={<Send className="h-5 w-5" />}      label="Messages sent" value={overview?.sends?.sent ?? 0} />
        <StatTile icon={<TrendingUp className="h-5 w-5" />} label="Conversions" value={overview?.sends?.converted ?? 0} />
        <StatTile icon={<XCircle className="h-5 w-5" />}    label="Failed" value={overview?.sends?.failed ?? 0} />
      </div>

      {planQ.data && <PlanInfoBanner info={planQ.data} />}

      <Tabs value={tab} onValueChange={v => setTab(v as never)}>
        <TabsList>
          <TabsTrigger value="campaigns"><Megaphone className="h-4 w-4 mr-2" />Campaigns</TabsTrigger>
          <TabsTrigger value="analytics"><BarChart3 className="h-4 w-4 mr-2" />Analytics</TabsTrigger>
          <TabsTrigger value="logs"><ScrollText className="h-4 w-4 mr-2" />Activity log</TabsTrigger>
          <TabsTrigger value="templates"><Layers className="h-4 w-4 mr-2" />Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="mt-4">
          <FilterBar filters={filters} setFilters={setFilters} />
          {campaignsQ.isLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : campaigns.length === 0 ? (
            <EmptyState onStart={startNew} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {campaigns.map(c => (
                <CampaignCard
                  key={c.id} campaign={c}
                  onEdit={() => openWizard(c)}
                  onOpen={() => setDetailId(c.id)}
                  onDelete={() => deleteC.mutate(c.id)}
                  onPause={() => pauseC.mutate(c.id)}
                  onResume={() => resumeC.mutate(c.id)}
                  onClone={() => cloneC.mutate(c.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <AnalyticsOverviewPanel overview={overview} />
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <LogsPanel rows={logsQ.data ?? []} loading={logsQ.isLoading} />
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <TemplatesPanel restaurantId={restaurantId} />
        </TabsContent>
      </Tabs>

      {wizardOpen && wizardCampaign && (
        <CampaignWizard
          campaign={wizardCampaign}
          planInfo={planQ.data}
          onClose={() => { setWizardOpen(false); setWizardCampaign(null); qc.invalidateQueries({ queryKey: ["growth-campaigns", restaurantId] }); }}
        />
      )}
      {detailId && (
        <CampaignDetail id={detailId} onClose={() => setDetailId(null)} />
      )}
    </Layout>
  );
}

// ─────────── Stat tile ───────────
function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card><CardContent className="p-4 flex items-center gap-3">
      <div className="p-2 bg-primary/10 rounded text-primary">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums truncate">{typeof value === "number" ? value.toLocaleString() : value}</div>
      </div>
    </CardContent></Card>
  );
}

function PlanInfoBanner({ info }: { info: PlanInfo }) {
  const missing: string[] = [];
  if (!info.flags.sms) missing.push("SMS");
  if (!info.flags.whatsapp) missing.push("WhatsApp");
  if (!info.flags.email) missing.push("Email");
  if (!info.flags.push) missing.push("Web Push");
  if (missing.length === 0) return null;
  return (
    <Card className="mb-4 border-amber-200 bg-amber-50/50">
      <CardContent className="p-3 text-sm flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
        <span>Some channels aren't included in your plan: <b>{missing.join(", ")}</b>. Upgrade to unlock them.</span>
      </CardContent>
    </Card>
  );
}

// ─────────── Filter bar ───────────
function FilterBar({ filters, setFilters }: { filters: { status?: Status; channel?: Channel; goal?: Goal; q?: string }; setFilters: (f: typeof filters) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative w-64 max-w-full">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8" placeholder="Search by name…"
          value={filters.q ?? ""} onChange={e => setFilters({ ...filters, q: e.target.value || undefined })}
        />
      </div>
      <Select value={filters.status ?? "all"} onValueChange={v => setFilters({ ...filters, status: v === "all" ? undefined : v as Status })}>
        <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {Object.entries(STATUS_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.channel ?? "all"} onValueChange={v => setFilters({ ...filters, channel: v === "all" ? undefined : v as Channel })}>
        <SelectTrigger className="w-36"><SelectValue placeholder="Channel" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All channels</SelectItem>
          {Object.entries(CHANNEL_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.goal ?? "all"} onValueChange={v => setFilters({ ...filters, goal: v === "all" ? undefined : v as Goal })}>
        <SelectTrigger className="w-44"><SelectValue placeholder="Goal" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All goals</SelectItem>
          {GOALS.map(g => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {(filters.status || filters.channel || filters.goal || filters.q) && (
        <Button variant="ghost" size="sm" onClick={() => setFilters({})}><X className="h-4 w-4 mr-1" />Clear</Button>
      )}
    </div>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <Card><CardContent className="p-12 text-center">
      <Megaphone className="h-12 w-12 mx-auto text-muted-foreground" />
      <h3 className="font-semibold mt-3">No campaigns yet</h3>
      <p className="text-sm text-muted-foreground mt-1">Start a new omnichannel marketing campaign to engage your customers.</p>
      <Button onClick={onStart} className="mt-4"><Plus className="h-4 w-4 mr-2" />Create your first campaign</Button>
    </CardContent></Card>
  );
}

// ─────────── Campaign card ───────────
function CampaignCard({ campaign, onEdit, onOpen, onDelete, onPause, onResume, onClone }: {
  campaign: Campaign;
  onEdit: () => void; onOpen: () => void; onDelete: () => void;
  onPause: () => void; onResume: () => void; onClone: () => void;
}) {
  const channelKey = campaign.channel as Channel;
  const channelMeta = CHANNEL_META[channelKey];
  const statusMeta = STATUS_META[campaign.status];
  const stats = campaign.stats || {};
  const ChannelIcon = channelMeta?.icon ?? Mail;
  return (
    <Card className="hover:shadow-md transition cursor-pointer" onClick={onOpen}>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{campaign.name}</CardTitle>
            <div className="flex items-center gap-1.5 mt-1">
              <Badge variant="secondary" className="text-xs"><ChannelIcon className="h-3 w-3 mr-1" />{campaign.isOmnichannel ? "Omnichannel" : channelMeta?.label}</Badge>
              <Badge className={cn("text-xs", statusMeta?.tone)}>{statusMeta?.label}</Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 text-sm text-muted-foreground space-y-1">
        <div className="flex justify-between"><span>Goal</span><span className="font-medium text-foreground">{GOALS.find(g => g.key === campaign.goal)?.label ?? campaign.goal}</span></div>
        <div className="flex justify-between"><span>Sent</span><span className="font-medium tabular-nums text-foreground">{fmtNum(stats.sent)}</span></div>
        <div className="flex justify-between"><span>Converted</span><span className="font-medium tabular-nums text-foreground">{fmtNum(stats.converted)}</span></div>
        {campaign.scheduledAt && (
          <div className="flex justify-between"><span>Scheduled</span><span className="text-foreground">{fmtDate(campaign.scheduledAt)}</span></div>
        )}
        <Separator className="my-2" />
        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
          {campaign.status === "scheduled" && (
            <Button size="sm" variant="ghost" onClick={onPause}><Pause className="h-4 w-4" /></Button>
          )}
          {campaign.status === "paused" && (
            <Button size="sm" variant="ghost" onClick={onResume}><Play className="h-4 w-4" /></Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClone}><Layers className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  WIZARD (7 steps)
// ═══════════════════════════════════════════════════════════════════
const WIZARD_STEPS = [
  { key: "goal",     label: "Goal",     icon: Target },
  { key: "channel",  label: "Channel",  icon: MessageSquare },
  { key: "template", label: "Template", icon: Layers },
  { key: "audience", label: "Audience", icon: Users },
  { key: "preview",  label: "Preview",  icon: Eye },
  { key: "test",     label: "Test",     icon: FlaskConical },
  { key: "schedule", label: "Schedule", icon: Calendar },
] as const;

function CampaignWizard({ campaign, planInfo, onClose }: { campaign: Campaign; planInfo: PlanInfo | undefined; onClose: () => void }) {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Campaign>({ ...campaign, ...{ audience: campaign.audience || makeEmptyAudience(), content: campaign.content || makeEmptyContent(), channels: campaign.channels || [] } });
  const [stepIdx, setStepIdx] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [testTo, setTestTo] = useState("");

  // Autosave on field change (debounced via mutation).
  const saveM = useMutation({
    mutationFn: (patch: Partial<Campaign>) => apiPatch<Campaign>(`/restaurants/${restaurantId}/growth/campaigns/${draft.id}`, patch),
    onSuccess: (data) => setDraft(prev => ({ ...prev, ...data })),
  });
  useEffect(() => {
    const t = setTimeout(() => {
      saveM.mutate({
        name: draft.name, type: draft.type, channel: draft.channel, goal: draft.goal,
        isOmnichannel: draft.isOmnichannel, channels: draft.channels,
        audience: draft.audience, content: draft.content,
        scheduleKind: draft.scheduleKind, recurrence: draft.recurrence ?? null,
        scheduledAt: draft.scheduledAt, timezone: draft.timezone,
        attributionWindowHours: draft.attributionWindowHours,
      });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify({
    n: draft.name, t: draft.type, c: draft.channel, g: draft.goal, omni: draft.isOmnichannel,
    chs: draft.channels, aud: draft.audience, ct: draft.content, sk: draft.scheduleKind,
    rec: draft.recurrence, sat: draft.scheduledAt, tz: draft.timezone, aw: draft.attributionWindowHours,
  })]);

  const launchM = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/growth/campaigns/${draft.id}/launch`, {}),
    onSuccess: () => {
      toast({ title: draft.scheduleKind === "now" ? "Campaign launched" : "Campaign scheduled" });
      qc.invalidateQueries({ queryKey: ["growth-campaigns", restaurantId] });
      onClose();
    },
    onError: (e: ApiError) => toast({ title: "Couldn't launch", description: e.message, variant: "destructive" }),
  });
  const testM = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/growth/campaigns/${draft.id}/test-send`, { to: testTo, channel: draft.channel }),
    onSuccess: (r: { status: string; reason?: string }) => toast({ title: r.status === "sent" ? "Test sent" : "Test " + r.status, description: r.reason }),
    onError: (e: ApiError) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  // When user lands on "preview" step, fetch preview audience.
  useEffect(() => {
    if (WIZARD_STEPS[stepIdx].key === "preview" || WIZARD_STEPS[stepIdx].key === "audience") {
      apiPost<Preview>(`/restaurants/${restaurantId}/growth/segments/preview`, { audience: draft.audience, channel: draft.channel })
        .then(setPreview).catch(() => setPreview(null));
    }
  }, [stepIdx, restaurantId, draft.audience, draft.channel]);

  const updateDraft = (patch: Partial<Campaign>) => setDraft(prev => ({ ...prev, ...patch }));
  const updateContent = (patch: StepContent) => setDraft(prev => ({ ...prev, content: { ...prev.content, ...patch } }));
  const updateAudience = (patch: Audience) => setDraft(prev => ({ ...prev, audience: { ...prev.audience, ...patch } }));

  const canAdvance = (() => {
    const k = WIZARD_STEPS[stepIdx].key;
    if (k === "goal") return Boolean(draft.goal && draft.name?.trim());
    if (k === "channel") return draft.isOmnichannel ? (draft.channels || []).length >= 1 : Boolean(draft.channel);
    if (k === "template") return Boolean(draft.content?.body?.trim() || draft.content?.subject?.trim());
    if (k === "audience") return Boolean(draft.audience?.segment || draft.audience?.customerIds?.length || draft.audience?.pushAudience);
    return true;
  })();

  const next = () => setStepIdx(i => Math.min(WIZARD_STEPS.length - 1, i + 1));
  const prev = () => setStepIdx(i => Math.max(0, i - 1));

  const currentStep = WIZARD_STEPS[stepIdx];

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[95vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            <span>{draft.name?.trim() || "New campaign"}</span>
            <Badge variant="outline" className="ml-2">{currentStep.label}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="px-6 py-3 border-b bg-muted/30 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {WIZARD_STEPS.map((s, i) => {
              const Icon = s.icon;
              const active = i === stepIdx;
              const done = i < stepIdx;
              return (
                <button
                  key={s.key}
                  onClick={() => setStepIdx(i)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition",
                    active && "bg-primary text-primary-foreground font-medium",
                    done && !active && "text-foreground",
                    !active && !done && "text-muted-foreground",
                  )}
                >
                  {done ? <CheckCircle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  <span className="hidden md:inline">{s.label}</span>
                  <span className="md:hidden">{i + 1}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_320px]">
          {/* Step body */}
          <div className="overflow-y-auto p-6">
            {currentStep.key === "goal" && <StepGoal draft={draft} updateDraft={updateDraft} />}
            {currentStep.key === "channel" && <StepChannel draft={draft} updateDraft={updateDraft} planInfo={planInfo} />}
            {currentStep.key === "template" && <StepTemplate draft={draft} updateContent={updateContent} />}
            {currentStep.key === "audience" && <StepAudience draft={draft} updateAudience={updateAudience} preview={preview} planInfo={planInfo} />}
            {currentStep.key === "preview" && <StepPreview draft={draft} preview={preview} />}
            {currentStep.key === "test" && <StepTest draft={draft} testTo={testTo} setTestTo={setTestTo} onSend={() => testM.mutate()} sending={testM.isPending} />}
            {currentStep.key === "schedule" && <StepSchedule draft={draft} updateDraft={updateDraft} planInfo={planInfo} />}
          </div>

          {/* Sticky summary rail */}
          <div className="border-l bg-muted/20 overflow-y-auto hidden lg:block">
            <SummaryRail draft={draft} preview={preview} />
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t bg-background flex sm:justify-between gap-2">
          <div className="text-xs text-muted-foreground flex items-center">
            {saveM.isPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving…</> : <><CheckCircle className="h-3 w-3 mr-1 text-green-600" />Auto-saved</>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            {stepIdx > 0 && <Button variant="outline" onClick={prev}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>}
            {stepIdx < WIZARD_STEPS.length - 1 && (
              <Button onClick={next} disabled={!canAdvance}>Next<ArrowRight className="h-4 w-4 ml-1" /></Button>
            )}
            {stepIdx === WIZARD_STEPS.length - 1 && (
              <Button onClick={() => launchM.mutate()} disabled={launchM.isPending}>
                {launchM.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Launching…</> : <><Send className="h-4 w-4 mr-1" />{draft.scheduleKind === "now" ? "Launch now" : "Schedule"}</>}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────── Step 1: Goal ───────────
function StepGoal({ draft, updateDraft }: { draft: Campaign; updateDraft: (p: Partial<Campaign>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Name & goal</h3>
        <p className="text-sm text-muted-foreground">Give the campaign a name and pick what you want to achieve.</p>
      </div>
      <div>
        <Label>Campaign name</Label>
        <Input value={draft.name} onChange={e => updateDraft({ name: e.target.value })} placeholder="e.g. December win-back" className="mt-1.5 max-w-md" />
      </div>
      <div>
        <Label className="mb-2 block">Pick a goal</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {GOALS.map(g => {
            const Icon = g.icon;
            const selected = draft.goal === g.key;
            return (
              <button
                key={g.key}
                onClick={() => updateDraft({ goal: g.key, type: g.defaults.type })}
                className={cn(
                  "text-left p-4 rounded-lg border transition",
                  selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                )}
              >
                <Icon className={cn("h-5 w-5 mb-2", selected ? "text-primary" : "text-muted-foreground")} />
                <div className="font-medium text-sm">{g.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{g.blurb}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────── Step 2: Channel ───────────
function StepChannel({ draft, updateDraft, planInfo }: { draft: Campaign; updateDraft: (p: Partial<Campaign>) => void; planInfo: PlanInfo | undefined }) {
  const flags = planInfo?.flags;
  const toggleChannel = (ch: Channel) => {
    const next = [...(draft.channels || [])];
    const ix = next.findIndex(x => x.channel === ch);
    if (ix >= 0) next.splice(ix, 1);
    else next.push({ channel: ch, order: next.length });
    updateDraft({ channels: next.map((x, i) => ({ ...x, order: i })) });
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Choose channel</h3>
        <p className="text-sm text-muted-foreground">Send on a single channel, or run an omnichannel sequence.</p>
      </div>
      <div className="flex items-center gap-3">
        <Switch checked={draft.isOmnichannel} onCheckedChange={v => updateDraft({ isOmnichannel: v, channels: v ? (draft.channels?.length ? draft.channels : [{ channel: draft.channel, order: 0 }]) : [] })} disabled={!flags?.omnichannel} />
        <div>
          <div className="text-sm font-medium">Omnichannel sequence</div>
          <div className="text-xs text-muted-foreground">{flags?.omnichannel ? "Send across multiple channels in sequence" : "Not available on your current plan"}</div>
        </div>
      </div>
      {!draft.isOmnichannel ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {(Object.keys(CHANNEL_META) as Channel[]).map(ch => {
            const meta = CHANNEL_META[ch];
            const Icon = meta.icon;
            const allowed = meta.flagKey ? Boolean(flags?.[meta.flagKey]) : true;
            const selected = draft.channel === ch;
            return (
              <button
                key={ch}
                onClick={() => allowed && updateDraft({ channel: ch })}
                disabled={!allowed}
                className={cn(
                  "p-4 rounded-lg border transition text-center",
                  selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                  !allowed && "opacity-50 cursor-not-allowed",
                )}
              >
                <Icon className={cn("h-6 w-6 mx-auto mb-2", selected ? "text-primary" : "text-muted-foreground")} />
                <div className="text-sm font-medium">{meta.label}</div>
                {!allowed && <div className="text-xs text-amber-600 mt-1">Upgrade</div>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Pick the channels to include. Steps run in the order you add them.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(Object.keys(CHANNEL_META) as Channel[]).map(ch => {
              const meta = CHANNEL_META[ch];
              const Icon = meta.icon;
              const allowed = meta.flagKey ? Boolean(flags?.[meta.flagKey]) : true;
              const chosen = (draft.channels ?? []).find(x => x.channel === ch);
              return (
                <button
                  key={ch}
                  onClick={() => allowed && toggleChannel(ch)}
                  disabled={!allowed}
                  className={cn(
                    "p-4 rounded-lg border transition text-center relative",
                    chosen ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                    !allowed && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {chosen && <Badge className="absolute -top-2 -right-2 px-1.5 py-0">{chosen.order + 1}</Badge>}
                  <Icon className={cn("h-6 w-6 mx-auto mb-2", chosen ? "text-primary" : "text-muted-foreground")} />
                  <div className="text-sm font-medium">{meta.label}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────── Step 3: Template ───────────
function StepTemplate({ draft, updateContent }: { draft: Campaign; updateContent: (p: StepContent) => void }) {
  const channel = draft.channel as Channel;
  const matching = TEMPLATE_LIBRARY.filter(t => t.channel === channel || t.goal === draft.goal);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Message content</h3>
        <p className="text-sm text-muted-foreground">Pick a template or write your own. Use <code className="text-xs bg-muted px-1 rounded">{`{{name}}`}</code>, <code className="text-xs bg-muted px-1 rounded">{`{{first_name}}`}</code>, <code className="text-xs bg-muted px-1 rounded">{`{{restaurant}}`}</code>, <code className="text-xs bg-muted px-1 rounded">{`{{cta_url}}`}</code>.</p>
      </div>

      {matching.length > 0 && (
        <div>
          <Label className="mb-2 block">Suggested templates</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {matching.slice(0, 6).map(t => (
              <button
                key={t.key}
                onClick={() => updateContent({ subject: t.subject, body: t.body })}
                className="text-left border rounded p-3 hover:border-primary/50"
              >
                <div className="text-sm font-medium truncate">{t.subject || t.key}</div>
                <div className="text-xs text-muted-foreground line-clamp-2">{t.body}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {(channel === "email" || channel === "push") && (
        <div>
          <Label>Subject / Title</Label>
          <Input value={draft.content?.subject ?? ""} onChange={e => updateContent({ subject: e.target.value })} className="mt-1.5" />
        </div>
      )}
      <div>
        <Label>Message body</Label>
        <Textarea
          value={draft.content?.body ?? ""}
          onChange={e => updateContent({ body: e.target.value })}
          rows={8}
          className="mt-1.5 font-mono text-sm"
          placeholder="Hey {{first_name}}, ..."
        />
        {channel === "sms" && (
          <div className="text-xs text-muted-foreground mt-1">{(draft.content?.body ?? "").length} chars · ~{Math.ceil((draft.content?.body ?? "").length / 160)} SMS segment(s)</div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>CTA text</Label>
          <Input value={draft.content?.ctaText ?? ""} onChange={e => updateContent({ ctaText: e.target.value })} className="mt-1.5" placeholder="Order now" />
        </div>
        <div>
          <Label>CTA URL</Label>
          <Input value={draft.content?.ctaUrl ?? ""} onChange={e => updateContent({ ctaUrl: e.target.value })} className="mt-1.5" placeholder="https://…" />
        </div>
      </div>
    </div>
  );
}

// ─────────── Step 4: Audience ───────────
function StepAudience({ draft, updateAudience, preview, planInfo }: { draft: Campaign; updateAudience: (p: Audience) => void; preview: Preview | null; planInfo: PlanInfo | undefined }) {
  const seg = draft.audience?.segment ?? "all";
  const rules = draft.audience?.rules ?? {};
  const isPush = draft.channel === "push" && !draft.isOmnichannel;

  if (isPush) {
    const pa = draft.audience?.pushAudience ?? "marketing";
    const PUSH_OPTIONS: Array<{ key: NonNullable<Audience["pushAudience"]>; label: string; blurb: string }> = [
      { key: "marketing",     label: "Marketing opt-in",       blurb: "Subscribers who agreed to marketing pushes (recommended)" },
      { key: "order_updates", label: "Order update opt-in",    blurb: "Subscribers who accept order / transactional pushes" },
      { key: "all",           label: "All active subscribers", blurb: "Every active Web Push subscription for this restaurant" },
    ];
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold">Choose Web Push subscribers</h3>
          <p className="text-sm text-muted-foreground">Web Push campaigns send to browser subscribers, not the customer list. Manage them in Settings → Web Push → Subscribers.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {PUSH_OPTIONS.map(o => (
            <button
              key={o.key}
              onClick={() => updateAudience({ pushAudience: o.key })}
              className={cn(
                "text-left p-3 border rounded transition",
                pa === o.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
              )}
            >
              <div className="text-sm font-medium">{o.label}</div>
              <div className="text-xs text-muted-foreground">{o.blurb}</div>
            </button>
          ))}
        </div>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm mb-2"><Bell className="h-4 w-4" />Estimated reach</div>
          {preview ? (
            <div className="grid grid-cols-2 gap-3 text-center">
              <Stat label="Subscribers" value={preview.total} />
              <Stat label="Reachable now" value={preview.reachable.push ?? preview.total} />
            </div>
          ) : <div className="text-sm text-muted-foreground">Calculating…</div>}
          {preview && preview.total === 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded mt-3">
              No active subscribers match this selector yet. Ask customers to enable browser notifications from your menu or order pages.
            </div>
          )}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Choose audience</h3>
        <p className="text-sm text-muted-foreground">Pick a preset segment or build a custom audience from rules.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {SEGMENTS.map(s => (
          <button
            key={s.key}
            onClick={() => updateAudience({ segment: s.key })}
            className={cn(
              "text-left p-3 border rounded transition",
              seg === s.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
            )}
          >
            <div className="text-sm font-medium">{s.label}</div>
            <div className="text-xs text-muted-foreground">{s.blurb}</div>
          </button>
        ))}
      </div>

      {seg === "custom" && (
        <Card><CardContent className="p-4 space-y-3">
          {!planInfo?.flags.advancedSegments && (
            <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded">Advanced segment builder requires a higher plan.</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Min orders</Label>
              <Input type="number" value={rules.minTotalOrders ?? ""} onChange={e => updateAudience({ rules: { ...rules, minTotalOrders: e.target.value ? Number(e.target.value) : undefined } })} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Max orders</Label>
              <Input type="number" value={rules.maxTotalOrders ?? ""} onChange={e => updateAudience({ rules: { ...rules, maxTotalOrders: e.target.value ? Number(e.target.value) : undefined } })} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Min total spent (₹)</Label>
              <Input type="number" value={rules.minTotalSpent ?? ""} onChange={e => updateAudience({ rules: { ...rules, minTotalSpent: e.target.value ? Number(e.target.value) : undefined } })} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Inactive for (days)</Label>
              <Input type="number" value={rules.inactiveDays ?? ""} onChange={e => updateAudience({ rules: { ...rules, inactiveDays: e.target.value ? Number(e.target.value) : undefined } })} className="mt-1" />
            </div>
          </div>
        </CardContent></Card>
      )}

      <Card><CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm mb-2"><Users className="h-4 w-4" />Estimated reach</div>
        {preview ? (
          <div className="grid grid-cols-4 gap-3 text-center">
            <Stat label="Total" value={preview.total} />
            <Stat label="Email" value={preview.reachable.email} />
            <Stat label="SMS" value={preview.reachable.sms} />
            <Stat label="WhatsApp" value={preview.reachable.whatsapp} />
          </div>
        ) : <div className="text-sm text-muted-foreground">Calculating…</div>}
        {planInfo && preview && preview.total > planInfo.limits.audience && (
          <div className="text-xs text-rose-600 mt-2">Audience exceeds plan limit of {planInfo.limits.audience.toLocaleString()}.</div>
        )}
      </CardContent></Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

// ─────────── Step 5: Preview ───────────
function StepPreview({ draft, preview }: { draft: Campaign; preview: Preview | null }) {
  const channel = draft.channel as Channel;
  const content = draft.content || {};
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Preview</h3>
        <p className="text-sm text-muted-foreground">This is how the first recipient will see the message.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs mb-2 block">Message preview ({CHANNEL_META[channel]?.label})</Label>
          <div className="border rounded-lg p-4 bg-card">
            {(channel === "email" || channel === "push") && content.subject && (
              <div className="font-semibold mb-2">{content.subject}</div>
            )}
            <div className="text-sm whitespace-pre-wrap">{(content.body || "").replace(/\{\{first_name\}\}/g, preview?.sample?.[0]?.name?.split(" ")[0] || "Friend").replace(/\{\{name\}\}/g, preview?.sample?.[0]?.name || "Friend")}</div>
            {content.ctaUrl && (
              <div className="mt-3"><Button size="sm">{content.ctaText || "Open"}</Button></div>
            )}
          </div>
        </div>
        <div>
          <Label className="text-xs mb-2 block">Sample recipients</Label>
          <ScrollArea className="h-64 border rounded">
            <div className="p-2 space-y-1">
              {(preview?.sample ?? []).map(s => (
                <div key={s.id} className="text-sm flex items-center justify-between border-b pb-1">
                  <span className="truncate">{s.name}</span>
                  <span className="text-xs text-muted-foreground truncate ml-2">{
                    preview?.audienceKind === "subscribers"
                      ? (s.subtitle || "Subscriber")
                      : (channel === "email" ? s.email : s.phone)
                  }</span>
                </div>
              ))}
              {(preview?.sample ?? []).length === 0 && <div className="text-sm text-muted-foreground p-3">No recipients yet — refine your audience.</div>}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

// ─────────── Step 6: Test ───────────
function StepTest({ draft, testTo, setTestTo, onSend, sending }: { draft: Campaign; testTo: string; setTestTo: (v: string) => void; onSend: () => void; sending: boolean }) {
  const channel = draft.channel;
  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h3 className="text-lg font-semibold">Send a test</h3>
        <p className="text-sm text-muted-foreground">We'll send one message to the {channel === "email" ? "email address" : "phone number"} below.</p>
      </div>
      <div>
        <Label>{channel === "email" ? "Email address" : "Phone number"}</Label>
        <Input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder={channel === "email" ? "you@example.com" : "+91 …"} className="mt-1.5" />
      </div>
      <Button onClick={onSend} disabled={!testTo || sending}>
        {sending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Sending…</> : <><FlaskConical className="h-4 w-4 mr-1" />Send test</>}
      </Button>
      <div className="text-xs text-muted-foreground">Test sends don't count towards your monthly quota or analytics.</div>
    </div>
  );
}

// ─────────── Step 7: Schedule ───────────
function StepSchedule({ draft, updateDraft, planInfo }: { draft: Campaign; updateDraft: (p: Partial<Campaign>) => void; planInfo: PlanInfo | undefined }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Schedule</h3>
        <p className="text-sm text-muted-foreground">Send now, schedule for later, or run on a recurring cadence.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
        {[
          { key: "now" as const, label: "Send now", blurb: "Launch immediately", icon: Send },
          { key: "scheduled" as const, label: "Schedule for later", blurb: "Pick a date and time", icon: Calendar },
          { key: "recurring" as const, label: "Recurring", blurb: "Repeat daily / weekly / monthly", icon: Repeat },
        ].map(opt => {
          const Icon = opt.icon;
          const selected = draft.scheduleKind === opt.key;
          const blocked = opt.key === "recurring" && planInfo && !planInfo.flags.recurring;
          return (
            <button
              key={opt.key}
              onClick={() => !blocked && updateDraft({ scheduleKind: opt.key })}
              className={cn(
                "text-left p-4 border rounded",
                selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                blocked && "opacity-50 cursor-not-allowed",
              )}
            >
              <Icon className={cn("h-5 w-5 mb-2", selected ? "text-primary" : "text-muted-foreground")} />
              <div className="font-medium text-sm">{opt.label}</div>
              <div className="text-xs text-muted-foreground">{opt.blurb}</div>
              {blocked && <div className="text-xs text-amber-600 mt-1">Upgrade required</div>}
            </button>
          );
        })}
      </div>

      {draft.scheduleKind === "scheduled" && (
        <div className="max-w-md">
          <Label>Send at</Label>
          <Input
            type="datetime-local"
            value={draft.scheduledAt ? new Date(draft.scheduledAt).toISOString().slice(0, 16) : ""}
            onChange={e => updateDraft({ scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
            className="mt-1.5"
          />
        </div>
      )}
      {draft.scheduleKind === "recurring" && (
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div>
            <Label>Frequency</Label>
            <Select value={draft.recurrence?.frequency ?? "weekly"} onValueChange={v => updateDraft({ recurrence: { ...(draft.recurrence ?? {}), frequency: v as "daily"|"weekly"|"monthly" } })}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>First send at</Label>
            <Input
              type="datetime-local"
              value={draft.scheduledAt ? new Date(draft.scheduledAt).toISOString().slice(0, 16) : ""}
              onChange={e => updateDraft({ scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
              className="mt-1.5"
            />
          </div>
        </div>
      )}

      <Card><CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium"><Settings2 className="h-4 w-4" />Attribution window</div>
        <p className="text-xs text-muted-foreground">Orders placed within this window after a send are attributed to the campaign.</p>
        <div className="flex items-center gap-2">
          <Input
            type="number" className="w-24"
            value={draft.attributionWindowHours}
            onChange={e => updateDraft({ attributionWindowHours: Number(e.target.value) || 72 })}
          />
          <span className="text-sm text-muted-foreground">hours</span>
        </div>
      </CardContent></Card>
    </div>
  );
}

// ─────────── Summary rail ───────────
function SummaryRail({ draft, preview }: { draft: Campaign; preview: Preview | null }) {
  const goal = GOALS.find(g => g.key === draft.goal);
  const channelMeta = CHANNEL_META[draft.channel as Channel];
  return (
    <div className="p-4 space-y-4 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Summary</div>
        <div className="font-semibold">{draft.name || "Untitled"}</div>
      </div>
      <Separator />
      <div className="space-y-2">
        <SummaryRow label="Goal" value={goal?.label ?? draft.goal} />
        <SummaryRow label="Channel" value={draft.isOmnichannel ? `Omnichannel (${(draft.channels ?? []).length})` : (channelMeta?.label ?? "—")} />
        <SummaryRow label="Audience" value={preview?.total ? `${preview.total.toLocaleString()} ${preview.audienceKind === "subscribers" ? "subscribers" : "customers"}` : (preview?.audienceKind === "subscribers" ? (draft.audience?.pushAudience ?? "—") : (draft.audience?.segment ?? "—"))} />
        <SummaryRow label="Schedule" value={draft.scheduleKind === "now" ? "Send now" : (draft.scheduleKind === "recurring" ? `${draft.recurrence?.frequency ?? "?"} recurring` : (draft.scheduledAt ? fmtDate(draft.scheduledAt) : "Not set"))} />
      </div>
      {(draft.content?.body || draft.content?.subject) && (
        <>
          <Separator />
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Content</div>
            {draft.content?.subject && <div className="font-medium text-sm mb-1 line-clamp-2">{draft.content.subject}</div>}
            <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">{draft.content?.body}</div>
          </div>
        </>
      )}
    </div>
  );
}
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-right text-xs font-medium truncate max-w-[180px]">{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  DETAIL DIALOG
// ═══════════════════════════════════════════════════════════════════
function CampaignDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const restaurantId = useRestaurantId();
  const analyticsQ = useQuery<CampaignAnalytics>({
    queryKey: ["growth-campaign-analytics", id],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/campaigns/${id}/analytics`),
    enabled: !!restaurantId,
  });
  const campaignQ = useQuery<{ campaign: Campaign; steps: Step[]; logs: Array<{ id: number; event: string; createdAt: string }> }>({
    queryKey: ["growth-campaign-detail", id],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/campaigns/${id}`),
    enabled: !!restaurantId,
  });

  const a = analyticsQ.data;
  const c = campaignQ.data?.campaign;
  const funnelData = a ? [
    { name: "Sent", value: a.funnel.sent },
    { name: "Failed", value: a.funnel.failed },
    { name: "Skipped", value: a.funnel.skipped },
    { name: "Converted", value: a.funnel.converted },
  ] : [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{c?.name ?? "Campaign"}</DialogTitle>
        </DialogHeader>
        {!a || !c ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile icon={<Send className="h-5 w-5" />} label="Sent" value={a.funnel.sent} />
              <StatTile icon={<XCircle className="h-5 w-5" />} label="Failed" value={a.funnel.failed} />
              <StatTile icon={<TrendingUp className="h-5 w-5" />} label="Converted" value={a.funnel.converted} />
              <StatTile icon={<DollarSign className="h-5 w-5" />} label="Revenue (₹)" value={a.revenue.toFixed(2)} />
            </div>
            <Card><CardHeader><CardTitle className="text-base">Funnel</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card><CardHeader><CardTitle className="text-base">Recipients</CardTitle></CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-64">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground bg-muted/50">
                      <tr><th className="text-left px-3 py-2">Customer</th><th className="text-left px-3 py-2">Channel</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Reason</th></tr>
                    </thead>
                    <tbody>
                      {a.recipients.map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5">#{r.customerId ?? "—"}</td>
                          <td className="px-3 py-1.5">{r.channel ?? "—"}</td>
                          <td className="px-3 py-1.5"><Badge variant="outline" className="text-xs">{r.status}</Badge></td>
                          <td className="px-3 py-1.5 text-xs">{fmtDate(r.sentAt)}</td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.reason ?? ""}</td>
                        </tr>
                      ))}
                      {a.recipients.length === 0 && <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No recipients yet</td></tr>}
                    </tbody>
                  </table>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card><CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <div className="space-y-2">
                    {a.timeline.map((t, i) => (
                      <div key={i} className="flex items-center justify-between border-b pb-1 text-sm">
                        <span><Badge variant="outline" className="text-xs mr-2">{t.event}</Badge>{t.channel && <span className="text-xs text-muted-foreground">{t.channel}</span>}</span>
                        <span className="text-xs text-muted-foreground">{fmtDate(t.at)}</span>
                      </div>
                    ))}
                    {a.timeline.length === 0 && <div className="text-sm text-muted-foreground p-3">No activity yet</div>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  ANALYTICS OVERVIEW PANEL
// ═══════════════════════════════════════════════════════════════════
function AnalyticsOverviewPanel({ overview }: { overview: AnalyticsOverview | undefined }) {
  if (!overview) return <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const byChannelData = Object.entries(overview.byChannel).map(([k, v]) => ({ name: CHANNEL_META[k as Channel]?.label ?? k, value: v ?? 0 }));
  const byGoalData = Object.entries(overview.byGoal).map(([k, v]) => ({ name: GOALS.find(g => g.key === k)?.label ?? k, value: v ?? 0 }));
  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card><CardHeader><CardTitle className="text-base">Campaigns by channel</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byChannelData}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><RTooltip />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="text-base">Campaigns by goal</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={byGoalData} dataKey="value" nameKey="name" outerRadius={80} label>
                {byGoalData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <RTooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────── Logs panel ───────────
function LogsPanel({ rows, loading }: { rows: Array<{ id: number; event: string; payload: Record<string, unknown> | null; createdAt: string; campaignId: number }>; loading: boolean }) {
  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  return (
    <Card><CardContent className="p-0">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground bg-muted/50">
          <tr><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Campaign</th><th className="text-left px-3 py-2">Event</th><th className="text-left px-3 py-2">Details</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t">
              <td className="px-3 py-1.5 text-xs">{fmtDate(r.createdAt)}</td>
              <td className="px-3 py-1.5">#{r.campaignId}</td>
              <td className="px-3 py-1.5"><Badge variant="outline" className="text-xs">{r.event}</Badge></td>
              <td className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-md">{r.payload ? JSON.stringify(r.payload) : ""}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="text-center text-muted-foreground py-6">No activity</td></tr>}
        </tbody>
      </table>
    </CardContent></Card>
  );
}

// ─────────── Templates panel ───────────
function TemplatesPanel({ restaurantId }: { restaurantId: number }) {
  const [channel, setChannel] = useState<"sms" | "whatsapp" | "push">("sms");
  const { toast } = useToast();
  const qc = useQueryClient();
  const tmplQ = useQuery<Array<{ id: number; key: string; name: string; category: string; body: string; title?: string }>>({
    queryKey: ["growth-tmpl", restaurantId, channel],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/growth/templates/${channel}`),
    enabled: !!restaurantId,
  });
  const createM = useMutation({
    mutationFn: (body: { name: string; body: string; title?: string }) => apiPost(`/restaurants/${restaurantId}/growth/templates/${channel}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["growth-tmpl", restaurantId, channel] }); toast({ title: "Template saved" }); },
  });
  const deleteM = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/growth/templates/${channel}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["growth-tmpl", restaurantId, channel] }),
  });
  const [draft, setDraft] = useState({ name: "", body: "", title: "" });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["sms", "whatsapp", "push"] as const).map(ch => (
          <Button key={ch} variant={channel === ch ? "default" : "outline"} size="sm" onClick={() => setChannel(ch)}>
            {CHANNEL_META[ch].label}
          </Button>
        ))}
      </div>
      <Card><CardHeader><CardTitle className="text-base">New template</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          {channel === "push" && <Input placeholder="Title" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />}
          <Textarea placeholder="Body…" rows={4} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
          <Button onClick={() => { if (draft.name && draft.body) { createM.mutate(draft); setDraft({ name: "", body: "", title: "" }); } }} disabled={!draft.name || !draft.body}>
            <PlusIcon className="h-4 w-4 mr-1" />Save template
          </Button>
        </CardContent>
      </Card>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/50"><tr><th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Body</th><th></th></tr></thead>
          <tbody>
            {(tmplQ.data ?? []).map(t => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-1.5">{t.name}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-md">{t.body}</td>
                <td className="px-3 py-1.5 text-right"><Button size="sm" variant="ghost" onClick={() => deleteM.mutate(t.id)}><Trash2 className="h-4 w-4 text-rose-600" /></Button></td>
              </tr>
            ))}
            {(tmplQ.data ?? []).length === 0 && <tr><td colSpan={3} className="text-center text-muted-foreground py-6">No templates yet</td></tr>}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
