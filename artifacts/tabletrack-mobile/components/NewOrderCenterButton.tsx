import React from "react";
import { Pressable, Text, View, StyleSheet, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

/**
 * The raised circular gradient "New Order" button rendered in the middle of
 * the bottom tab bar. Tapping it pushes the modal new-order flow.
 */
export function NewOrderCenterButton({ size = 64 }: { size?: number }) {
  const onPress = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/new-order" as never);
  };
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.btn,
          { width: size, height: size, borderRadius: size / 2, transform: [{ scale: pressed ? 0.94 : 1 }] },
        ]}
        accessibilityLabel="New Order"
        accessibilityRole="button"
      >
        <LinearGradient
          colors={["#fb923c", "#f97316", "#ea580c"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
        />
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>
      <Text style={styles.label}>New Order</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", marginTop: -22, overflow: "visible", paddingTop: 4, paddingHorizontal: 4 },
  btn: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#f97316",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 12,
    borderWidth: 3,
    borderColor: "#fff",
  },
  label: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#9a4200", marginTop: 2 },
});
