import React from "react";
import { View, Pressable, StyleSheet, Platform, Text } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Feather, Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

type IconName = React.ComponentProps<typeof Feather>["name"];

export interface InventoryTab {
  name: string;
  label: string;
  icon: IconName;
}

/**
 * 5-slot inventory tab bar with a raised circular center "Scan" button.
 * Tabs: [tabs[0]] [tabs[1]] [SCAN] [tabs[2]] [tabs[3]].
 * The center slot navigates the tab named `scanRoute`.
 */
export function makeInventoryTabBar(tabs: InventoryTab[], scanRoute: string) {
  return function InventoryTabBar(props: BottomTabBarProps) {
    const colors = useColors();
    const insets = useSafeAreaInsets();
    const isWeb = Platform.OS === "web";
    const isIOS = Platform.OS === "ios";
    const bottom = isWeb ? 16 : insets.bottom;

    const left = tabs.slice(0, 2);
    const right = tabs.slice(2, 4);

    const navigateTab = (routeName: string) => {
      const route = props.state.routes.find(r => r.name === routeName);
      if (!route) return;
      const idx = props.state.routes.indexOf(route);
      const focused = props.state.index === idx;
      const event = props.navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        props.navigation.navigate(route.name as never);
      }
    };

    const renderTab = (t: InventoryTab) => {
      const route = props.state.routes.find(r => r.name === t.name);
      if (!route) return null;
      const idx = props.state.routes.indexOf(route);
      const focused = props.state.index === idx;
      const color = focused ? colors.primary : colors.mutedForeground;
      return (
        <Pressable key={t.name} onPress={() => navigateTab(t.name)} style={styles.tab}>
          <Feather name={t.icon} size={22} color={color} />
          <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>{t.label}</Text>
        </Pressable>
      );
    };

    const scanFocused = props.state.routes[props.state.index]?.name === scanRoute;
    const onScan = () => {
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      navigateTab(scanRoute);
    };

    return (
      <View style={[styles.wrap, { paddingBottom: bottom }]} pointerEvents="box-none">
        {isIOS ? (
          <BlurView intensity={90} tint="light" style={[StyleSheet.absoluteFill, { borderTopWidth: 0 }]} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border }]} />
        )}
        <View style={styles.row}>
          {left.map(renderTab)}
          <View style={styles.centerSlot}>
            <View style={styles.centerWrap} pointerEvents="box-none">
              <Pressable
                onPress={onScan}
                accessibilityRole="button"
                accessibilityLabel="Scan"
                style={({ pressed }) => [
                  styles.centerBtn,
                  { transform: [{ scale: pressed ? 0.94 : 1 }] },
                ]}
              >
                <LinearGradient
                  colors={scanFocused ? ["#16a34a", "#15803d", "#166534"] : ["#fb923c", "#f97316", "#ea580c"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[StyleSheet.absoluteFill, { borderRadius: 32 }]}
                />
                <Ionicons name="scan-outline" size={28} color="#fff" />
              </Pressable>
              <Text style={styles.centerLabel}>Scan</Text>
            </View>
          </View>
          {right.map(renderTab)}
        </View>
      </View>
    );
  };
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, overflow: "visible" },
  row: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 4, paddingTop: 8, paddingBottom: 6, minHeight: 60, overflow: "visible" },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, paddingVertical: 6 },
  tabLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  centerSlot: { width: 80, alignItems: "center", justifyContent: "center", overflow: "visible" },
  centerWrap: { alignItems: "center", justifyContent: "center", marginTop: -22, overflow: "visible", paddingTop: 4, paddingHorizontal: 4 },
  centerBtn: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#f97316", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 12,
    elevation: 12, borderWidth: 3, borderColor: "#fff",
  },
  centerLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#9a4200", marginTop: 2 },
});
