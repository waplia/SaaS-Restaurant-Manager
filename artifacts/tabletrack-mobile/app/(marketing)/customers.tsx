import React, { useMemo } from "react";
import { View, ActivityIndicator } from "react-native";
import { useQueries, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import { AppText, AppCard, AppIcon, AppEmptyState } from "@/components/ui";

type Campaign = {
  id: number; name: string;
  audience?: { segment?: string } | null;
  sentAt?: string | null;
  scheduledAt?: string | null;
  updatedAt?: string | null;
};
type PreviewResult = { total: number };

const SEGMENTS: Array<{ key: string; label: string; description: string }> = [
  { key: "all", label: "All customers", description: "Everyone in your database" },
  { key: "vip", label: "VIPs", description: "Marked as VIP by your team" },
  { key: "repeat", label: "Repeat", description: "Customers with 2+ orders" },
  { key: "new", label: "New", description: "0–1 orders so far" },
  { key: "high_value", label: "High value", description: "Lifetime spend ≥ ₹5,000" },
  { key: "inactive", label: "Inactive", description: "No visit in 60 days" },
  { key: "birthday", label: "Birthdays this month", description: "Send a birthday treat" },
  { key: "anniversary", label: "Anniversaries", description: "Anniversaries this month" },
];

function formatLastUsed(iso?: string | null): string {
  if (!iso) return "Never used";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "Used today";
  if (days === 1) return "Used yesterday";
  if (days < 30) return `Used ${days}d ago`;
  if (days < 365) return `Used ${Math.floor(days / 30)}mo ago`;
  return `Used ${Math.floor(days / 365)}y ago`;
}

export default function MarketingCustomersScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();

  const campaignsQ = useQuery({
    queryKey: ["marketing-campaigns", restaurantId],
    queryFn: () => customFetch<Campaign[]>(`/api/restaurants/${restaurantId}/growth/campaigns`),
  });

  const sizes = useQueries({
    queries: SEGMENTS.map(seg => ({
      queryKey: ["marketing-segment-size", restaurantId, seg.key],
      queryFn: () => customFetch<PreviewResult>(`/api/restaurants/${restaurantId}/growth/segments/preview`, {
        method: "POST",
        body: JSON.stringify({ audience: { segment: seg.key } }),
      }),
      staleTime: 60_000,
    })),
  });

  const lastUsedBySegment = useMemo(() => {
    const map = new Map<string, string>();
    const campaigns = campaignsQ.data ?? [];
    for (const c of campaigns) {
      const segKey = c.audience?.segment;
      if (!segKey) continue;
      const ts = c.sentAt || c.scheduledAt || c.updatedAt;
      if (!ts) continue;
      const existing = map.get(segKey);
      if (!existing || new Date(ts) > new Date(existing)) {
        map.set(segKey, ts);
      }
    }
    return map;
  }, [campaignsQ.data]);

  const refreshing = campaignsQ.isRefetching || sizes.some(q => q.isRefetching);

  const onRefresh = async () => {
    await Promise.all([campaignsQ.refetch(), ...sizes.map(s => s.refetch())]);
  };

  return (
    <RoleShellScreen
      title="Customer segments"
      subtitle="Tap to draft a campaign for a group"
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      {SEGMENTS.length === 0 ? (
        <AppEmptyState icon="people-outline" title="No segments" description="Segments will appear here." />
      ) : (
        SEGMENTS.map((seg, i) => {
          const sizeQ = sizes[i];
          const lastIso = lastUsedBySegment.get(seg.key);
          return (
            <AppCard key={seg.key} padding={14} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{
                width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center",
                backgroundColor: colors.primary + "1A",
              }}>
                <AppIcon name="people-outline" size={20} color="primary" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText weight="semibold">{seg.label}</AppText>
                <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                  {seg.description}
                </AppText>
                <AppText variant="micro" color="mutedForeground" style={{ marginTop: 2 }}>
                  {formatLastUsed(lastIso)}
                </AppText>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {sizeQ.isLoading ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <AppText variant="h3">{sizeQ.data?.total ?? 0}</AppText>
                )}
                <AppText variant="micro" color="mutedForeground">CUSTOMERS</AppText>
              </View>
            </AppCard>
          );
        })
      )}
    </RoleShellScreen>
  );
}
