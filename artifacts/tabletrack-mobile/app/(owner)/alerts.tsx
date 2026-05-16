import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { EmptyState } from "@/components/EmptyState";
import { OfflineBanner } from "@/components/OfflineBanner";

type Severity = "critical" | "high" | "medium" | "low";

interface AlertRow {
  id: string;
  severity: Severity;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  href?: string;
}

const SEV: Record<Severity, { color: string; label: string }> = {
  critical: { color: "#dc2626", label: "Critical" },
  high: { color: "#ea580c", label: "High" },
  medium: { color: "#d97706", label: "Medium" },
  low: { color: "#2563eb", label: "Low" },
};

export default function AlertsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { restaurantId } = useAuth();

  type OrdersResp = { orders?: Array<{ id: number; orderNumber?: string; status?: string }> };
  type FraudResp = { alerts?: Array<{ id: number; severity?: Severity; description?: string }> };
  type ReviewsResp = { reviews?: Array<{ id: number; rating?: number; comment?: string }> };
  type AttendanceResp = { absent?: Array<{ userId: number; name: string }> };

  const ordersQ = useQuery({
    queryKey: ["alerts-orders", restaurantId],
    queryFn: () => customFetch<OrdersResp>(`/api/restaurants/${restaurantId}/orders?status=pending&limit=20`).catch(() => ({} as OrdersResp)),
  });
  const inventoryQ = useQuery({
    queryKey: ["alerts-inventory", restaurantId],
    queryFn: () => customFetch<Array<{ id: number; name: string; quantity?: number | string; reorderPoint?: number | string }>>(`/api/restaurants/${restaurantId}/inventory?lowStock=true`).catch(() => []),
  });
  const fraudQ = useQuery({
    queryKey: ["alerts-fraud", restaurantId],
    queryFn: () => customFetch<FraudResp>(`/api/restaurants/${restaurantId}/fraud-alerts?status=open&limit=10`).catch(() => ({} as FraudResp)),
  });
  const reviewsQ = useQuery({
    queryKey: ["alerts-reviews", restaurantId],
    queryFn: () => customFetch<ReviewsResp>(`/api/restaurants/${restaurantId}/reviews?maxRating=2&limit=10`).catch(() => ({} as ReviewsResp)),
  });
  const kdsQ = useQuery({
    queryKey: ["alerts-kds-delays", restaurantId],
    queryFn: () => customFetch<Array<{ id: number; delaySeconds?: number; orderId?: number }>>(`/api/restaurants/${restaurantId}/kitchen/tickets?delayed=true`).catch(() => []),
  });
  const attendanceQ = useQuery({
    queryKey: ["alerts-attendance", restaurantId],
    queryFn: () => customFetch<AttendanceResp>(`/api/restaurants/${restaurantId}/attendance/today`).catch(() => ({} as AttendanceResp)),
  });

  const isLoading = ordersQ.isLoading || inventoryQ.isLoading || fraudQ.isLoading || reviewsQ.isLoading;
  const refetch = () => {
    ordersQ.refetch(); inventoryQ.refetch(); fraudQ.refetch();
    reviewsQ.refetch(); kdsQ.refetch(); attendanceQ.refetch();
  };
  const isRefetching = ordersQ.isRefetching || inventoryQ.isRefetching;

  const rows: AlertRow[] = [];
  const pendingOrders = (Array.isArray(ordersQ.data?.orders) ? ordersQ.data!.orders : []).length;
  if (pendingOrders > 0) rows.push({
    id: "pending-orders", severity: "high", icon: "alert-circle",
    title: `${pendingOrders} pending order${pendingOrders > 1 ? "s" : ""}`,
    body: "Orders waiting to be accepted",
    href: "/(owner)/orders",
  });
  const lowStock = (Array.isArray(inventoryQ.data) ? inventoryQ.data : []).length;
  if (lowStock > 0) rows.push({
    id: "low-stock", severity: lowStock > 5 ? "critical" : "high", icon: "warning",
    title: `${lowStock} item${lowStock > 1 ? "s" : ""} below reorder point`,
    body: "Tap to view stock and place a purchase order",
    href: "/(owner)/inventory",
  });
  const delays = (Array.isArray(kdsQ.data) ? kdsQ.data : []).length;
  if (delays > 0) rows.push({
    id: "kds-delays", severity: "critical", icon: "flame",
    title: `${delays} kitchen ticket${delays > 1 ? "s" : ""} delayed`,
    body: "Kitchen is running behind on these orders",
    href: "/(owner)/kitchen",
  });
  for (const a of (Array.isArray(fraudQ.data?.alerts) ? fraudQ.data!.alerts : [])) {
    rows.push({
      id: `fraud-${a.id}`, severity: (a.severity as Severity) ?? "medium",
      icon: "shield-checkmark", title: "Suspicious staff activity",
      body: a.description ?? "Review the latest AI fraud alert",
      href: "/(owner)/reports",
    });
  }
  const lowReviews = reviewsQ.data?.reviews ?? [];
  if (lowReviews.length > 0) rows.push({
    id: "low-reviews", severity: "high", icon: "star",
    title: `${lowReviews.length} new low rating${lowReviews.length > 1 ? "s" : ""}`,
    body: "Recover customers with an AI reply",
    href: "/(owner)/feedback",
  });
  const absent = attendanceQ.data?.absent?.length ?? 0;
  if (absent > 0) rows.push({
    id: "absent-staff", severity: "medium", icon: "people",
    title: `${absent} staff absent today`,
    body: "Reassign shifts or contact them",
    href: "/(owner)/attendance",
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 67 : insets.top, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Alerts</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>Critical things needing your attention</Text>
      </View>
      <OfflineBanner />
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        contentContainerStyle={{
          padding: 16, gap: 10,
          paddingBottom: isWeb ? 34 + 100 : insets.bottom + 100,
        }}
      >
        {!isLoading && rows.length === 0 ? (
          <View style={{ marginTop: 40 }}>
            <EmptyState icon="checkmark-circle-outline" title="All clear" message="No alerts right now. Pull down to refresh." />
          </View>
        ) : (
          rows.map(r => {
            const sev = SEV[r.severity];
            return (
              <Pressable
                key={r.id}
                onPress={() => r.href && router.push(r.href as never)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <View style={[styles.sevDot, { backgroundColor: sev.color }]} />
                <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
                  <Ionicons name={r.icon} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{r.title}</Text>
                    <Text style={[styles.sevText, { color: sev.color }]}>{sev.label}</Text>
                  </View>
                  <Text style={[styles.body, { color: colors.mutedForeground }]} numberOfLines={2}>{r.body}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12, gap: 4 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 16 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  sevDot: { width: 4, height: 36, borderRadius: 2 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "space-between" },
  rowTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sevText: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  body: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
