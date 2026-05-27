import React, { useMemo, useState } from "react";
import { View, Pressable, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { can } from "@/lib/permissions";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import {
  AppText, AppCard, AppButton, AppInput, AppBottomSheet, AppEmptyState,
  StatusChip, AppIcon, AppBadge,
} from "@/components/ui";

type Campaign = {
  id: number; name: string; channel: string; status: string; type?: string;
  scheduledAt?: string | null;
  stats?: { sent?: number; opened?: number; clicked?: number; converted?: number };
};
type Analytics = {
  total: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  sends?: { sent?: number; converted?: number; failed?: number };
};
type PlanInfo = {
  flags: { sms: boolean; whatsapp: boolean; email: boolean; push: boolean };
};
type Review = { id: number; rating: number | null; body: string };
type CouponRow = { id: number; usedCount?: number };
type TemplateRow = {
  id: number; name: string; category?: string | null; body: string;
  title?: string | null; isGlobal?: boolean;
};

const AUDIENCES = [
  { key: "all", label: "All customers" },
  { key: "vip", label: "VIPs" },
  { key: "repeat", label: "Repeat" },
  { key: "new", label: "New" },
  { key: "inactive", label: "Inactive" },
  { key: "birthday", label: "Birthdays this month" },
] as const;

const VALIDITIES = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
] as const;

const HOME_SEGMENTS: Array<{ key: string; label: string }> = [
  { key: "vip", label: "VIPs" },
  { key: "repeat", label: "Repeat" },
  { key: "inactive", label: "Inactive" },
  { key: "birthday", label: "Birthdays" },
];

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral" | "danger"> = {
  sent: "success", completed: "success", sending: "info",
  scheduled: "info", active: "success",
  draft: "neutral", paused: "warning", cancelled: "danger", failed: "danger",
};

