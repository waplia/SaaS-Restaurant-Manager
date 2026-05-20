import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { makeAppTabBar } from "@/components/AppTabBar";

// 5-slot waiter tab bar: Tables, Requests, [New Order], Alerts, Profile.
// AppTabBar renders the first 2 entries on the left, a raised "New Order"
// button in the center slot, then the next 2 entries on the right.
const TabBar = makeAppTabBar([
  { name: "index",         label: "Tables",   icon: "grid" },
  { name: "requests",      label: "Requests", icon: "bell" },
  { name: "notifications", label: "Alerts",   icon: "alert-circle" },
  { name: "profile",       label: "Profile",  icon: "user" },
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
      <Tabs.Screen name="notifications" options={{ title: "Alerts",   tabBarIcon: ({ color }) => <Feather name="alert-circle"  size={22} color={color} /> }} />
      <Tabs.Screen name="profile"       options={{ title: "Profile",  tabBarIcon: ({ color }) => <Feather name="user"          size={22} color={color} /> }} />
    </Tabs>
  );
}
