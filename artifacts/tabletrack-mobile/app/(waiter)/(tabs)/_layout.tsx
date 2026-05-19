import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { makeAppTabBar } from "@/components/AppTabBar";

const TabBar = makeAppTabBar([
  { name: "index",          label: "Tables",  icon: "grid" },
  { name: "notifications",  label: "Alerts",  icon: "bell" },
  { name: "profile",        label: "Profile", icon: "user" },
  // 4th slot keeps the layout balanced; we reuse profile for waiter as More.
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
      <Tabs.Screen name="index"         options={{ title: "Tables",  tabBarIcon: ({ color }) => <Feather name="grid" size={22} color={color} /> }} />
      <Tabs.Screen name="notifications" options={{ title: "Alerts",  tabBarIcon: ({ color }) => <Feather name="bell" size={22} color={color} /> }} />
      <Tabs.Screen name="profile"       options={{ title: "Profile", tabBarIcon: ({ color }) => <Feather name="user" size={22} color={color} /> }} />
    </Tabs>
  );
}
