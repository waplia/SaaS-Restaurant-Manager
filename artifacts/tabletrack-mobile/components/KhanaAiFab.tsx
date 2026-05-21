import React from "react";
import { Pressable, StyleSheet, View, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { BRAND } from "@/constants/brand";

/**
 * Floating Khana AI button — horizontally centered above the bottom tab bar.
 * Positioned just above the raised "New Order" center button so both remain
 * tappable, with an offset to the right to stay clear of the center button.
 */
export function KhanaAiFab() {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  // Tab bar is ~60px + safe area bottom, and the raised "New Order" center
  // button protrudes ~28px above it. Sit the FAB clear of both so it can
  // remain horizontally centered without overlapping anything.
  const bottom = (isWeb ? 16 : insets.bottom) + 60 + 28 + 14;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom }]}
    >
      <Pressable
        onPress={() => router.push("/(owner)/khana-ai-chat" as never)}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: BRAND.ai, opacity: pressed ? 0.85 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Open Khana AI"
      >
        <Ionicons name="sparkles" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 50,
  },
  btn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});
