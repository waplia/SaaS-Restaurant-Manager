import React from "react";
import { Modal, View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { KdsTicket } from "@/hooks/useKdsTickets";
import { formatOrderNumber } from "@/lib/orderNumber";

function formatTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const STATUS_COLOR: Record<string, string> = {
  served: "#15803d",
  completed: "#15803d",
  cancelled: "#b91c1c",
};

export function KdsHistoryDetailSheet({ ticket, onClose }: { ticket: KdsTicket | null; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const visible = !!ticket;
  if (!ticket) {
    return (
      <Modal transparent visible={false} animationType="slide" onRequestClose={onClose} />
    );
  }
  const statusColor = STATUS_COLOR[String(ticket.status)] ?? colors.mutedForeground;
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Order #{formatOrderNumber(ticket.orderDisplayNumber ?? ticket.orderNumber ?? ticket.id)}
            </Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              {ticket.tableNumber ? `Table ${ticket.tableNumber}` : ticket.customerName ?? "Walk-in"}
              {ticket.kitchen?.name ? ` · ${ticket.kitchen.name}` : ""}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: statusColor + "22" }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {String(ticket.status).toUpperCase()}
            </Text>
          </View>
        </View>

        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 12, paddingVertical: 8 }}>
          <View style={[styles.timing, { borderColor: colors.border }]}>
            <TimingRow label="Created" value={formatTime(ticket.createdAt)} />
            <TimingRow label="Started" value={formatTime(ticket.startedAt as string | undefined)} />
            <TimingRow label="Completed" value={formatTime((ticket as { completedAt?: string | null }).completedAt)} />
            {ticket.elapsedMinutes != null ? (
              <TimingRow label="Total time" value={`${ticket.elapsedMinutes} min`} />
            ) : null}
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Items</Text>
            {(ticket.items ?? []).map((item) => {
              const mods = (item.modifiers ?? []) as { name: string; groupName?: string | null; quantity: number }[];
              return (
                <View key={item.id} style={[styles.itemRow, { borderColor: colors.border }]}>
                  <Text style={[styles.qty, { color: colors.primary }]}>{item.quantity}×</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemName, { color: colors.foreground }]}>{item.menuItemName}</Text>
                    {mods.length > 0 ? (
                      <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>
                        {mods.map((m) => `${m.groupName ? `${m.groupName}: ` : ""}${m.name}${m.quantity > 1 ? ` ×${m.quantity}` : ""}`).join(" · ")}
                      </Text>
                    ) : null}
                    {item.notes ? <Text style={styles.itemNote}>📝 {item.notes}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>

        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.closeBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Ionicons name="close" size={18} color="#fff" />
          <Text style={{ color: "#fff", fontFamily: "Inter_700Bold" }}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function TimingRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.timingRow}>
      <Text style={[styles.timingLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.timingValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 8 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "#d1d5db" },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  timing: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  timingRow: { flexDirection: "row", justifyContent: "space-between" },
  timingLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  timingValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  itemRow: { flexDirection: "row", gap: 10, padding: 10, borderWidth: 1, borderRadius: 10, alignItems: "flex-start" },
  qty: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 30 },
  itemName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  itemMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  itemNote: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#c2410c", marginTop: 2 },
  closeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, marginTop: 4 },
});
