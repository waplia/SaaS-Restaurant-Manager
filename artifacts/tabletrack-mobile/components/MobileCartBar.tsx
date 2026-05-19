import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

interface Props {
  itemCount: number;
  total: number;
  onPress: () => void;
}

/** Sticky bottom cart bar used inside the new-order menu screen. */
export function MobileCartBar({ itemCount, total, onPress }: Props) {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  if (itemCount <= 0) return null;
  return (
    <View style={[styles.wrap, { paddingBottom: isWeb ? 16 : insets.bottom + 8 }]} pointerEvents="box-none">
      <Pressable onPress={onPress} style={({ pressed }) => [styles.btn, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
        <LinearGradient
          colors={["#fb923c", "#f97316", "#ea580c"]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
        />
        <Text style={styles.left}>{itemCount} item{itemCount === 1 ? "" : "s"} · ₹{total.toLocaleString("en-IN")}</Text>
        <View style={styles.right}>
          <Text style={styles.rightText}>View Cart</Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, bottom: 0 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, shadowColor: "#f97316", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  left: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  right: { flexDirection: "row", alignItems: "center", gap: 6 },
  rightText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
});
