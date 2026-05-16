import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";

type Coupon = { id: number; code: string; discountType: string; discountValue: string | number; isActive?: boolean; usedCount?: number; usageLimit?: number };
type Campaign = { id: number; name: string; channel: string; status: string; sentCount?: number; openRate?: number };

export default function GrowthScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";

  const couponsQ = useQuery({
    queryKey: ["coupons", restaurantId],
    queryFn: () => customFetch<Coupon[] | { coupons?: Coupon[] }>(`/api/restaurants/${restaurantId}/coupons`).catch(() => []),
  });
  const campaignsQ = useQuery({
    queryKey: ["campaigns", restaurantId],
    queryFn: () => customFetch<Campaign[] | { campaigns?: Campaign[] }>(`/api/restaurants/${restaurantId}/growth/campaigns`).catch(() => []),
  });
  const coupons: Coupon[] = Array.isArray(couponsQ.data) ? couponsQ.data : (couponsQ.data?.coupons ?? []);
  const campaigns: Campaign[] = Array.isArray(campaignsQ.data) ? campaignsQ.data : (campaignsQ.data?.campaigns ?? []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Growth Engine" showBack />
      <ScrollView
        refreshControl={<RefreshControl refreshing={couponsQ.isRefetching} onRefresh={() => { couponsQ.refetch(); campaignsQ.refetch(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: isWeb ? 100 : 100 }}
      >
        <View style={{ gap: 8 }}>
          <Text style={[styles.heading, { color: colors.foreground }]}>Active campaigns</Text>
          {campaigns.length === 0 ? (
            <EmptyState icon="rocket-outline" title="No campaigns" message="Launch one from the web dashboard." />
          ) : (
            campaigns.map(c => (
              <View key={c.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="rocket" size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: colors.foreground }]}>{c.name}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {c.channel} · sent {c.sentCount ?? 0}
                    {c.openRate != null ? ` · ${(c.openRate * 100).toFixed(0)}% opened` : ""}
                  </Text>
                </View>
                <StatusBadge label={c.status} tone={c.status === "active" ? "success" : "neutral"} />
              </View>
            ))
          )}
        </View>

        <View style={{ gap: 8 }}>
          <Text style={[styles.heading, { color: colors.foreground }]}>Coupons</Text>
          {coupons.length === 0 ? (
            <EmptyState icon="pricetag-outline" title="No coupons" />
          ) : (
            coupons.map(c => (
              <View key={c.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="pricetag" size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: colors.foreground }]}>{c.code}</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {c.discountType === "percent" ? `${c.discountValue}% off` : `₹${c.discountValue} off`}
                    {c.usageLimit ? ` · ${c.usedCount ?? 0}/${c.usageLimit}` : c.usedCount ? ` · used ${c.usedCount}` : ""}
                  </Text>
                </View>
                <StatusBadge label={c.isActive ? "Active" : "Off"} tone={c.isActive ? "success" : "neutral"} />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 13, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
