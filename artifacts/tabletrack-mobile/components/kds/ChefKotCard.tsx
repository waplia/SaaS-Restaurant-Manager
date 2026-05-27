import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useChefColors } from "@/hooks/useChefColors";
import type { KdsTicket, KdsItem } from "@/hooks/useKdsTickets";

export type ChefItemStatus = "pending" | "preparing" | "ready" | "oos";

interface Props {
  ticket: KdsTicket;
  itemChecks: Record<number, ChefItemStatus>;
  onCycleItem: (itemId: number) => void;
  onAccept: (ticket: KdsTicket) => void;
  onStartCooking: (ticket: KdsTicket) => void;
  onMarkReady: (ticket: KdsTicket) => void;
  onDelayReason: (ticket: KdsTicket) => void;
  onReprint?: (ticket: KdsTicket) => void;
  isPending?: boolean;
  canReprint?: boolean;
  waiterName?: string | null;
}

const ORDER_TYPE_META: Record<string, { label: string; color: string }> = {
  dine_in: { label: "Dine-in", color: "#60a5fa" },
  takeaway: { label: "Takeaway", color: "#fb923c" },
  delivery: { label: "Delivery", color: "#c084fc" },
  online: { label: "Online", color: "#22d3ee" },
  online_order: { label: "Online", color: "#22d3ee" },
  qr: { label: "QR Online", color: "#22d3ee" },
  curbside: { label: "Curbside", color: "#facc15" },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  new: { label: "NEW", color: "#60a5fa" },
  pending: { label: "NEW", color: "#60a5fa" },
  preparing: { label: "PREPARING", color: "#f59e0b" },
  in_progress: { label: "PREPARING", color: "#f59e0b" },
  ready: { label: "READY", color: "#34d399" },
  served: { label: "SERVED", color: "#9ca3af" },
  completed: { label: "DONE", color: "#9ca3af" },
  cancelled: { label: "CANCELLED", color: "#f87171" },
};

const ITEM_STATUS_META: Record<ChefItemStatus, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "#fcd34d", bg: "#3f2d11" },
  preparing: { label: "Cooking", color: "#fdba74", bg: "#451a03" },
  ready: { label: "Ready", color: "#86efac", bg: "#064e3b" },
  oos: { label: "86'd", color: "#fca5a5", bg: "#7f1d1d" },
};

export const CHEF_ITEM_CYCLE: Record<ChefItemStatus, ChefItemStatus> = {
  pending: "preparing",
  preparing: "ready",
  ready: "oos",
  oos: "pending",
};

function formatMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Isolated 1Hz timer — only this text re-renders every second.
const LiveTimer = React.memo(function LiveTimer({
  startIso, color,
}: { startIso: string | undefined; color: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const label = startIso ? formatMs(now - new Date(startIso).getTime()) : "00:00";
  return <Text style={[styles.timerText, { color }]}>{label}</Text>;
});

const DelayPulse = React.memo(function DelayPulse({ label }: { label: string }) {
  const anim = React.useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0.55, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return (
    <Animated.View style={[styles.delayBanner, { opacity: anim }]}>
      <Ionicons name="warning" size={14} color="#fef2f2" />
      <Text style={styles.delayBannerText}>{label}</Text>
    </Animated.View>
  );
});

function ChefKotCardImpl({
  ticket, itemChecks, onCycleItem, onAccept, onStartCooking, onMarkReady,
  onDelayReason, onReprint, isPending, canReprint, waiterName,
}: Props) {
  const colors = useChefColors();
  const otMeta = ORDER_TYPE_META[ticket.orderType ?? "dine_in"] ?? { label: ticket.orderType ?? "Order", color: "#9ca3af" };
  const stMeta = STATUS_META[ticket.status] ?? STATUS_META.new;
  const items = (ticket.items ?? []) as KdsItem[];
  const allLocalReady = items.length > 0 && items.every((i) => (itemChecks[i.id] ?? i.status ?? "pending") === "ready");
  const status = String(ticket.status);
  const isNew = status === "new" || status === "pending";
  const isPreparing = status === "preparing" || status === "in_progress";
  const isReady = status === "ready";
  const isHistory = status === "served" || status === "completed" || status === "cancelled";

  const borderLeft = ticket.isDelayed ? "#f87171" : stMeta.color;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: ticket.isDelayed ? "#241310" : colors.card,
          borderColor: ticket.isDelayed ? "#7f1d1d" : colors.border,
          borderLeftColor: borderLeft,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.kotNum, { color: ticket.isDelayed ? "#fecaca" : colors.foreground }]}>
              Order #{ticket.orderDisplayNumber ?? ticket.orderNumber ?? ticket.id}
            </Text>
            <View style={[styles.pill, { backgroundColor: stMeta.color + "22", borderColor: stMeta.color }]}>
              <Text style={[styles.pillText, { color: stMeta.color }]}>KOT #{ticket.id}</Text>
            </View>
            {ticket.isPriority ? (
              <View style={styles.priorityBadge}>
                <Ionicons name="flag" size={12} color="#fef2f2" />
                <Text style={styles.priorityText}>PRIORITY</Text>
              </View>
            ) : null}
            <View style={[styles.pill, { backgroundColor: otMeta.color + "33", borderColor: otMeta.color }]}>
              <Text style={[styles.pillText, { color: otMeta.color }]}>{otMeta.label}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: stMeta.color + "22", borderColor: stMeta.color }]}>
              <Text style={[styles.pillText, { color: stMeta.color }]}>{stMeta.label}</Text>
            </View>
          </View>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {ticket.tableNumber ? `Table ${ticket.tableNumber}` : (ticket.customerName ?? "Walk-in")}
            {ticket.kitchen?.name ? ` · ${ticket.kitchen.name}` : ""}
            {waiterName ? ` · Waiter: ${waiterName}` : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <View style={[styles.timerPill, {
            backgroundColor: ticket.isDelayed ? "#7f1d1d" : colors.surfaceAlt,
            borderColor: ticket.isDelayed ? "#dc2626" : colors.border,
          }]}>
            <Ionicons name="time-outline" size={14} color={ticket.isDelayed ? "#fecaca" : colors.foreground} />
            <LiveTimer startIso={ticket.createdAt} color={ticket.isDelayed ? "#fecaca" : colors.foreground} />
          </View>
        </View>
      </View>

      {ticket.isDelayed ? (
        <DelayPulse label={`DELAYED${(ticket.overdueMinutes ?? 0) > 0 ? ` +${ticket.overdueMinutes}m` : ""}`} />
      ) : null}

      <View style={styles.items}>
        {items.map((item) => {
          const s: ChefItemStatus = (itemChecks[item.id] ?? (item.status as ChefItemStatus) ?? "pending");
          const meta = ITEM_STATUS_META[s] ?? ITEM_STATUS_META.pending;
          const mods = (item.modifiers ?? []) as { name: string; groupName?: string | null; quantity: number }[];
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                if (isHistory) return;
                Haptics.selectionAsync().catch(() => {});
                onCycleItem(item.id);
              }}
              style={({ pressed }) => [
                styles.itemRow,
                { backgroundColor: colors.surface, borderColor: colors.border },
                pressed && !isHistory && { opacity: 0.75 },
              ]}
            >
              <Text style={[styles.qty, { color: colors.primary }]}>{item.quantity}×</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={2}>
                  {item.menuItemName}
                </Text>
                {mods.length > 0 ? (
                  <Text style={[styles.itemMeta, { color: colors.mutedForeground }]} numberOfLines={3}>
                    {mods.map((m) => `${m.groupName ? `${m.groupName}: ` : ""}${m.name}${m.quantity > 1 ? ` ×${m.quantity}` : ""}`).join(" · ")}
                  </Text>
                ) : null}
                {item.notes ? (
                  <View style={[styles.notesBox, { backgroundColor: "#3f2d11", borderColor: "#a16207" }]}>
                    <Ionicons name="alert-circle" size={14} color="#fcd34d" />
                    <Text style={[styles.itemNote, { color: "#fef3c7" }]} numberOfLines={4}>
                      {item.notes}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={[styles.itemStatusPill, { backgroundColor: meta.bg, borderColor: meta.color }]}>
                <Text style={[styles.itemStatusText, { color: meta.color }]}>{meta.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {!isHistory ? (
        <View style={styles.actionsRow}>
          {isNew ? (
            <>
              <Pressable
                onPress={() => onAccept(ticket)}
                disabled={!!isPending}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: colors.primary, opacity: isPending ? 0.5 : pressed ? 0.85 : 1 },
                ]}
              >
                <Ionicons name="checkmark-circle" size={20} color={colors.primaryForeground} />
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Accept</Text>
              </Pressable>
              <Pressable
                onPress={() => onStartCooking(ticket)}
                disabled={!!isPending}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: "#ea580c", opacity: isPending ? 0.5 : pressed ? 0.85 : 1 },
                ]}
              >
                <Ionicons name="flame" size={20} color="#fff" />
                <Text style={styles.primaryBtnText}>Start Cooking</Text>
              </Pressable>
            </>
          ) : null}
          {isPreparing ? (
            <Pressable
              onPress={() => onMarkReady(ticket)}
              disabled={!!isPending}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: allLocalReady ? "#16a34a" : "#15803d",
                  flex: 2,
                  opacity: isPending ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons name="checkmark-done-circle" size={20} color="#fff" />
              <Text style={styles.primaryBtnText}>
                {allLocalReady ? "All Ready · Mark KOT Ready" : "Mark Full KOT Ready"}
              </Text>
            </Pressable>
          ) : null}
          {isReady ? (
            <Pressable
              onPress={() => onMarkReady(ticket)}
              disabled={!!isPending}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: "#374151", flex: 2, opacity: isPending ? 0.5 : pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="restaurant" size={20} color="#fff" />
              <Text style={styles.primaryBtnText}>Mark Served</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => onDelayReason(ticket)}
            style={({ pressed }) => [styles.iconBtn, { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 }]}
            accessibilityLabel="Delay reason"
          >
            <Ionicons name="warning-outline" size={20} color="#fbbf24" />
          </Pressable>
          {onReprint && canReprint ? (
            <Pressable
              onPress={() => onReprint(ticket)}
              style={({ pressed }) => [styles.iconBtn, { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 }]}
              accessibilityLabel="Reprint KOT"
            >
              <Ionicons name="print-outline" size={20} color={colors.foreground} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderLeftWidth: 6,
    padding: 14,
    marginBottom: 14,
    gap: 12,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  kotNum: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  subtitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  priorityBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: "#b91c1c" },
  priorityText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fef2f2", letterSpacing: 0.4 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  pillText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  timerPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  timerText: { fontSize: 18, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  delayBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, alignSelf: "flex-start", backgroundColor: "#b91c1c" },
  delayBannerText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fef2f2", letterSpacing: 0.6 },
  items: { gap: 8 },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1 },
  qty: { fontSize: 20, fontFamily: "Inter_700Bold", minWidth: 36 },
  itemName: { fontSize: 17, fontFamily: "Inter_600SemiBold", lineHeight: 22 },
  itemMeta: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 3 },
  notesBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 6, padding: 6, borderRadius: 6, borderWidth: 1 },
  itemNote: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 17 },
  itemStatusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, alignSelf: "flex-start" },
  itemStatusText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  actionsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  primaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 12 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  iconBtn: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 12 },
});

function areEqual(prev: Props, next: Props) {
  return (
    prev.ticket === next.ticket &&
    prev.itemChecks === next.itemChecks &&
    prev.isPending === next.isPending &&
    prev.canReprint === next.canReprint &&
    prev.waiterName === next.waiterName
  );
}

export const ChefKotCard = React.memo(ChefKotCardImpl, areEqual);
