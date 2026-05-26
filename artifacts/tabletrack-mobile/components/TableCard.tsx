import React from "react";
import { Pressable, Text, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface TableCardProps {
  label: string;
  capacity: number;
  status: string;
  onPress: () => void;
  /** Task #602 — live running-order summary (occupied tiles only). */
  runningTotal?: string | number | null;
  itemCount?: number | null;
  elapsedMinutes?: number | null;
  billGenerated?: boolean;
  /** Guest Verification Hold — when present, render a yellow/red glow and
   *  "Verify guest" badge. Red + pulse once the wait has escalated. */
  guestVerificationHeld?: boolean;
  guestVerificationEscalated?: boolean;
}

const STATUS_PALETTE: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  // Web/API uses "free"; mobile also accepted the legacy "available" alias.
  free: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0", dot: "#22c55e" },
  available: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0", dot: "#22c55e" },
  occupied: { bg: "#fff7ed", text: "#c2410c", border: "#fed7aa", dot: "#f97316" },
  bill_requested: { bg: "#f3e8ff", text: "#6d28d9", border: "#ddd6fe", dot: "#7c3aed" },
  billed: { bg: "#f3e8ff", text: "#6d28d9", border: "#ddd6fe", dot: "#7c3aed" },
  reserved: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe", dot: "#3b82f6" },
  cleaning: { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1", dot: "#94a3b8" },
  dirty: { bg: "#fefce8", text: "#92400e", border: "#fde68a", dot: "#f59e0b" },
};

const STATUS_LABEL: Record<string, string> = {
  free: "Available",
  available: "Available",
  occupied: "Occupied",
  bill_requested: "Bill Generated",
  billed: "Bill Generated",
  reserved: "Reserved",
  cleaning: "Cleaning",
  dirty: "Dirty",
};

function fmtMoney(amount: string | number | undefined | null): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return "₹0";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function TableCard({
  label, capacity, status, onPress,
  runningTotal, itemCount, elapsedMinutes, billGenerated,
  guestVerificationHeld, guestVerificationEscalated,
}: TableCardProps) {
  const colors = useColors();
  const palette = STATUS_PALETTE[status] ?? STATUS_PALETTE.free;
  const statusLabel = STATUS_LABEL[status] ?? status;
  const hasSummary =
    runningTotal != null ||
    (itemCount != null && itemCount > 0) ||
    (elapsedMinutes != null && elapsedMinutes >= 0);

  const heldBorder = guestVerificationEscalated ? "#dc2626" : "#facc15";
  const heldBg = guestVerificationEscalated ? "#fef2f2" : "#fefce8";

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: guestVerificationHeld ? heldBg : palette.bg,
          borderColor: guestVerificationHeld ? heldBorder : palette.border,
          borderWidth: guestVerificationHeld ? 2.5 : 1.5,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      onPress={onPress}
    >
      {guestVerificationHeld ? (
        <View style={styles.heldBadge}>
          <Ionicons name="warning" size={10} color="#92400e" />
          <Text style={styles.heldBadgeText}>Verify guest</Text>
        </View>
      ) : null}
      <View style={[styles.dot, { backgroundColor: palette.dot }]} />
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <Text style={[styles.capacity, { color: colors.mutedForeground }]}>{capacity} seats</Text>
      <Text style={[styles.status, { color: palette.text }]}>{statusLabel}</Text>

      {hasSummary ? (
        <View style={[styles.summary, { borderTopColor: palette.border }]}>
          {runningTotal != null ? (
            <Text style={[styles.total, { color: palette.text }]} numberOfLines={1}>
              {fmtMoney(runningTotal)}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            {itemCount != null && itemCount > 0 ? (
              <View style={styles.metaPill}>
                <Ionicons name="fast-food-outline" size={10} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                  {itemCount} item{itemCount === 1 ? "" : "s"}
                </Text>
              </View>
            ) : null}
            {elapsedMinutes != null && elapsedMinutes >= 0 ? (
              <View style={styles.metaPill}>
                <Ionicons name="time-outline" size={10} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                  {elapsedMinutes < 60 ? `${elapsedMinutes}m` : `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m`}
                </Text>
              </View>
            ) : null}
            {billGenerated ? (
              <View style={[styles.metaPill, { backgroundColor: "#ede9fe" }]}>
                <Ionicons name="receipt-outline" size={10} color="#6d28d9" />
                <Text style={[styles.metaText, { color: "#6d28d9", fontFamily: "Inter_600SemiBold" }]}>Billed</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "47%",
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
    gap: 4,
    position: "relative",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: "absolute",
    top: 12,
    right: 12,
  },
  label: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 8 },
  capacity: { fontSize: 11, fontFamily: "Inter_400Regular" },
  status: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "capitalize", marginTop: 4 },
  summary: { marginTop: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  total: { fontSize: 16, fontFamily: "Inter_700Bold" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  heldBadge: {
    position: "absolute",
    top: -8,
    right: 8,
    backgroundColor: "#fde047",
    borderColor: "#facc15",
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    zIndex: 2,
  },
  heldBadgeText: { fontSize: 10, color: "#92400e", fontFamily: "Inter_600SemiBold" },
});
