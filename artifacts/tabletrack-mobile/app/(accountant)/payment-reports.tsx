import React from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AppText, AppCard, StatusChip } from "@/components/ui";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/theme";

interface PaymentSummary {
  totalRevenue?: number;
  cash?: number;
  card?: number;
  upi?: number;
  online?: number;
  refunds?: number;
  byOutlet?: Array<{ outletId: number; outletName?: string; total: number }>;
  byMethod?: Record<string, number>;
}

const RANGES = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function dateNDaysAgo(n: number) {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

export default function AccountantPaymentReportsScreen() {
  const t = useTheme();
  const { restaurantId } = useAuth();
  const [rangeIdx, setRangeIdx] = React.useState(0);

  const to = new Date().toISOString().slice(0, 10);
  const from = dateNDaysAgo(RANGES[rangeIdx].days);

  const summaryQ = useQuery({
    queryKey: ["acct-pay-report", restaurantId, from, to],
    queryFn: () => customFetch<PaymentSummary>(
      RANGES[rangeIdx].days === 0
        ? `/api/restaurants/${restaurantId}/payments/summary?date=${to}`
        : `/api/restaurants/${restaurantId}/payments/summary?from=${from}&to=${to}`,
    ).catch(() => ({} as PaymentSummary)),
    enabled: !!restaurantId,
  });

  const sum = summaryQ.data ?? {};
  const methodEntries: Array<[string, number]> = sum.byMethod
    ? Object.entries(sum.byMethod)
    : [
        ["cash", sum.cash ?? 0],
        ["upi", sum.upi ?? 0],
        ["card", sum.card ?? 0],
        ["online", sum.online ?? 0],
      ];
  const methodTotal = methodEntries.reduce((s, [, v]) => s + v, 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="Payment reports" subtitle="Collections by method & outlet" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={summaryQ.isFetching} onRefresh={() => summaryQ.refetch()} tintColor={t.colors.primary} />}
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md, paddingBottom: 40 }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          {RANGES.map((r, i) => {
            const active = i === rangeIdx;
            return (
              <Pressable
                key={r.label}
                onPress={() => setRangeIdx(i)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: t.radius.md,
                  borderWidth: 1,
                  borderColor: active ? t.colors.primary : t.colors.border,
                  backgroundColor: active ? t.colors.accent : t.colors.card,
                  alignItems: "center",
                }}
              >
                <AppText variant="bodyMd" color={active ? "primary" : undefined}>{r.label}</AppText>
              </Pressable>
            );
          })}
        </View>

        <AppCard>
          <AppText variant="micro" color="mutedForeground" style={{ letterSpacing: 0.5 }}>TOTAL COLLECTIONS</AppText>
          <AppText variant="hero" style={{ marginTop: 4 }}>{inr(sum.totalRevenue ?? 0)}</AppText>
          <AppText variant="small" color="mutedForeground" style={{ marginTop: 4 }}>
            Refunds {inr(sum.refunds ?? 0)}
          </AppText>
        </AppCard>

        <AppText variant="h3">By payment method</AppText>
        <AppCard padding={0}>
          {methodEntries.map(([k, v], i) => {
            const pct = methodTotal > 0 ? (v / methodTotal) * 100 : 0;
            return (
              <View
                key={k}
                style={{
                  padding: 14,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: t.colors.border,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <AppText variant="bodyMd" style={{ textTransform: "capitalize" }}>{k}</AppText>
                  <AppText variant="bodyMd">{inr(v)}</AppText>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.muted, overflow: "hidden" }}>
                  <View style={{ width: `${pct}%`, height: "100%", backgroundColor: t.colors.primary }} />
                </View>
                <AppText variant="micro" color="mutedForeground">{pct.toFixed(0)}% of total</AppText>
              </View>
            );
          })}
        </AppCard>

        {Array.isArray(sum.byOutlet) && sum.byOutlet.length > 0 ? (
          <>
            <AppText variant="h3">By outlet</AppText>
            <AppCard padding={0}>
              {sum.byOutlet.map((o, i) => (
                <View
                  key={o.outletId}
                  style={{
                    padding: 14,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: t.colors.border,
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <AppText variant="bodyMd" numberOfLines={1}>{o.outletName ?? `Outlet #${o.outletId}`}</AppText>
                  <AppText variant="bodyMd">{inr(o.total)}</AppText>
                </View>
              ))}
            </AppCard>
          </>
        ) : (
          <StatusChip label="Outlet split not available for this range" tone="neutral" size="xs" />
        )}
      </ScrollView>
    </View>
  );
}
