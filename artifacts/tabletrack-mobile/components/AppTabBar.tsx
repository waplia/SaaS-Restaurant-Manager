import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { NewOrderCenterButton } from "@/components/NewOrderCenterButton";

type IconName = React.ComponentProps<typeof Feather>["name"];

export interface AppTab {
  name: string;
  label: string;
  icon: IconName;
}

/**
 * Custom bottom tab bar with a raised circular center "New Order" button.
 * Pass `tabs` describing the 4 surrounding tabs (Home, Orders, Alerts, More).
 * The center slot is the New Order action — it pushes the new-order modal
 * stack rather than focusing a tab.
 */
// Routes on which the custom tab bar should NOT render. These are
// screens whose own UI fills the bottom of the viewport (e.g. the Khana
// AI chat has a sticky text/mic/send input row) and would otherwise be
// hidden behind the floating bar. NOTE: setting `tabBarStyle: { display:
// "none" }` in screenOptions does NOT work for a custom tab bar — that
// option is only honored by the default `BottomTabBar`. We must check
// the focused route name here and short-circuit the render.
const HIDDEN_ON_ROUTES = new Set<string>(["khana-ai-chat"]);

export function makeAppTabBar(tabs: AppTab[]) {
  return function AppTabBar(props: BottomTabBarProps) {
    const colors = useColors();
    const insets = useSafeAreaInsets();
    const isWeb = Platform.OS === "web";
    const isIOS = Platform.OS === "ios";
    const bottom = isWeb ? 16 : insets.bottom;

    const focusedRouteName = props.state.routes[props.state.index]?.name;
    if (focusedRouteName && HIDDEN_ON_ROUTES.has(focusedRouteName)) return null;

    const left = tabs.slice(0, 2);
    const right = tabs.slice(2, 4);

    const renderTab = (t: AppTab) => {
      const route = props.state.routes.find((r) => r.name === t.name);
      if (!route) return null;
      const idx = props.state.routes.indexOf(route);
      const focused = props.state.index === idx;
      const color = focused ? colors.primary : colors.mutedForeground;
      return (
        <Pressable
          key={t.name}
          onPress={() => {
            const event = props.navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              props.navigation.navigate(route.name as never);
            }
          }}
          style={styles.tab}
        >
          <Feather name={t.icon} size={22} color={color} />
          <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>{t.label}</Text>
        </Pressable>
      );
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
            <NewOrderCenterButton />
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
});
