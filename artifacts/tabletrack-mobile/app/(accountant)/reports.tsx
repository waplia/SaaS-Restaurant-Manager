import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import { AppText, AppCard, RoleHomeCard, StatusChip } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/theme";

interface PnlResp {
  revenue?: { total?: number };
  expenses?: { total?: number };
  netProfit?: number;
  grossMargin?: number;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

export default function AccountantReportsScreen() {
  const t = useTheme();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();

  const from = daysAgo(30);
  const to = today();

  const pnlQ = useQuery({
    queryKey: ["acct-pnl-30d", restaurantId, from, to],
    queryFn: () => customFetch<PnlResp>(`/api/restaurants/${restaurantId}/pnl?from=${from}&to=${to}`).catch(() => ({} as PnlResp)),
    enabled: !!restaurantId,
  });

  const revenue = pnlQ.data?.revenue?.total ?? 0;
  const expenses = pnlQ.data?.expenses?.total ?? 0;
  const net = pnlQ.data?.netProfit ?? (revenue - expenses);
  const margin = pnlQ.data?.grossMargin;

  return (
    <RoleShellScreen
      title="Reports"
      subtitle="Last 30 days"
      onRefresh={async () => { await qc.invalidateQueries({ queryKey: ["acct-pnl-30d"] }); }}
      refreshing={pnlQ.isFetching}
    >
      <AppCard>
        <AppText variant="micro" color="mutedForeground" style={{ letterSpacing: 0.5 }}>P&L · 30 DAY</AppText>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 4 }}>
          <AppText variant="hero">{inr(net)}</AppText>
          {typeof margin === "number" ? (
            <StatusChip label={`${margin.toFixed(1)}% margin`} tone={margin >= 0 ? "success" : "danger"} />
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 24, marginTop: 12 }}>
          <View>
            <AppText variant="micro" color="mutedForeground">REVENUE</AppText>
            <AppText variant="h3">{inr(revenue)}</AppText>
          </View>
          <View>
            <AppText variant="micro" color="mutedForeground">EXPENSES</AppText>
            <AppText variant="h3">{inr(expenses)}</AppText>
          </View>
        </View>
      </AppCard>

      <AppText variant="h3" style={{ marginTop: 8 }}>Drill-down</AppText>
      <RoleHomeCard
        icon="pie-chart-outline"
        title="Full P&L"
        subtitle="Pick a date range, view revenue & expense breakdown."
        onPress={() => router.push("/(accountant)/pnl" as never)}
      />
      <RoleHomeCard
        icon="cash-outline"
        title="Payment reports"
        subtitle="Collections by method, outlet and date."
        onPress={() => router.push("/(accountant)/payment-reports" as never)}
      />
      <RoleHomeCard
        icon="git-compare-outline"
        title="Settlement reconciliation"
        subtitle="Aggregator payouts vs recorded sales."
        onPress={() => router.push("/(accountant)/settlements" as never)}
      />
    </RoleShellScreen>
  );
}