export default function MarketingCampaignsHome() {
  const colors = useColors();
  const { restaurantId, user } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const campaignsQ = useQuery({
    queryKey: ["marketing-campaigns", restaurantId],
    queryFn: () => customFetch<Campaign[]>(`/api/restaurants/${restaurantId}/growth/campaigns`),
  });
  const analyticsQ = useQuery({
    queryKey: ["marketing-analytics", restaurantId],
    queryFn: () => customFetch<Analytics>(`/api/restaurants/${restaurantId}/growth/analytics`),
  });
  const planQ = useQuery({
    queryKey: ["marketing-plan-info", restaurantId],
    queryFn: () => customFetch<PlanInfo>(`/api/restaurants/${restaurantId}/growth/plan-info`),
  });
  const reviewsQ = useQuery({
    queryKey: ["marketing-feedback", restaurantId],
    queryFn: () => customFetch<Review[]>(`/api/restaurants/${restaurantId}/reviews/feedback?limit=5`),
  });
  const segmentsQ = useQueries({
    queries: HOME_SEGMENTS.map(seg => ({
      queryKey: ["marketing-segment-size", restaurantId, seg.key],
      queryFn: () => customFetch<{ total: number }>(
        `/api/restaurants/${restaurantId}/growth/segments/preview`,
        { method: "POST", body: JSON.stringify({ audience: { segment: seg.key } }) },
      ),
      staleTime: 60_000,
    })),
  });
  const couponsQ = useQuery({
    queryKey: ["marketing-coupons", restaurantId],
    queryFn: () => customFetch<CouponRow[] | { coupons?: CouponRow[] }>(`/api/restaurants/${restaurantId}/coupons`)
      .catch(() => [] as CouponRow[]),
  });

  const campaigns = campaignsQ.data ?? [];
  const analytics = analyticsQ.data;
  const plan = planQ.data;
  const reviews = reviewsQ.data ?? [];
  const couponsArr: CouponRow[] = Array.isArray(couponsQ.data)
    ? couponsQ.data
    : (couponsQ.data?.coupons ?? []);
  const couponRedemptions = couponsArr.reduce((sum, c) => sum + (c.usedCount ?? 0), 0);

  const active = useMemo(
    () => campaigns.filter(c => c.status === "active" || c.status === "sending" || c.status === "sent"),
    [campaigns],
  );
  const scheduled = useMemo(() => campaigns.filter(c => c.status === "scheduled"), [campaigns]);
  const drafts = useMemo(() => campaigns.filter(c => c.status === "draft"), [campaigns]);
  const pendingApproval = drafts.filter(c => c.type === "promotion" || c.type === "custom").length;

  const onRefresh = async () => {
    await Promise.all([
      campaignsQ.refetch(), analyticsQ.refetch(), planQ.refetch(),
      reviewsQ.refetch(), couponsQ.refetch(),
    ]);
  };

  // Permission-driven approval gate: anyone without the `campaign.launch`
  // permission (e.g. the marketing role by default) saves drafts that
  // owners / managers must approve. Backend enforces the same rule on
  // POST /campaigns/:id/launch.
  const userPerms = (user as { permissions?: string[] } | null)?.permissions ?? null;
  const requiresApproval = !can(user?.role ?? null, "campaign.launch", userPerms);

  return (
    <RoleShellScreen
      title="Marketing"
      subtitle={requiresApproval ? "Drafts submit for approval" : "Plan, send, and measure"}
      onRefresh={onRefresh}
      refreshing={campaignsQ.isRefetching}
    >
      {/* Headline metrics row */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <MetricTile
          label="Active"
          value={String(active.length)}
          icon="rocket-outline"
        />
        <MetricTile
          label="Scheduled"
          value={String(scheduled.length)}
          icon="time-outline"
        />
        <MetricTile
          label="Coupons used"
          value={String(couponRedemptions)}
          icon="pricetag-outline"
        />
      </View>

      {/* Customer segments summary */}
      <AppCard padding={12} style={{ gap: 8 }} onPress={() => router.push("/(marketing)/customers" as never)}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <AppText weight="semibold">Customer segments</AppText>
          <AppText variant="small" color="primary" weight="semibold">See all</AppText>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {HOME_SEGMENTS.map((seg, i) => {
            const q = segmentsQ[i];
            const size = q?.data?.total;
            return (
              <View key={seg.key} style={{ minWidth: 80 }}>
                <AppText variant="h3">{q?.isLoading || size == null ? "—" : String(size)}</AppText>
                <AppText variant="micro" color="mutedForeground">{seg.label.toUpperCase()}</AppText>
              </View>
            );
          })}
        </View>
      </AppCard>

      {pendingApproval > 0 ? (
        <AppCard padding={12} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <AppIcon name="hourglass-outline" size={20} color="warning" />
          <View style={{ flex: 1 }}>
            <AppText weight="semibold">{pendingApproval} pending approval</AppText>
            <AppText variant="small" color="mutedForeground">
              Drafts waiting for owner / manager to launch.
            </AppText>
          </View>
        </AppCard>
      ) : null}

      <AppButton
        label="Quick offer"
        leftIcon="add"
        onPress={() => setCreating(true)}
      />

      {/* Active campaigns */}
      <SectionTitle title="Active & sent" />
      {campaignsQ.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : active.length === 0 ? (
        <AppEmptyState
          icon="rocket-outline"
          title="No active campaigns"
          description="Tap Quick offer above to draft one in 60 seconds."
        />
      ) : (
        active.slice(0, 8).map(c => (
          <CampaignRow key={c.id} c={c} onPress={() => router.push(`/(marketing)/campaign/${c.id}` as never)} />
        ))
      )}

      {scheduled.length > 0 ? (
        <>
          <SectionTitle title="Scheduled" />
          {scheduled.slice(0, 6).map(c => (
            <CampaignRow key={c.id} c={c} onPress={() => router.push(`/(marketing)/campaign/${c.id}` as never)} />
          ))}
        </>
      ) : null}

      {drafts.length > 0 ? (
        <>
          <SectionTitle title="Drafts" />
          {drafts.slice(0, 6).map(c => (
            <CampaignRow key={c.id} c={c} onPress={() => router.push(`/(marketing)/campaign/${c.id}` as never)} />
          ))}
        </>
      ) : null}

      {/* Recent reviews */}
      <SectionTitle title="Recent reviews" rightLabel="See all" onRightPress={() => router.push("/(marketing)/reviews" as never)} />
      {reviewsQ.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : reviews.length === 0 ? (
        <AppText variant="small" color="mutedForeground">No customer feedback yet.</AppText>
      ) : (
        reviews.slice(0, 3).map(r => (
          <AppCard key={r.id} padding={12} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <AppIcon name="star" size={14} color="warning" />
              <AppText weight="semibold">{r.rating ?? "—"}/5</AppText>
            </View>
            <AppText variant="small" numberOfLines={2}>{r.body}</AppText>
          </AppCard>
        ))
      )}

      <View style={{ height: 20 }} />

      <QuickOfferSheet
        visible={creating}
        onClose={() => setCreating(false)}
        plan={plan ?? null}
        restaurantId={restaurantId}
        requiresApproval={requiresApproval}
        onSubmitted={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ["marketing-campaigns", restaurantId] });
          qc.invalidateQueries({ queryKey: ["marketing-analytics", restaurantId] });
        }}
      />
    </RoleShellScreen>
  );
}

