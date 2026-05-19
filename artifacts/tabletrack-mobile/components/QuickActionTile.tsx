import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  badge?: string | number | null;
  tint?: string;
}

export function QuickActionTile({ icon, label, onPress, badge, tint }: Props) {
  const colors = useColors();
  const color = tint ?? colors.primary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: color + "1A" }]}>
        <Ionicons name={icon} size={22} color={color} />
        {badge != null && Number(badge) > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.label, { color: colors.foreground }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: "30%",
    aspectRatio: 1,
    borderRadius: 20,
    borderWidth: 1,
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  iconWrap: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "#dc2626",
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
});
