import React from "react";
import { Pressable, Text, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface TableCardProps {
  label: string;
  capacity: number;
  status: string;
  onPress: () => void;
}

const STATUS_PALETTE: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  // Web/API uses "free"; mobile also accepted the legacy "available" alias.
  free: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0", dot: "#22c55e" },
  available: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0", dot: "#22c55e" },
  occupied: { bg: "#fff7ed", text: "#c2410c", border: "#fed7aa", dot: "#f97316" },
  reserved: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe", dot: "#3b82f6" },
  cleaning: { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1", dot: "#94a3b8" },
  dirty: { bg: "#fefce8", text: "#92400e", border: "#fde68a", dot: "#f59e0b" },
};

const STATUS_LABEL: Record<string, string> = {
  free: "Available",
  available: "Available",
  occupied: "Occupied",
  reserved: "Reserved",
  cleaning: "Cleaning",
  dirty: "Dirty",
};

export function TableCard({ label, capacity, status, onPress }: TableCardProps) {
  const colors = useColors();
  const palette = STATUS_PALETTE[status] ?? STATUS_PALETTE.free;
  const statusLabel = STATUS_LABEL[status] ?? status;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: pressed ? 0.85 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.dot, { backgroundColor: palette.dot }]} />
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <Text style={[styles.capacity, { color: colors.mutedForeground }]}>{capacity} seats</Text>
      <Text style={[styles.status, { color: palette.text }]}>{statusLabel}</Text>
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
});
