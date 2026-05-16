import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";

type PaymentSummary = {
  totalRevenue?: number;
  cash?: number;
  card?: number;
  upi?: number;
  online?: number;
  refunds?: number;
};
type Payout = { id: number; aggregator: string; amount: string | number; status: string; expectedAt?: string };

export default function FinanceScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";

  const today = new Date().toISOString().slice(0, 10);
  const summaryQ = useQuery({
    queryKey: ["payment-summary", restaurantId, today],
    queryFn: () => customFetch<PaymentSummary>(`/restaurants/${restaurantId}/payments/summary?date=${today}`).catch(() => ({} as PaymentSummary)),
  });
  const payoutsQ = useQuery({
    queryKey: ["aggregator-payouts", restaurantId],
    queryFn: () => customFetch<Payout[] | { payouts?: Payout[] }>(`/restaurants/${restaurantId}/aggregator-payouts?status=pending`).catch(() => []),
  });
  const sum = summaryQ.data ?? {};
  const payouts: Payout[] = Array.isArray(payoutsQ.data) ? payoutsQ.data : (payoutsQ.data?.payouts ?? []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Finance" subtitle="Today" showBack />
      <ScrollView
        refreshControl={<RefreshControl refreshing={summaryQ.isRefetching} onRefresh={() => { summaryQ.refetch(); payoutsQ.refetch(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: isWeb ? 100 : 100 }}
      >
        <View style={[styles.bigCard, { backgroundColor: colors.primary }]}>
          <Text style={styles.bigLabel}>Today's revenue</Text>
          <Text style={styles.bigValue}>₹{(sum.totalRevenue ?? 0).toFixed(0)}</Text>
          <Text style={styles.bigSub}>Refunds ₹{(sum.refunds ?? 0).toFixed(0)}</Text>
        </View>

        <View style={styles.grid}>
          {[
            { label: "Cash", value: sum.cash, icon: "cash-outline" as const },
            { label: "UPI", value: sum.upi, icon: "phone-portrait-outline" as const },
            { label: "Card", value: sum.card, icon: "card-outline" as const },
            { label: "Online", value: sum.online, icon: "globe-outline" as const },
          ].map(c => (
            <View key={c.label} style={[styles.tile, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name={c.icon} size={18} color={colors.primary} />
              <Text style={[styles.tileLabel, { color: colors.mutedForeground }]}>{c.label}</Text>
              <Text style={[styles.tileValue, { color: colors.foreground }]}>₹{(c.value ?? 0).toFixed(0)}</Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={() => router.push("/(owner)/expenses" as never)}
          style={({ pressed }) => [styles.linkRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
        >
          <Ionicons name="wallet-outline" size={20} color={colors.primary} />
          <Text style={[styles.linkText, { color: colors.foreground, flex: 1 }]}>Expenses</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={() => router.push("/(owner)/reports" as never)}
          style={({ pressed }) => [styles.linkRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
        >
          <Ionicons name="bar-chart-outline" size={20} color={colors.primary} />
          <Text style={[styles.linkText, { color: colors.foreground, flex: 1 }]}>Reports & P&L</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>

        {payouts.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.heading, { color: colors.mutedForeground }]}>Pending payouts</Text>
            {payouts.map(p => (
              <View key={p.id} style={[styles.payoutRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.payoutSrc, { color: colors.foreground }]}>{p.aggregator}</Text>
                  <Text style={[styles.payoutMeta, { color: colors.mutedForeground }]}>
                    {p.expectedAt ? `Expected ${new Date(p.expectedAt).toLocaleDateString()}` : p.status}
                  </Text>
                </View>
                <Text style={[styles.payoutAmt, { color: colors.foreground }]}>₹{Number(p.amount).toFixed(0)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bigCard: { padding: 20, borderRadius: 16 },
  bigLabel: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  bigValue: { color: "#fff", fontSize: 36, fontFamily: "Inter_700Bold", marginTop: 6 },
  bigSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "48%", flexGrow: 1, padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
  tileLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  tileValue: { fontSize: 17, fontFamily: "Inter_700Bold" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  linkText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  heading: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 4 },
  payoutRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  payoutSrc: { fontSize: 14, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  payoutMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  payoutAmt: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
