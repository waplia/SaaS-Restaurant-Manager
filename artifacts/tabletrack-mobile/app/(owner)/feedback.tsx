import React from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";

type Review = {
  id: number;
  rating: number;
  comment?: string | null;
  customerName?: string;
  source?: string;
  createdAt: string;
  reply?: string | null;
};

export default function FeedbackScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";

  const q = useQuery({
    queryKey: ["reviews", restaurantId],
    queryFn: () => customFetch<{ reviews?: Review[] } | Review[]>(`/restaurants/${restaurantId}/reviews?limit=50`).catch(() => []),
  });
  const list: Review[] = Array.isArray(q.data) ? q.data : (q.data?.reviews ?? []);
  const avg = list.length ? list.reduce((s, r) => s + (r.rating ?? 0), 0) / list.length : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Feedback" subtitle={list.length ? `Avg ${avg.toFixed(1)} ★ from ${list.length}` : undefined} showBack />
      {list.length === 0 ? (
        <EmptyState icon="star-outline" title="No reviews yet" message="Reviews from QR menus and Google will appear here." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: isWeb ? 100 : 100 }}
        >
          {list.map(r => (
            <View key={r.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.headerRow}>
                <View style={{ flexDirection: "row", gap: 2 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Ionicons
                      key={i}
                      name={i < r.rating ? "star" : "star-outline"}
                      size={14}
                      color={i < r.rating ? "#f59e0b" : colors.mutedForeground}
                    />
                  ))}
                </View>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {r.customerName ?? "Guest"} · {new Date(r.createdAt).toLocaleDateString()}
                  {r.source ? ` · ${r.source}` : ""}
                </Text>
              </View>
              {r.comment ? (
                <Text style={[styles.comment, { color: colors.foreground }]}>{r.comment}</Text>
              ) : null}
              {r.reply ? (
                <View style={[styles.reply, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.replyLabel, { color: colors.primary }]}>Your reply</Text>
                  <Text style={[styles.replyText, { color: colors.foreground }]}>{r.reply}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  comment: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  reply: { padding: 10, borderRadius: 10, gap: 4 },
  replyLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  replyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
