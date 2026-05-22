import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { MiniBarChart } from "@/components/MiniBarChart";
import { BRAND } from "@/constants/brand";

type Trend = { date: string; revenue: number };
type Popular = { itemName: string; quantity: number; revenue?: number };

function ReportsScreen() {
  const colors = useColors();
  // `effectiveRestaurantId` honours the outlet picked on the home dashboard,
  // so reports always reflect the selected outlet's sales only. For owners
  // who haven't picked one it falls back to their own restaurant id.
  const { effectiveRestaurantId: restaurantId, outletScopeId } = useAuth();
  const isWeb = Platform.OS === "web";

  const trendQ = useQuery({
    queryKey: ["revenue-trend-7d", restaurantId, outletScopeId],
    queryFn: () => customFetch<Trend[]>(`/api/restaurants/${restaurantId}/dashboard/revenue-trend?days=7${outletScopeId != null ? `&branchId=${outletScopeId}` : ""}`).catch(() => []),
  });
  const popularQ = useQuery({
    queryKey: ["popular-items-7d", restaurantId, outletScopeId],
    queryFn: () => customFetch<Popular[]>(`/api/restaurants/${restaurantId}/dashboard/popular-items?days=7${outletScopeId != null ? `&branchId=${outletScopeId}` : ""}`).catch(() => []),
  });
  // Resolve the active outlet's display name so the report header can tell
  // the owner exactly whose sales these numbers represent. The numbers are
  // always single-restaurant scoped on this screen (the API is per-restaurant),
  // so even when no outlet was explicitly picked we still surface the actual
  // outlet name instead of falsely claiming "All outlets".
  const outletNameQ = useQuery({
    queryKey: ["report-outlet-name", restaurantId],
    queryFn: () => customFetch<{ name?: string }>(`/api/restaurants/${restaurantId}`).catch(() => ({})),
    enabled: restaurantId != null,
  });
  const outletLabel = outletNameQ.data?.name
    ?? (outletScopeId == null ? "Your outlet" : `Outlet #${outletScopeId}`);
  const trend = Array.isArray(trendQ.data) ? trendQ.data : [];
  const popular = Array.isArray(popularQ.data) ? popularQ.data : [];
  const toNum = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const trendValues = trend.map(t => ({ date: t.date, value: toNum(t.revenue) }));
  const total = trendValues.reduce((s, t) => s + t.value, 0);

  const reports: Array<{ key: string; label: string; desc: string; icon: keyof typeof Ionicons.glyphMap; tone: string }> = [
    { key: "sales", label: "Sales summary", desc: "By day, hour, channel", icon: "trending-up", tone: BRAND.success },
    { key: "items", label: "Item performance", desc: "Top sellers, slow movers", icon: "fast-food-outline", tone: BRAND.primary },
    { key: "staff", label: "Staff performance", desc: "Sales, tips, attendance", icon: "people-outline", tone: BRAND.info },
    { key: "inventory", label: "Inventory & waste", desc: "Stock turnover, wastage %", icon: "cube-outline", tone: BRAND.warning },
    { key: "tax", label: "Tax & GST", desc: "GSTR-1, B2B/B2C splits", icon: "document-text-outline", tone: "#0891b2" },
    { key: "fraud", label: "Fraud watch", desc: "AI-flagged voids & discounts", icon: "shield-checkmark-outline", tone: BRAND.danger },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Reports" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: isWeb ? 100 : 100 }}>
        <View style={[styles.scopePill, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40" }]}>
          <Ionicons name="business-outline" size={14} color={colors.primary} />
          <Text style={[styles.scopePillText, { color: colors.primary }]} numberOfLines={1}>
            Showing: {outletLabel}
          </Text>
          <Text style={[styles.scopePillHint, { color: colors.mutedForeground }]} numberOfLines={1}>
            Change from Home
          </Text>
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.headerRow}>
            <View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Revenue (last 7 days)</Text>
              <Text style={[styles.value, { color: colors.foreground }]}>₹{total.toFixed(0)}</Text>
            </View>
            <Ionicons name="bar-chart" size={28} color={colors.primary} />
          </View>
          {trend.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <MiniBarChart data={trendValues.map(t => ({ label: (t.date ?? "").slice(5), value: t.value }))} />
            </View>
          ) : null}
        </View>

        {popular.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 8 }]}>
            <Text style={[styles.heading, { color: colors.foreground }]}>Top items (7 days)</Text>
            {popular.slice(0, 5).map((p, i) => (
              <View key={p.itemName + i} style={styles.popRow}>
                <Text style={[styles.popRank, { color: colors.mutedForeground }]}>{i + 1}.</Text>
                <Text style={[styles.popName, { color: colors.foreground }]} numberOfLines={1}>{p.itemName}</Text>
                <Text style={[styles.popQty, { color: colors.mutedForeground }]}>{p.quantity}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={[styles.section, { color: colors.mutedForeground }]}>Open report</Text>
        {reports.map(r => (
          <Pressable
            key={r.key}
            style={({ pressed }) => [styles.reportRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: r.tone + "20" }]}>
              <Ionicons name={r.icon} size={18} color={r.tone} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.reportTitle, { color: colors.foreground }]}>{r.label}</Text>
              <Text style={[styles.reportDesc, { color: colors.mutedForeground }]} numberOfLines={1}>{r.desc}</Text>
            </View>
            <Ionicons name="open-outline" size={16} color={colors.mutedForeground} />
          </Pressable>
        ))}
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          Detailed report builders are available in the web dashboard.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 14, borderWidth: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  value: { fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 2 },
  heading: { fontSize: 14, fontFamily: "Inter_700Bold" },
  popRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  popRank: { fontSize: 12, fontFamily: "Inter_600SemiBold", width: 18 },
  popName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  popQty: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  section: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 4 },
  reportRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  iconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  reportTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  reportDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  note: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8, lineHeight: 18 },
  scopePill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  scopePillText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scopePillHint: { fontSize: 11, fontFamily: "Inter_500Medium" },
});

import { withPlanGate } from "@/components/PlanGate";
export default withPlanGate(ReportsScreen, "advanced_reports");
