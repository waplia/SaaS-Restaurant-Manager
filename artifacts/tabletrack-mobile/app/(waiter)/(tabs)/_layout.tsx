import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { makeAppTabBar } from "@/components/AppTabBar";

// Task #637 — 5-slot waiter tab bar: Tables, Requests, [New Order],
// Ready, More. AppTabBar renders the first 2 entries on the left, a
// raised "New Order" button in the center slot, then the next 2 entries
// on the right. The legacy Alerts / Profile screens are still
// reachable from the "More" sheet (and via direct deep links).
const TabBar = makeAppTabBar([
  { name: "index",    label: "Tables",   icon: "grid" },
  { name: "requests", label: "Requests", icon: "bell" },
  { name: "ready",    label: "Ready",    icon: "check-circle" },
  { name: "more",     label: "More",     icon: "menu" },
]);

export default function WaiterTabLayout() {
  const colors = useColors();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
      }}
    >
      <Tabs.Screen name="index"         options={{ title: "Tables",   tabBarIcon: ({ color }) => <Feather name="grid"          size={22} color={color} /> }} />
      <Tabs.Screen name="requests"      options={{ title: "Requests", tabBarIcon: ({ color }) => <Feather name="bell"          size={22} color={color} /> }} />
      <Tabs.Screen name="ready"         options={{ title: "Ready",    tabBarIcon: ({ color }) => <Feather name="check-circle"  size={22} color={color} /> }} />
      <Tabs.Screen name="more"          options={{ title: "More",     tabBarIcon: ({ color }) => <Feather name="menu"          size={22} color={color} /> }} />
      {/* Keep notifications/profile routes mounted but hidden — RoleMoreSheet
          and other deep links still navigate to them. */}
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="profile"       options={{ href: null }} />
    </Tabs>
  );
}
