import React from "react";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { AuthGate } from "@/components/AuthGate";
import { useColors } from "@/hooks/useColors";
import { makeInventoryTabBar } from "@/components/inventory/InventoryTabBar";

// 5-slot inventory tab bar: Stock, Receive, [Scan center], Alerts, More.
const TabBar = makeInventoryTabBar(
  [
    { name: "index",   label: "Stock",   icon: "package" },
    { name: "receive", label: "Receive", icon: "truck" },
    { name: "alerts",  label: "Alerts",  icon: "alert-circle" },
    { name: "more",    label: "More",    icon: "more-horizontal" },
  ],
  "scan",
);

export default function InventoryLayout() {
  const colors = useColors();
  return (
    <AuthGate allowedRoles={["inventory_manager", "manager", "owner", "super_admin"]}>
      <Tabs
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
        }}
      >
        <Tabs.Screen name="index"   options={{ title: "Stock",   tabBarIcon: ({ color }) => <Feather name="package"          size={22} color={color} /> }} />
        <Tabs.Screen name="receive" options={{ title: "Receive", tabBarIcon: ({ color }) => <Feather name="truck"            size={22} color={color} /> }} />
        <Tabs.Screen name="scan"    options={{ title: "Scan",    tabBarIcon: ({ color }) => <Feather name="maximize"         size={22} color={color} /> }} />
        <Tabs.Screen name="alerts"  options={{ title: "Alerts",  tabBarIcon: ({ color }) => <Feather name="alert-circle"     size={22} color={color} /> }} />
        <Tabs.Screen name="more"    options={{ title: "More",    tabBarIcon: ({ color }) => <Feather name="more-horizontal"  size={22} color={color} /> }} />
      </Tabs>
    </AuthGate>
  );
}
