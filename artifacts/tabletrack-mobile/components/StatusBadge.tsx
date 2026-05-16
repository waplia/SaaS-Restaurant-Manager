import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { BRAND } from "@/constants/brand";

export type StatusTone = "neutral" | "info" | "warning" | "success" | "danger" | "ai";

const TONE: Record<StatusTone, { bg: string; fg: string }> = {
  neutral: { bg: "#e5e7eb", fg: "#374151" },
  info: { bg: "#dbeafe", fg: BRAND.info },
  warning: { bg: "#fef3c7", fg: "#92400e" },
  success: { bg: "#dcfce7", fg: "#166534" },
  danger: { bg: "#fee2e2", fg: BRAND.danger },
  ai: { bg: "#ede9fe", fg: BRAND.ai },
};

export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: StatusTone }) {
  const c = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function toneForOrderStatus(status: string | null | undefined): StatusTone {
  switch (status) {
    case "pending": return "warning";
    case "in_progress":
    case "preparing": return "info";
    case "ready": return "success";
    case "completed":
    case "served":
    case "delivered": return "neutral";
    case "cancelled": return "danger";
    default: return "neutral";
  }
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start" },
  text: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
});

// silence "useColors unused"
void useColors;
