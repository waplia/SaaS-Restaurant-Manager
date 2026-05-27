import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import type { KdsTicket, KdsItem } from "@/hooks/useKdsTickets";

interface Props {
  ticket: KdsTicket;
  itemChecks: Record<number, "pending" | "preparing" | "ready" | "oos">;
  onCycleItem: (itemId: number) => void;
  onPrimaryAction: (ticket: KdsTicket) => void;
  onCancel: (ticket: KdsTicket) => void;
  onPriority?: (ticket: KdsTicket) => void;
  onBump?: (ticket: KdsTicket) => void;
  onReprint?: (ticket: KdsTicket) => void;
  isPending?: boolean;
}

const ORDER_TYPE_META: Record<string, { label: string; color: string }> = {
  dine_in: { label: "Dine-in", color: "#1d4ed8" },
  takeaway: { label: "Takeaway", color: "#c2410c" },
  delivery: { label: "Delivery", color: "#7e22ce" },
  online: { label: "Online", color: "#0891b2" },
  online_order: { label: "Online", color: "#0891b2" },
  qr: { label: "QR Online", color: "#0891b2" },
};

export const STATUS_META: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "#3b82f6" },
  pending: { label: "New", color: "#3b82f6" },
  preparing: { label: "Preparing", color: "#f97316" },
  in_progress: { label: "Preparing", color: "#f97316" },
  ready: { label: "Ready", color: "#22c55e" },
  served: { label: "Served", color: "#6b7280" },
  completed: { label: "Done", color: "#6b7280" },
  cancelled: { label: "Cancelled", color: "#b91c1c" },
};

const PRIMARY_FOR_STATUS: Record<string, { label: string; next: string; color: string } | null> = {
  new: { label: "Start Preparing", next: "preparing", color: "#f97316" },
  pending: { label: "Start Preparing", next: "preparing", color: "#f97316" },
  preparing: { label: "Mark Ready", next: "ready", color: "#16a34a" },
  in_progress: { label: "Mark Ready", next: "ready", color: "#16a34a" },
  ready: { label: "Mark Served", next: "served", color: "#6b7280" },
  served: null,
  completed: null,
  cancelled: null,
};

const ITEM_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "#6b7280", bg: "#f3f4f6" },
  preparing: { label: "Prep", color: "#1d4ed8", bg: "#dbeafe" },
  ready: { label: "Ready", color: "#15803d", bg: "#dcfce7" },
  oos: { label: "Out", color: "#b91c1c", bg: "#fee2e2" },
};

