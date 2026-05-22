import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import { RoleGate } from "@/components/RoleGate";
import { BRAND } from "@/constants/brand";

type MobileSummary = {
  tenant: {
    id: number; name: string; planStatus: string;
    trialEndsAt: string | null; subscriptionStartedAt: string | null;
    subscriptionEndsAt: string | null; isSuspended: boolean;
  };
  plan: null | {
    id: number; name: string; price: string; currency: string;
    billingPeriod: string; yearlyPrice: string | null;
    maxBranches: number; maxStaff: number; maxTables: number; maxMenuItems: number;
    aiEnabled: boolean; aiMonthlyIncludedCredits: number;
    features: string[] | null;
  };
  plans: Array<{
    id: number; name: string; slug: string; price: string; yearlyPrice: string | null;
    currency: string; billingPeriod: string;
    maxBranches: number; maxStaff: number; maxTables: number; maxMenuItems: number;
    aiEnabled: boolean; aiMonthlyIncludedCredits: number;
    features: string[] | null; isActive: boolean;
  }>;
  usage: {
    branches: { used: number; limit: number | null };
    staff: { used: number; limit: number | null };
    tables: { used: number; limit: number | null };
    menuItems: { used: number; limit: number | null };
  };
  aiCredits: {
    enabled: boolean; included: number; available: number; used: number;
    purchased: number; bonus: number; isBlocked: boolean;
  };
  addons: Array<{
    id: number; key: string; name: string; icon: string; category: string;
    status: string; billingCycle: string | null; pricePaid: string | null;
    currency: string | null; trialEndsAt: string | null; currentPeriodEndsAt: string | null;
  }>;
};

function statusTone(s: string): StatusTone {
  switch (s) {
    case "active": return "success";
    case "trial": return "info";
    case "past_due":
    case "grace": return "warning";
    case "cancelled":
    case "expired":
    case "suspended": return "danger";
    default: return "neutral";
  }
}

function fmtMoney(amount: string | number, currency: string) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${currency} ${amount}`;
  return `${currency === "USD" ? "$" : currency === "INR" ? "₹" : currency + " "}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
}

function UsageRow({ label, used, limit, colors }: { label: string; used: number; limit: number | null; colors: ReturnType<typeof useColors> }) {
  const cap = limit && limit > 0 ? limit : null;
  const ratio = cap ? Math.min(1, used / cap) : 0;
  const over = cap ? used > cap : false;
  const bar = over ? BRAND.danger : ratio > 0.85 ? BRAND.warning : BRAND.primary;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground }}>{label}</Text>
        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: over ? BRAND.danger : colors.mutedForeground }}>
          {used}{cap ? ` / ${cap}` : ""}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.accent, overflow: "hidden" }}>
        <View style={{ width: `${(cap ? ratio : used > 0 ? 1 : 0) * 100}%`, height: 6, backgroundColor: bar }} />
      </View>
    </View>
  );
}

function BillingScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const { data, isLoading, refetch, isRefetching, error } = useQuery({
    queryKey: ["billing-mobile-summary", restaurantId],
    queryFn: () => customFetch<MobileSummary>(`/api/restaurants/${restaurantId}/billing/mobile-summary`),
    staleTime: 30_000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Plans & Billing" showBack subtitle={data?.tenant.name} />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: Platform.OS === "web" ? 120 : 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        {isLoading ? (
          <View style={{ paddingTop: 60, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 16 }]}>
            <Text style={{ color: colors.destructive, fontFamily: "Inter_600SemiBold" }}>
              Could not load billing details
            </Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 4, fontSize: 13 }}>
              Pull to refresh.
            </Text>
          </View>
        ) : data ? (
          <>
            {/* Current plan */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 16, gap: 10 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={[styles.h2, { color: colors.foreground }]}>Current plan</Text>
                <StatusBadge label={data.tenant.planStatus.replace(/_/g, " ")} tone={statusTone(data.tenant.planStatus)} />
              </View>
              <Text style={[styles.planName, { color: colors.foreground }]}>{data.plan?.name ?? "No plan"}</Text>
              {data.plan ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_500Medium" }}>
                  {fmtMoney(data.plan.price, data.plan.currency)} / {data.plan.billingPeriod}
                </Text>
              ) : null}
              <View style={styles.metaRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>
                    {data.tenant.planStatus === "trial" ? "Trial ends" : "Renews"}
                  </Text>
                  <Text style={[styles.metaValue, { color: colors.foreground }]}>
                    {fmtDate(
                      data.tenant.planStatus === "trial"
                        ? data.tenant.trialEndsAt
                        : data.tenant.subscriptionEndsAt,
                    )}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>Started</Text>
                  <Text style={[styles.metaValue, { color: colors.foreground }]}>{fmtDate(data.tenant.subscriptionStartedAt)}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                <Pressable
                  onPress={() => router.push("/(owner)/billing/plans" as never)}
                  style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1, flex: 1 }]}
                >
                  <Ionicons name="rocket-outline" size={16} color="#fff" />
                  <Text style={styles.primaryBtnText}>Compare plans</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push("/(owner)/billing/invoices" as never)}
                  style={({ pressed }) => [styles.secondaryBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                >
                  <Ionicons name="receipt-outline" size={16} color={colors.foreground} />
                  <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Invoices</Text>
                </Pressable>
              </View>
            </View>

            {/* Usage vs limits */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 16, gap: 12 }]}>
              <Text style={[styles.h2, { color: colors.foreground }]}>Usage</Text>
              <UsageRow label="Branches" used={data.usage.branches.used} limit={data.usage.branches.limit} colors={colors} />
              <UsageRow label="Staff" used={data.usage.staff.used} limit={data.usage.staff.limit} colors={colors} />
              <UsageRow label="Tables" used={data.usage.tables.used} limit={data.usage.tables.limit} colors={colors} />
              <UsageRow label="Menu items" used={data.usage.menuItems.used} limit={data.usage.menuItems.limit} colors={colors} />
            </View>

            {/* AI credits */}
            {data.aiCredits.enabled ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 16, gap: 10 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="sparkles" size={18} color={BRAND.ai} />
                    <Text style={[styles.h2, { color: colors.foreground }]}>AI credits</Text>
                  </View>
                  {data.aiCredits.isBlocked ? (
                    <StatusBadge label="Blocked" tone="danger" />
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Stat label="Available" value={String(data.aiCredits.available)} accent={BRAND.ai} colors={colors} />
                  <Stat label="Used" value={String(data.aiCredits.used)} colors={colors} />
                  <Stat label="Purchased" value={String(data.aiCredits.purchased)} colors={colors} />
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}>
                  Plan includes {data.aiCredits.included} credits per month.
                  {data.aiCredits.bonus > 0 ? ` Bonus: ${data.aiCredits.bonus}.` : ""}
                </Text>
              </View>
            ) : null}

            {/* Addons */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 16, gap: 12 }]}>
              <Text style={[styles.h2, { color: colors.foreground }]}>Add-ons</Text>
              {data.addons.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  No add-ons installed. Browse the catalog on web to enable more features.
                </Text>
              ) : (
                data.addons.map(a => (
                  <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={[styles.addonIcon, { backgroundColor: colors.accent }]}>
                      <Ionicons name="cube-outline" size={16} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>{a.name}</Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                        {a.billingCycle ?? "free"}
                        {a.currentPeriodEndsAt ? ` · renews ${fmtDate(a.currentPeriodEndsAt)}` : ""}
                      </Text>
                    </View>
                    <StatusBadge label={a.status} tone={statusTone(a.status)} />
                  </View>
                ))
              )}
            </View>

            {/* Upgrade CTA */}
            <Pressable
              onPress={() => router.push("/(owner)/billing/upgrade" as never)}
              style={({ pressed }) => [styles.primaryBtn, { backgroundColor: BRAND.primary, opacity: pressed ? 0.85 : 1, paddingVertical: 14 }]}
            >
              <Ionicons name="arrow-up-circle-outline" size={18} color="#fff" />
              <Text style={[styles.primaryBtnText, { fontSize: 15 }]}>Upgrade or contact sales</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, accent, colors }: { label: string; value: string; accent?: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: accent ?? colors.foreground }}>{value}</Text>
      <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </Text>
    </View>
  );
}

export default function Billing() {
  return (
    <RoleGate module="billing">
      <BillingScreen />
    </RoleGate>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1 },
  h2: { fontSize: 16, fontFamily: "Inter_700Bold" },
  planName: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  metaRow: { flexDirection: "row", gap: 16, marginTop: 4 },
  metaLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
  metaValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12 },
  primaryBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, flex: 1 },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  addonIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
