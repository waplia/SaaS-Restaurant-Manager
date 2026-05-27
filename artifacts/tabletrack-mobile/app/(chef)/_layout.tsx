import React from "react";
import { Tabs } from "expo-router";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import * as Haptics from "expo-haptics";
import { AuthGate } from "@/components/AuthGate";
import { useChefColors } from "@/hooks/useChefColors";

type IconName = React.ComponentProps<typeof Feather>["name"];

interface ChefTab {
  name: string;
  label: string;
  icon: IconName;
}

const TABS: ChefTab[] = [
  { name: "index",     label: "KOTs",      icon: "list" },
  { name: "preparing", label: "Preparing", icon: "loader" },
  { name: "ready",     label: "Ready",     icon: "check-circle" },
  { name: "alerts",    label: "Alerts",    icon: "bell" },
  { name: "more",      label: "More",      icon: "menu" },
];

function ChefTabBar(props: BottomTabBarProps) {
  const colors = useChefColors();
  const insets = useSafeAreaInsets();
  const bottom = Platform.OS === "web" ? 8 : Math.max(insets.bottom, 6);
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: bottom },
      ]}
    >
      {TABS.map((t) => {
        const route = props.state.routes.find((r) => r.name === t.name);
        if (!route) return null;
        const idx = props.state.routes.indexOf(route);
        const focused = props.state.index === idx;
        const tint = focused ? colors.primary : colors.mutedForeground;
        return (
          <Pressable
            key={t.name}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              const event = props.navigation.emit({
                type: "tabPress", target: route.key, canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                props.navigation.navigate(route.name as never);
              }
            }}
            style={styles.tab}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={t.label}
          >
            <Feather name={t.icon} size={22} color={tint} />
            <Text style={[styles.label, { color: tint }]} numberOfLines={1}>{t.label}</Text>
            {focused ? <View style={[styles.activeBar, { backgroundColor: colors.primary }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Chef / kitchen role tab stack. The shell stays in dark "kitchen mode"
 * so the hot-line tablet shows the same high-contrast UI on every screen
 * regardless of the device's system theme. Allowed roles intentionally
 * match the foundation routing (`roleHomePath` sends both chef and
 * kitchen here).
 */
export default function ChefLayout() {
  return (
    <AuthGate allowedRoles={["chef", "kitchen", "owner", "manager", "super_admin"]}>
      <Tabs
        tabBar={(props) => <ChefTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="index"     options={{ title: "KOTs" }} />
        <Tabs.Screen name="preparing" options={{ title: "Preparing" }} />
        <Tabs.Screen name="ready"     options={{ title: "Ready" }} />
        <Tabs.Screen name="alerts"    options={{ title: "Alerts" }} />
        <Tabs.Screen name="more"      options={{ title: "More" }} />
      </Tabs>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    borderTopWidth: 1, paddingTop: 8,
    position: "absolute", left: 0, right: 0, bottom: 0,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 6 },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },
  activeBar: { position: "absolute", top: -8, width: 28, height: 3, borderRadius: 2 },
});
