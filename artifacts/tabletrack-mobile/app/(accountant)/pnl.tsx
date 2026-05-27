import React from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AppText, AppCard, StatusChip } from "@/components/ui";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/theme";

interface Bucket { name?: string; total?: number; amount?: number }
interface PnlResp {
  from?: string; to?: string;
  revenue?: { total?: number; breakdown?: Bucket[] };
  expenses?: { total?: number; breakdown?: Bucket[] };
  grossProfit?: number;
  netProfit?: number;
  grossMargin?: number;
}

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

export default function AccountantPnlScreen() {
  const t = useTheme();
  const { restaurantId } = useAuth();
  const [rangeIdx, setRangeIdx] = React.useState(1);

  const from = daysAgo(RANGES[rangeIdx].days);
  const to = today();

  const pnlQ = useQuery({
    queryKey: ["acct-pnl", restaurantId, from, to],
    queryFn: () => customFetch<PnlResp>(`/api/restaurants/${restaurantId}/pnl?from=${from}&to=${to}`).catch(() => ({} as PnlResp)),
    enabled: !!restaurantId,
  });

  const d = pnlQ.data ?? {};
  const revenue = d.revenue?.total ?? 0;
  const expenses = d.expenses?.total ?? 0;
  const net = d.netProfit ?? (revenue - expenses);
  const margin = d.grossMargin;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="P&L" subtitle={`${RANGES[rangeIdx].label} · ${from} → ${to}`} />
      <ScrollView
        refreshControl={<RefreshControl refreshing={pnlQ.isFetching} onRefresh={() => pnlQ.refetch()} tintColor={t.colors.primary} />}
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
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
            <View>
              <AppText variant="micro" color="mutedForeground" style={{ letterSpacing: 0.5 }}>NET PROFIT</AppText>
              <AppText variant="hero" style={{ marginTop: 4 }}>{inr(net)}</AppText>
            </View>
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

        {Array.isArray(d.revenue?.breakdown) && d.revenue!.breakdown!.length > 0 ? (
          <>
            <AppText variant="h3">Revenue breakdown</AppText>
            <AppCard padding={0}>
              {d.revenue!.breakdown!.map((b, i) => (
                <Row key={i} label={b.name ?? `#${i + 1}`} value={Number(b.total ?? b.amount ?? 0)} first={i === 0} />
              ))}
            </AppCard>
          </>
        ) : null}

        {Array.isArray(d.expenses?.breakdown) && d.expenses!.breakdown!.length > 0 ? (
          <>
            <AppText variant="h3">Expense breakdown</AppText>
            <AppCard padding={0}>
              {d.expenses!.breakdown!.map((b, i) => (
                <Row key={i} label={b.name ?? `#${i + 1}`} value={Number(b.total ?? b.amount ?? 0)} first={i === 0} />
              ))}
            </AppCard>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, first }: { label: string; value: number; first: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        padding: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.colors.border,
        flexDirection: "row",
        justifyContent: "space-between",
      }}
    >
      <AppText variant="bodyMd" numberOfLines={1} style={{ flex: 1 }}>{label}</AppText>
      <AppText variant="bodyMd">{inr(value)}</AppText>
    </View>
  );
}
