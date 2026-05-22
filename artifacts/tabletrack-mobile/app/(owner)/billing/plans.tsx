import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { RoleGate } from "@/components/RoleGate";
import { BRAND } from "@/constants/brand";

type Plan = {
  id: number; name: string; slug: string; price: string; yearlyPrice: string | null;
  currency: string; billingPeriod: string;
  maxBranches: number; maxStaff: number; maxTables: number; maxMenuItems: number;
  aiEnabled: boolean; aiMonthlyIncludedCredits: number;
  features: string[] | null;
};

type Summary = { plan: Plan | null; plans: Plan[] };

function fmtMoney(amount: string | number | null, currency: string) {
  if (amount == null) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${currency} ${amount}`;
  return `${currency === "USD" ? "$" : currency === "INR" ? "₹" : currency + " "}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function PlansScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");

  const { data, isLoading } = useQuery({
    queryKey: ["billing-mobile-summary", restaurantId],
    queryFn: () => customFetch<Summary>(`/api/restaurants/${restaurantId}/billing/mobile-summary`),
    staleTime: 30_000,
  });

  const currentId = data?.plan?.id ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Compare plans" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: Platform.OS === "web" ? 120 : insets.bottom + (Platform.OS === "android" ? 140 : 110) }}>
        <View style={[styles.toggle, { backgroundColor: colors.accent }]}>
          {(["monthly", "yearly"] as const).map(p => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              style={[styles.toggleBtn, period === p && { backgroundColor: colors.background }]}
            >
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: period === p ? colors.primary : colors.mutedForeground }}>
                {p === "monthly" ? "Monthly" : "Yearly · save"}
              </Text>
            </Pressable>
          ))}
        </View>

        {isLoading ? (
          <View style={{ paddingTop: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          (data?.plans ?? []).map(plan => {
            const isCurrent = plan.id === currentId;
            const price = period === "yearly" && plan.yearlyPrice ? plan.yearlyPrice : plan.price;
            return (
              <View
                key={plan.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: isCurrent ? colors.primary : colors.border,
                    borderWidth: isCurrent ? 2 : 1,
                  },
                ]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[styles.planName, { color: colors.foreground }]}>{plan.name}</Text>
                  {isCurrent ? <StatusBadge label="Current" tone="success" /> : null}
                </View>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 6 }}>
                  <Text style={[styles.price, { color: colors.foreground }]}>{fmtMoney(price, plan.currency)}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    / {period === "yearly" && plan.yearlyPrice ? "year" : "month"}
                  </Text>
                </View>

                <View style={{ gap: 6, marginTop: 12 }}>
                  <Limit icon="git-branch-outline" label="Branches" value={plan.maxBranches} colors={colors} />
                  <Limit icon="people-outline" label="Staff" value={plan.maxStaff} colors={colors} />
                  <Limit icon="grid-outline" label="Tables" value={plan.maxTables} colors={colors} />
                  <Limit icon="restaurant-outline" label="Menu items" value={plan.maxMenuItems} colors={colors} />
                  {plan.aiEnabled ? (
                    <Limit
                      icon="sparkles-outline"
                      label="AI credits / mo"
                      value={plan.aiMonthlyIncludedCredits}
                      colors={colors}
                      accent={BRAND.ai}
                    />
                  ) : null}
                </View>

                {plan.features && plan.features.length > 0 ? (
                  <View style={{ gap: 4, marginTop: 12 }}>
                    {plan.features.slice(0, 6).map(f => (
                      <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Ionicons name="checkmark-circle" size={14} color={BRAND.success} />
                        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 }}>{f}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <Pressable
                  disabled={isCurrent}
                  onPress={() => router.push({
                    pathname: "/(owner)/billing/upgrade",
                    params: { targetPlanId: String(plan.id), billingPeriod: period },
                  } as never)}
                  style={({ pressed }) => [
                    styles.cta,
                    {
                      backgroundColor: isCurrent ? colors.accent : colors.primary,
                      opacity: pressed && !isCurrent ? 0.85 : 1,
                      marginTop: 14,
                    },
                  ]}
                >
                  <Text style={{ color: isCurrent ? colors.mutedForeground : "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    {isCurrent ? "You're on this plan" : "Choose this plan"}
                  </Text>
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function Limit({ icon, label, value, colors, accent }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; value: number;
  colors: ReturnType<typeof useColors>; accent?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Ionicons name={icon} size={14} color={accent ?? colors.mutedForeground} />
      <Text style={{ flex: 1, color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium" }}>{label}</Text>
      <Text style={{ color: accent ?? colors.foreground, fontSize: 13, fontFamily: "Inter_700Bold" }}>{value}</Text>
    </View>
  );
}

export default function Plans() {
  return (
    <RoleGate module="billing">
      <PlansScreen />
    </RoleGate>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: "row", borderRadius: 999, padding: 4 },
  toggleBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 999 },
  card: { borderRadius: 16, padding: 16 },
  planName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  price: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  cta: { paddingVertical: 12, borderRadius: 12, alignItems: "center" },
});