const ITEM_CYCLE: Record<string, "pending" | "preparing" | "ready" | "oos"> = {
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

// Isolated ticker. Keeping the 1-Hz interval inside its own tiny component
// means only THIS text re-renders every second — not the whole card. Before
// this split, 10 visible tickets caused 10 full card re-renders per second,
// which is what was making the KDS list lag when scrolling.
const LiveTimerText = React.memo(function LiveTimerText({
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

// Isolated pulse. Uses opacity (native-driver compatible) instead of an
// interpolated background colour, so the animation runs entirely on the
// UI thread and never blocks JS during scrolling.
const PulseBanner = React.memo(function PulseBanner({ label }: { label: string }) {
  const anim = React.useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.6, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return (
    <Animated.View style={[styles.delayBanner, { backgroundColor: "#fecaca", opacity: anim }]}>
      <Ionicons name="warning" size={12} color="#b91c1c" />
      <Text style={styles.delayBannerText}>{label}</Text>
    </Animated.View>
  );
});

function KdsOrderCardImpl({ ticket, itemChecks, onCycleItem, onPrimaryAction, onCancel, onPriority, onBump, onReprint, isPending }: Props) {
  const colors = useColors();
  const otMeta = ORDER_TYPE_META[ticket.orderType ?? "dine_in"] ?? { label: ticket.orderType ?? "Order", color: "#6b7280" };
  const stMeta = STATUS_META[ticket.status] ?? STATUS_META.new;
  const primary = PRIMARY_FOR_STATUS[ticket.status] ?? null;
  const items = (ticket.items ?? []) as KdsItem[];
  const payment = (ticket.paymentStatus ?? "").toLowerCase();
  const paymentLabel = payment === "paid" ? "Paid" : payment === "partial" ? "Partial" : "Unpaid";
  const paymentColor = payment === "paid" ? "#15803d" : payment === "partial" ? "#c2410c" : "#b91c1c";
  const allLocalReady = items.length > 0 && items.every((i) => (itemChecks[i.id] ?? i.status ?? "pending") === "ready");
  const isHistory = ticket.status === "served" || ticket.status === "completed" || ticket.status === "cancelled";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: ticket.isDelayed ? "#fecaca" : colors.border,
          borderLeftColor: ticket.isDelayed ? "#dc2626" : stMeta.color,
        },
        ticket.isDelayed && { backgroundColor: "#fef2f2" },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.titleRow}>
            <Text style={[styles.orderNum, { color: ticket.isDelayed ? "#7f1d1d" : colors.foreground }]}>
              #{ticket.orderNumber ?? ticket.id}
            </Text>
            {ticket.isPriority ? <Ionicons name="flag" size={14} color="#f97316" /> : null}
            <View style={[styles.pill, { backgroundColor: otMeta.color + "22" }]}>
              <Text style={[styles.pillText, { color: otMeta.color }]}>{otMeta.label}</Text>
            </View>
          </View>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {ticket.tableNumber ? `Table ${ticket.tableNumber}` : ticket.customerName ?? "Walk-in"}
            {ticket.kitchen?.name ? ` · ${ticket.kitchen.name}` : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <View style={[styles.timerPill, { backgroundColor: ticket.isDelayed ? "#fee2e2" : colors.muted }]}>
            <Ionicons name="time-outline" size={12} color={ticket.isDelayed ? "#dc2626" : colors.mutedForeground} />
            <LiveTimerText startIso={ticket.createdAt} color={ticket.isDelayed ? "#dc2626" : colors.foreground} />
          </View>
          <Text style={[styles.paymentText, { color: paymentColor }]}>{paymentLabel}</Text>
        </View>
      </View>

      {ticket.isDelayed ? (
        <PulseBanner label={`DELAYED${(ticket.overdueMinutes ?? 0) > 0 ? ` +${ticket.overdueMinutes}m` : ""}`} />
      ) : null}

      <View style={styles.items}>
        {items.map((item) => {
          const itemStatus = (itemChecks[item.id] ?? item.status ?? "pending") as keyof typeof ITEM_STATUS_META;
          const meta = ITEM_STATUS_META[itemStatus] ?? ITEM_STATUS_META.pending;
          const mods = (item.modifiers ?? []) as { name: string; groupName?: string | null; quantity: number }[];
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                if (isHistory) return;
                Haptics.selectionAsync();
                onCycleItem(item.id);
              }}
              style={({ pressed }) => [
                styles.itemRow,
                { backgroundColor: colors.muted, borderColor: colors.border },
                pressed && !isHistory && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.qty, { color: colors.primary }]}>{item.quantity}×</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: colors.foreground }]}>{item.menuItemName}</Text>
                {mods.length > 0 ? (
                  <Text style={[styles.itemMeta, { color: colors.mutedForeground }]} numberOfLines={3}>
                    {mods.map((m) => `${m.groupName ? `${m.groupName}: ` : ""}${m.name}${m.quantity > 1 ? ` ×${m.quantity}` : ""}`).join(" · ")}
                  </Text>
                ) : null}
                {item.notes ? (
                  <Text style={[styles.itemNote, { color: "#9a3412" }]} numberOfLines={3}>
                    📝 {item.notes}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.itemStatusPill, { backgroundColor: meta.bg }]}>
                <Text style={[styles.itemStatusText, { color: meta.color }]}>{meta.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {!isHistory && primary ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => onPrimaryAction(ticket)}
            disabled={!!isPending}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: allLocalReady && primary.next === "ready" ? "#16a34a" : primary.color,
                opacity: isPending ? 0.6 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons
              name={primary.next === "ready" ? "checkmark-circle" : primary.next === "served" ? "restaurant" : "play-circle"}
              size={18}
              color="#fff"
            />
            <Text style={styles.primaryBtnText}>
              {allLocalReady && primary.next === "ready" ? "All Ready · Mark Ready" : primary.label}
            </Text>
          </Pressable>
          {onBump ? (
            <Pressable
              onPress={() => onBump(ticket)}
              disabled={!!isPending}
              style={({ pressed }) => [styles.iconBtn, { borderColor: colors.border, opacity: isPending ? 0.5 : pressed ? 0.7 : 1 }]}
              hitSlop={6}
              accessibilityLabel="Bump ticket forward"
            >
              <Ionicons name="play-skip-forward" size={18} color={colors.foreground} />
            </Pressable>
          ) : null}
          {onReprint ? (
            <Pressable
              onPress={() => onReprint(ticket)}
              style={({ pressed }) => [styles.iconBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
              hitSlop={6}
              accessibilityLabel="Reprint KOT"
            >
              <Ionicons name="print-outline" size={18} color={colors.foreground} />
            </Pressable>
          ) : null}
          {onPriority ? (
            <Pressable
              onPress={() => onPriority(ticket)}
              style={({ pressed }) => [styles.iconBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
              hitSlop={6}
            >
              <Ionicons name="flag-outline" size={18} color={ticket.isPriority ? "#f97316" : colors.foreground} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => onCancel(ticket)}
            style={({ pressed }) => [styles.iconBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            hitSlop={6}
          >
            <Ionicons name="close-circle-outline" size={18} color="#b91c1c" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderLeftWidth: 5,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  orderNum: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium" },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  pillText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },
  timerPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  timerText: { fontSize: 13, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  paymentText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  delayBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, alignSelf: "flex-start" },
  delayBannerText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#b91c1c", letterSpacing: 0.4 },
  items: { gap: 8 },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1 },
  qty: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 28 },
  itemName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  itemMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  itemNote: { fontSize: 12.5, fontFamily: "Inter_600SemiBold", marginTop: 3, lineHeight: 16 },
  itemStatusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, alignSelf: "flex-start" },
  itemStatusText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  primaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 10 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 10 },
});

// Reference-identity comparator. React Query hands us fresh ticket objects
// whenever the server data changes, and our optimistic mutations spread
// (`{...t, ...}`), so any change to a ticket produces a new reference.
// `itemChecks` is rebuilt only when a row's overrides change (see
// `checksByTicket` in kitchen.tsx). That makes ref equality both correct
// and far cheaper than a deep field-by-field compare during fast scrolling.
// It also keeps callback closures fresh whenever the ticket changes, so
// inline handlers like `(id) => onCycleItem(ticket, id)` never go stale.
function areEqual(prev: Props, next: Props) {
  return (
    prev.ticket === next.ticket &&
    prev.itemChecks === next.itemChecks &&
    prev.isPending === next.isPending &&
    prev.onPrimaryAction === next.onPrimaryAction &&
    prev.onCancel === next.onCancel
  );
}

export const KdsOrderCard = React.memo(KdsOrderCardImpl, areEqual);

export { ITEM_CYCLE };
