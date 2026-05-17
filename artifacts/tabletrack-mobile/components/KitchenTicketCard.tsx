import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface TicketItemModifier {
  name: string;
  groupName?: string | null;
  quantity: number;
}

interface TicketItem {
  name: string;
  quantity: number;
  notes?: string | null;
  modifiers?: TicketItemModifier[];
}

interface KitchenTicketCardProps {
  ticketId: number;
  orderNumber: string;
  tableLabel?: string | null;
  items: TicketItem[];
  status: string;
  createdAt: string;
  onMarkReady?: (id: number) => void;
  isDelayed?: boolean;
  overdueMinutes?: number;
  delayAlertCount?: number;
  expectedPrepMinutes?: number | null;
}

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  new: { color: "#f59e0b", label: "New" },
  pending: { color: "#f59e0b", label: "Pending" },
  preparing: { color: "#3b82f6", label: "Cooking" },
  in_progress: { color: "#3b82f6", label: "Cooking" },
  ready: { color: "#22c55e", label: "Ready" },
  served: { color: "#6b7280", label: "Served" },
};

export function KitchenTicketCard({
  ticketId, orderNumber, tableLabel, items, status, createdAt, onMarkReady,
  isDelayed, overdueMinutes, delayAlertCount, expectedPrepMinutes,
}: KitchenTicketCardProps) {
  const colors = useColors();
  const sm = STATUS_MAP[status] ?? STATUS_MAP.pending;
  const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  const hasAlertedDelay = (delayAlertCount ?? 0) > 0;
  const showDelay = hasAlertedDelay || (isDelayed ?? false);
  const overdue = overdueMinutes ?? 0;

  return (
    <View style={[
      styles.card,
      { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: sm.color },
      showDelay && { borderLeftColor: "#dc2626", borderColor: "#fecaca", backgroundColor: "#fef2f2" },
    ]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.order, { color: colors.foreground }, showDelay && { color: "#7f1d1d" }]}>#{orderNumber}</Text>
          {tableLabel ? <Text style={[styles.table, { color: colors.mutedForeground }]}>{tableLabel}</Text> : null}
          {showDelay ? (
            <View style={styles.delayBadge}>
              <Ionicons name="warning" size={11} color="#dc2626" />
              <Text style={styles.delayText}>
                DELAYED{overdue > 0 ? ` +${overdue}m` : ""}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.badge, { backgroundColor: sm.color + "22" }]}>
            <Text style={[styles.badgeText, { color: sm.color }]}>{sm.label}</Text>
          </View>
          <Text style={[styles.elapsed, { color: showDelay ? "#dc2626" : colors.mutedForeground }]}>
            {elapsed}m ago{expectedPrepMinutes ? ` / ${expectedPrepMinutes}m` : ""}
          </Text>
        </View>
      </View>
      <View style={styles.items}>
        {items.map((item, i) => (
          <View key={i}>
            <View style={styles.itemRow}>
              <Text style={[styles.qty, { color: colors.primary }]}>{item.quantity}×</Text>
              <Text style={[styles.itemName, { color: colors.foreground }]}>{item.name}</Text>
              {item.notes ? <Text style={[styles.notes, { color: colors.mutedForeground }]}>{item.notes}</Text> : null}
            </View>
            {item.modifiers && item.modifiers.length > 0 ? (
              <View style={{ paddingLeft: 24, marginTop: 2 }}>
                {item.modifiers.map((m, j) => (
                  <Text key={j} style={[styles.notes, { color: colors.mutedForeground }]}>
                    + {m.groupName ? `${m.groupName}: ` : ""}{m.name}{m.quantity > 1 ? ` ×${m.quantity}` : ""}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {(status === "new" || status === "pending" || status === "preparing" || status === "in_progress") && onMarkReady ? (
        <Pressable
          style={({ pressed }) => [styles.readyBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          onPress={() => onMarkReady(ticketId)}
        >
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={styles.readyBtnText}>Mark Ready</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerRight: { alignItems: "flex-end", gap: 4 },
  order: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  table: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  delayBadge: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4, alignSelf: "flex-start", backgroundColor: "#fee2e2", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  delayText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#dc2626", letterSpacing: 0.3 },
  elapsed: { fontSize: 11, fontFamily: "Inter_400Regular" },
  items: { gap: 4 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  qty: { fontSize: 14, fontFamily: "Inter_700Bold", width: 28 },
  itemName: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  notes: { fontSize: 11, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  readyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  readyBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