function SectionTitle({ title, rightLabel, onRightPress }: { title: string; rightLabel?: string; onRightPress?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
      <AppText variant="h3">{title}</AppText>
      {rightLabel && onRightPress ? (
        <Pressable onPress={onRightPress} hitSlop={8}>
          <AppText variant="small" color="primary" weight="semibold">{rightLabel}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function MetricTile({ label, value, icon }: { label: string; value: string; icon: React.ComponentProps<typeof AppIcon>["name"] }) {
  return (
    <AppCard padding={12} style={{ flex: 1, gap: 4 }}>
      <AppIcon name={icon} size={18} color="primary" />
      <AppText variant="h2">{value}</AppText>
      <AppText variant="micro" color="mutedForeground">{label.toUpperCase()}</AppText>
    </AppCard>
  );
}

function CampaignRow({ c, onPress }: { c: Campaign; onPress: () => void }) {
  const tone = STATUS_TONE[c.status] ?? "neutral";
  const sent = c.stats?.sent ?? 0;
  const opened = c.stats?.opened ?? 0;
  const openRate = sent > 0 ? Math.round((opened / sent) * 100) : null;
  return (
    <AppCard padding={12} onPress={onPress} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
      <AppIcon name="megaphone-outline" size={22} color="primary" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText weight="semibold" numberOfLines={1}>{c.name}</AppText>
        <AppText variant="small" color="mutedForeground" numberOfLines={1}>
          {c.channel.toUpperCase()} · sent {sent}
          {openRate !== null ? ` · ${openRate}% opened` : ""}
        </AppText>
      </View>
      <StatusChip label={c.status} tone={tone} size="xs" />
    </AppCard>
  );
}

function QuickOfferSheet({
  visible, onClose, plan, restaurantId, requiresApproval, onSubmitted,
}: {
  visible: boolean;
  onClose: () => void;
  plan: PlanInfo | null;
  restaurantId: number;
  requiresApproval: boolean;
  onSubmitted: () => void;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<typeof AUDIENCES[number]["key"]>("all");
  const [channel, setChannel] = useState<"email" | "sms" | "whatsapp" | "push" | null>(null);
  const [validityDays, setValidityDays] = useState<number>(14);
  const [body, setBody] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setName(""); setAudience("all"); setBody(""); setValidityDays(14);
      setPickerOpen(false);
      // Pick first enabled channel by default.
      const enabled: Array<typeof channel> = [];
      if (plan?.flags.whatsapp) enabled.push("whatsapp");
      if (plan?.flags.sms) enabled.push("sms");
      if (plan?.flags.email) enabled.push("email");
      if (plan?.flags.push) enabled.push("push");
      setChannel(enabled[0] ?? null);
    }
  }, [visible, plan]);

  const channels = useMemo(() => {
    const list: Array<{ key: "email" | "sms" | "whatsapp" | "push"; label: string }> = [];
    if (plan?.flags.whatsapp) list.push({ key: "whatsapp", label: "WhatsApp" });
    if (plan?.flags.sms) list.push({ key: "sms", label: "SMS" });
    if (plan?.flags.email) list.push({ key: "email", label: "Email" });
    if (plan?.flags.push) list.push({ key: "push", label: "Push" });
    return list;
  }, [plan]);

  const submitting = useMutation({
    mutationFn: async (args: { launch: boolean }) => {
      const validTo = new Date(Date.now() + validityDays * 86_400_000).toISOString();
      const created = await customFetch<{ id: number }>(`/api/restaurants/${restaurantId}/growth/campaigns`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          type: "promotion",
          channel,
          goal: "retention",
          audience: { segment: audience, validTo },
          content: { subject: name.trim(), body, ctaText: "Redeem" },
          scheduleKind: "now",
        }),
      });
      if (args.launch && !requiresApproval) {
        await customFetch(`/api/restaurants/${restaurantId}/growth/campaigns/${created.id}/launch`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }
      return created;
    },
    onSuccess: () => {
      Alert.alert(
        requiresApproval ? "Submitted for approval" : "Saved",
        requiresApproval
          ? "Your draft is waiting for owner / manager approval."
          : "Draft saved. You can launch it from the campaign detail.",
      );
      onSubmitted();
    },
    onError: (err) => Alert.alert("Failed", err instanceof Error ? err.message : "Could not save"),
  });

  const testSendM = useMutation({
    mutationFn: async (to: string) => {
      // Need a draft to test against — save first if not saved yet.
      const draft = await customFetch<{ id: number }>(`/api/restaurants/${restaurantId}/growth/campaigns/draft`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim() || "Test offer", type: "promotion", channel, goal: "retention",
        }),
      });
      await customFetch(`/api/restaurants/${restaurantId}/growth/campaigns/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          audience: { segment: audience }, content: { subject: name.trim(), body },
        }),
      });
      return customFetch<{ ok: boolean; reason?: string }>(`/api/restaurants/${restaurantId}/growth/campaigns/${draft.id}/test-send`, {
        method: "POST",
        body: JSON.stringify({ to, channel }),
      });
    },
    onSuccess: (r) => {
      if (r.ok) Alert.alert("Test sent", "Check your inbox / phone.");
      else Alert.alert("Test failed", r.reason ?? "Provider rejected the message.");
    },
    onError: (err) => Alert.alert("Test failed", err instanceof Error ? err.message : "Could not send"),
  });

  const canSubmit = !!name.trim() && !!channel && !submitting.isPending;

  const [testTo, setTestTo] = useState("");

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title="Quick offer">
      <AppInput label="Offer name" value={name} onChangeText={setName} placeholder="Weekend brunch 20% off" />

      <AppText variant="small" color="mutedForeground" weight="semibold">AUDIENCE</AppText>
      <ChipRow
        items={AUDIENCES.map(a => ({ key: a.key, label: a.label }))}
        value={audience}
        onChange={(v) => setAudience(v as typeof audience)}
      />

      <AppText variant="small" color="mutedForeground" weight="semibold">CHANNEL</AppText>
      {channels.length === 0 ? (
        <AppText variant="small" color="mutedForeground">
          No channels enabled on your plan. Ask your owner to upgrade.
        </AppText>
      ) : (
        <ChipRow
          items={channels.map(c => ({ key: c.key, label: c.label }))}
          value={channel ?? ""}
          onChange={(v) => setChannel(v as typeof channel)}
        />
      )}

      <AppText variant="small" color="mutedForeground" weight="semibold">VALID FOR</AppText>
      <ChipRow
        items={VALIDITIES.map(v => ({ key: String(v.days), label: v.label }))}
        value={String(validityDays)}
        onChange={(v) => setValidityDays(Number(v))}
      />

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <AppText variant="small" color="mutedForeground" weight="semibold">MESSAGE</AppText>
        <Pressable
          onPress={() => channel && setPickerOpen(true)}
          disabled={!channel}
          hitSlop={8}
        >
          <AppText variant="small" weight="semibold" color={channel ? "primary" : "mutedForeground"}>
            Use template
          </AppText>
        </Pressable>
      </View>
      <AppInput
        value={body}
        onChangeText={setBody}
        placeholder="Hi {{name}}, enjoy 20% off this weekend!"
        multiline
        numberOfLines={3}
      />

      {channel ? (
        <TemplatePickerSheet
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          restaurantId={restaurantId}
          channel={channel}
          onPick={(t) => {
            setBody(t.body);
            if (!name.trim()) setName(t.name);
            setPickerOpen(false);
          }}
        />
      ) : null}

      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <AppInput
          containerStyle={{ flex: 1 }}
          placeholder={channel === "email" ? "test@email.com" : "+919999900000"}
          value={testTo}
          onChangeText={setTestTo}
          autoCapitalize="none"
        />
        <AppButton
          label="Send test"
          variant="outline"
          loading={testSendM.isPending}
          disabled={!testTo || !channel || !body}
          onPress={() => testSendM.mutate(testTo)}
        />
      </View>

      <AppButton
        label={requiresApproval ? "Submit for approval" : "Save & launch"}
        loading={submitting.isPending}
        disabled={!canSubmit}
        onPress={() => submitting.mutate({ launch: !requiresApproval })}
        style={{ marginTop: 12 }}
      />
      {!requiresApproval ? (
        <AppButton
          label="Save as draft"
          variant="outline"
          disabled={!canSubmit}
          onPress={() => submitting.mutate({ launch: false })}
        />
      ) : null}
    </AppBottomSheet>
  );
}

function TemplatePickerSheet({
  visible, onClose, restaurantId, channel, onPick,
}: {
  visible: boolean;
  onClose: () => void;
  restaurantId: number;
  channel: "email" | "sms" | "whatsapp" | "push";
  onPick: (t: TemplateRow) => void;
}) {
  const colors = useColors();
  const q = useQuery({
    queryKey: ["marketing-template-picker", restaurantId, channel],
    queryFn: () => customFetch<TemplateRow[]>(`/api/restaurants/${restaurantId}/growth/templates/${channel}`),
    enabled: visible,
  });
  const rows = q.data ?? [];
  return (
    <AppBottomSheet visible={visible} onClose={onClose} title={`${channel.toUpperCase()} templates`}>
      {q.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : rows.length === 0 ? (
        <AppEmptyState
          icon="document-text-outline"
          title="No templates yet"
          description="Create one in the Templates tab to reuse it here."
        />
      ) : (
        rows.map(t => (
          <AppCard key={t.id} padding={12} onPress={() => onPick(t)} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <AppText weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{t.name}</AppText>
              {t.isGlobal ? <AppBadge label="Global" tone="info" /> : null}
            </View>
            {t.title ? (
              <AppText variant="small" color="mutedForeground" numberOfLines={1}>{t.title}</AppText>
            ) : null}
            <AppText variant="small" numberOfLines={2}>{t.body}</AppText>
          </AppCard>
        ))
      )}
    </AppBottomSheet>
  );
}

function ChipRow({ items, value, onChange }: { items: Array<{ key: string; label: string }>; value: string; onChange: (k: string) => void }) {
  const colors = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {items.map(i => {
        const active = value === i.key;
        return (
          <Pressable
            key={i.key}
            onPress={() => onChange(i.key)}
            style={{
              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? colors.primary : "transparent",
            }}
          >
            <AppText variant="small" weight="semibold" color={active ? "primaryForeground" : "foreground"}>
              {i.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
