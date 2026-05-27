import React from "react";
import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function CashierTabsLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === "web" ? 8 : insets.bottom;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          height: 56 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "POS",
          tabBarIcon: ({ color }) => <Feather name="hash" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bills"
        options={{
          title: "Bills",
          tabBarIcon: ({ color }) => <Feather name="file-text" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="payments"
        options={{
          title: "Payments",
          tabBarIcon: ({ color }) => <Feather name="credit-card" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="shift"
        options={{
          title: "Shift",
          tabBarIcon: ({ color }) => <Feather name="clock" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color }) => <Feather name="menu" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
