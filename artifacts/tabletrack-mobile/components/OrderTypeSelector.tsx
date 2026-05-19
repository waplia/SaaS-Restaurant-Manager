import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export type OrderTypeChoice = "dine_in" | "takeaway" | "delivery" | "qr" | "curbside" | "pre_order";

interface Option {
  key: OrderTypeChoice;
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const ALL: Option[] = [
  { key: "dine_in", label: "Dine-in", desc: "Pick a table on the floor", icon: "restaurant-outline" },
  { key: "takeaway", label: "Takeaway", desc: "Customer picks up", icon: "bag-handle-outline" },
  { key: "delivery", label: "Delivery", desc: "Send to address", icon: "bicycle-outline" },
  { key: "qr", label: "QR Assist", desc: "Help a QR diner", icon: "qr-code-outline" },
  { key: "curbside", label: "Curbside", desc: "Deliver to car", icon: "car-outline" },
  { key: "pre_order", label: "Pre-order", desc: "Book ahead", icon: "calendar-outline" },
];

export function OrderTypeSelector({
  enabled,
  onChoose,
}: {
  enabled?: Partial<Record<OrderTypeChoice, boolean>>;
  onChoose: (key: OrderTypeChoice) => void;
}) {
  const colors = useColors();
  const items = ALL.filter((o) => {
    if (o.key === "dine_in" || o.key === "takeaway" || o.key === "delivery") return true;
    return !!enabled?.[o.key];
  });
  return (
    <View style={{ gap: 12 }}>
      {items.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onChoose(o.key)}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
            <Ionicons name={o.icon} size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: colors.foreground }]}>{o.label}</Text>
            <Text style={[styles.desc, { color: colors.mutedForeground }]}>{o.desc}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 20, borderWidth: 1 },
  iconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 16, fontFamily: "Inter_700Bold" },
  desc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
