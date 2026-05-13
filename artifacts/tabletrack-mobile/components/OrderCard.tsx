import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

interface OrderCardProps {
  orderNumber: string;
  tableLabel?: string | null;
  itemCount: number;
  total: string | number;
  status: string;
  orderType: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: "#fff7ed", text: "#c2410c" },
  in_progress: { bg: "#eff6ff", text: "#1d4ed8" },
  ready: { bg: "#f0fdf4", text: "#15803d" },
  completed: { bg: "#f9fafb", text: "#6b7280" },
  cancelled: { bg: "#fef2f2", text: "#b91c1c" },
};

export function OrderCard({ orderNumber, tableLabel, itemCount, total, status, orderType, createdAt }: OrderCardProps) {
  const colors = useColors();
  const sc = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  const timeStr = new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={[styles.number, { color: colors.foreground }]}>#{orderNumber}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {tableLabel ?? orderType.replace("_", " ")} · {itemCount} item{itemCount !== 1 ? "s" : ""} · {timeStr}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.total, { color: colors.foreground }]}>₹{Number(total).toLocaleString()}</Text>
          <View style={[styles.badge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.badgeText, { color: sc.text }]}>{status.replace("_", " ")}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  left: { flex: 1, gap: 4 },
  right: { alignItems: "flex-end", gap: 6 },
  number: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  total: { fontSize: 16, fontFamily: "Inter_700Bold" },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
});
