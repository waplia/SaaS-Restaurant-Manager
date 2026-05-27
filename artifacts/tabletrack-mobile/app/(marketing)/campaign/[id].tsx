import React, { useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import {
  AppText, AppCard, AppButton, AppBottomSheet, AppInput, AppIcon, StatusChip,
} from "@/components/ui";

type Campaign = {
  id: number; name: string; channel: string; status: string; type: string;
  audience?: { segment?: string } | null;
  content?: { subject?: string; body?: string; ctaText?: string; ctaUrl?: string } | null;
  scheduledAt?: string | null; sentAt?: string | null;
  stats?: { sent?: number; delivered?: number; opened?: number; clicked?: number; converted?: number; revenue?: number };
};
type DetailResponse = {
  campaign: Campaign;
  steps: Array<{ id: number; channel: string }>;
  logs: Array<{ id: number; event: string; createdAt: string; payload?: unknown }>;
};
type AnalyticsResponse = {
  sent?: number; delivered?: number; opened?: number; clicked?: number;
  converted?: number; revenue?: number; openRate?: number; clickRate?: number;
};

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral" | "danger"> = {
  sent: "success", completed: "success", sending: "info",
  scheduled: "info", active: "success",
  draft: "neutral", paused: "warning", cancelled: "danger", failed: "danger",
};

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function CampaignDetailScreen() {
  const colors = useColors();
  const { restaurantId, user } = useAuth();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);

  const detailQ = useQuery({
    queryKey: ["marketing-campaign", restaurantId, id],
    queryFn: () => customFetch<DetailResponse>(`/api/restaurants/${restaurantId}/growth/campaigns/${id}`),
    enabled: !!id,
  });
  const analyticsQ = useQuery({
    queryKey: ["marketing-campaign-analytics", restaurantId, id],
    queryFn: () => customFetch<AnalyticsResponse>(`/api/restaurants/${restaurantId}/growth/campaigns/${id}/analytics`),
    enabled: !!id,
  });

  const launchM = useMutation({
    mutationFn: () => customFetch(`/api/restaurants/${restaurantId}/growth/campaigns/${id}/launch`, {
      method: "POST", body: JSON.stringify({}),
    }),
    onSuccess: () => {
      Alert.alert("Launched", "The campaign is sending.");
      qc.invalidateQueries({ queryKey: ["marketing-campaign", restaurantId, id] });
      qc.invalidateQueries({ queryKey: ["marketing-campaigns", restaurantId] });
    },
    onError: (err) => Alert.alert("Failed", err instanceof Error ? err.message : "Could not launch"),
  });

  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const testM = useMutation({
    mutationFn: () => customFetch<{ ok: boolean; reason?: string }>(
      `/api/restaurants/${restaurantId}/growth/campaigns/${id}/test-send`,
      { method: "POST", body: JSON.stringify({ to: testTo }) },
    ),
    onSuccess: (r) => {
      if (r.ok) { Alert.alert("Test sent"); setTestOpen(false); }
      else Alert.alert("Test failed", r.reason ?? "Provider rejected the message.");
    },
    onError: (err) => Alert.alert("Test failed", err instanceof Error ? err.message : "Could not send"),
  });

  if (detailQ.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Campaign" }} />
        <RoleShellScreen title="Campaign"><ActivityIndicator color={colors.primary} /></RoleShellScreen>
      </>
    );
  }
  if (detailQ.isError || !detailQ.data) {
    return (
      <>
        <Stack.Screen options={{ title: "Campaign" }} />
        <RoleShellScreen title="Campaign">
          <AppText color="destructive">Could not load this campaign.</AppText>
          <AppButton label="Go back" variant="outline" onPress={() => router.back()} />
        </RoleShellScreen>
      </>
    );
  }

  const { campaign, logs } = detailQ.data;
  const analytics = analyticsQ.data ?? {};
  const sent = analytics.sent ?? campaign.stats?.sent ?? 0;
  const opened = analytics.opened ?? campaign.stats?.opened ?? 0;
  const clicked = analytics.clicked ?? campaign.stats?.clicked ?? 0;
  const converted = analytics.converted ?? campaign.stats?.converted ?? 0;
  const openRate = analytics.openRate ?? (sent > 0 ? Math.round((opened / sent) * 100) : 0);
  const clickRate = analytics.clickRate ?? (sent > 0 ? Math.round((clicked / sent) * 100) : 0);
  const convRate = sent > 0 ? Math.round((converted / sent) * 100) : 0;

  const canLaunch = !!user && user.role !== "marketing"
    && ["draft", "paused"].includes(campaign.status);
  const canTest = ["draft", "scheduled", "sent", "completed", "paused"].includes(campaign.status);

  return (
    <>
      <Stack.Screen options={{ title: campaign.name }} />
      <RoleShellScreen
        title={campaign.name}
        subtitle={`${campaign.channel.toUpperCase()} · ${campaign.type}`}
        onRefresh={async () => { await Promise.all([detailQ.refetch(), analyticsQ.refetch()]); }}
        refreshing={detailQ.isRefetching}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusChip label={campaign.status} tone={STATUS_TONE[campaign.status] ?? "neutral"} />
          {campaign.audience?.segment ? <StatusChip label={campaign.audience.segment} tone="info" size="xs" /> : null}
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <MetricTile label="Sent" value={String(sent)} icon="send-outline" />
          <MetricTile label="Opened" value={`${openRate}%`} icon="mail-open-outline" />
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <MetricTile label="Clicked" value={`${clickRate}%`} icon="link-outline" />
          <MetricTile label="Converted" value={`${convRate}%`} icon="cart-outline" />
        </View>

        <AppCard padding={14} style={{ gap: 6 }}>
          <AppText variant="small" color="mutedForeground" weight="semibold">SCHEDULE</AppText>
          <AppText variant="small">Scheduled: {formatDate(campaign.scheduledAt)}</AppText>
          <AppText variant="small">Sent: {formatDate(campaign.sentAt)}</AppText>
        </AppCard>

        {campaign.content?.subject || campaign.content?.body ? (
          <AppCard padding={14} style={{ gap: 6 }}>
            <AppText variant="small" color="mutedForeground" weight="semibold">MESSAGE</AppText>
            {campaign.content?.subject ? (
              <AppText weight="semibold">{campaign.content.subject}</AppText>
            ) : null}
            {campaign.content?.body ? (
              <AppText variant="small">{campaign.content.body}</AppText>
            ) : null}
          </AppCard>
        ) : null}

        {canLaunch ? (
          <AppButton
            label="Approve & launch"
            leftIcon="rocket-outline"
            loading={launchM.isPending}
            onPress={() => launchM.mutate()}
          />
        ) : null}
        {canTest ? (
          <AppButton
            label="Send test"
            variant="outline"
            leftIcon="paper-plane-outline"
            onPress={() => setTestOpen(true)}
          />
        ) : null}
        {user?.role === "marketing" && campaign.status === "draft" ? (
          <AppCard padding={12} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <AppIcon name="hourglass-outline" size={20} color="warning" />
            <AppText variant="small" style={{ flex: 1 }}>
              Waiting for owner / manager to approve and launch.
            </AppText>
          </AppCard>
        ) : null}

        <AppText variant="h3" style={{ marginTop: 8 }}>Activity</AppText>
        {logs.length === 0 ? (
          <AppText variant="small" color="mutedForeground">No activity yet.</AppText>
        ) : (
          logs.slice(0, 20).map(log => (
            <AppCard key={log.id} padding={10} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <AppIcon name="ellipse" size={8} color="primary" />
              <View style={{ flex: 1 }}>
                <AppText variant="small" weight="semibold">{log.event}</AppText>
                <AppText variant="micro" color="mutedForeground">{formatDate(log.createdAt)}</AppText>
              </View>
            </AppCard>
          ))
        )}

        <AppBottomSheet visible={testOpen} onClose={() => setTestOpen(false)} title="Send test">
          <AppText variant="small" color="mutedForeground">
            We'll send a one-off preview of this campaign to the address below.
          </AppText>
          <AppInput
            label={campaign.channel === "email" ? "Email" : "Phone number"}
            value={testTo}
            onChangeText={setTestTo}
            placeholder={campaign.channel === "email" ? "test@email.com" : "+919999900000"}
            autoCapitalize="none"
          />
          <AppButton
            label="Send"
            loading={testM.isPending}
            disabled={!testTo.trim()}
            onPress={() => testM.mutate()}
          />
        </AppBottomSheet>
      </RoleShellScreen>
    </>
  );
}

function MetricTile({ label, value, icon }: { label: string; value: string; icon: React.ComponentProps<typeof AppIcon>["name"] }) {
  return (
    <AppCard padding={14} style={{ flex: 1, gap: 4 }}>
      <AppIcon name={icon} size={18} color="primary" />
      <AppText variant="h2">{value}</AppText>
      <AppText variant="micro" color="mutedForeground">{label.toUpperCase()}</AppText>
    </AppCard>
  );
}
