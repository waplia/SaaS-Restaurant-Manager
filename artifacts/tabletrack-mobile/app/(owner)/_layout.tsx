import { View } from "react-native";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AuthGate } from "@/components/AuthGate";
import { makeAppTabBar } from "@/components/AppTabBar";
import { KhanaAiFab } from "@/components/KhanaAiFab";

// Custom 5-slot tab bar with raised center "New Order" button.
// The middle slot is a phantom route — its tab press is intercepted and
// instead pushes the new-order modal stack via NewOrderCenterButton.
const TabBar = makeAppTabBar([
  { name: "index",   label: "Home",   icon: "home" },
  { name: "orders",  label: "Orders", icon: "list" },
  { name: "alerts",  label: "Alerts", icon: "bell" },
  { name: "more",    label: "More",   icon: "more-horizontal" },
]);

export default function OwnerLayout() {
  const colors = useColors();
  return (
    <AuthGate allowedRoles={["owner", "manager", "super_admin", "cashier", "chef", "kitchen", "inventory_manager", "hr", "payroll", "marketing", "accountant"]}>
      <View style={{ flex: 1 }}>
        <Tabs
          tabBar={(props) => <TabBar {...props} />}
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.mutedForeground,
          }}
        >
          <Tabs.Screen name="index"  options={{ title: "Home",   tabBarIcon: ({ color }) => <Feather name="home"  size={22} color={color} /> }} />
          <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: ({ color }) => <Feather name="list"  size={22} color={color} /> }} />
          <Tabs.Screen name="alerts" options={{ title: "Alerts", tabBarIcon: ({ color }) => <Feather name="bell"  size={22} color={color} /> }} />
          <Tabs.Screen name="more"   options={{ title: "More",   tabBarIcon: ({ color }) => <Feather name="more-horizontal" size={22} color={color} /> }} />

          {/* Module screens accessible via More menu and deep links — hidden from the tab bar. */}
          <Tabs.Screen name="kitchen" options={{ href: null }} />
          <Tabs.Screen name="expenses" options={{ href: null }} />
          <Tabs.Screen name="profile" options={{ href: null }} />
          <Tabs.Screen name="notifications" options={{ href: null }} />
          <Tabs.Screen name="approvals" options={{ href: null }} />
          <Tabs.Screen name="settings" options={{ href: null }} />
          <Tabs.Screen name="outlets" options={{ href: null }} />
          <Tabs.Screen name="tables" options={{ href: null }} />
          <Tabs.Screen name="reservations" options={{ href: null }} />
          <Tabs.Screen name="waiter-requests" options={{ href: null }} />
          <Tabs.Screen name="delivery" options={{ href: null }} />
          <Tabs.Screen name="inventory" options={{ href: null }} />
          <Tabs.Screen name="menu" options={{ href: null }} />
          <Tabs.Screen name="staff" options={{ href: null }} />
          <Tabs.Screen name="attendance" options={{ href: null }} />
          <Tabs.Screen name="customers" options={{ href: null }} />
          <Tabs.Screen name="feedback" options={{ href: null }} />
          <Tabs.Screen name="growth" options={{ href: null }} />
          <Tabs.Screen name="khana-ai" options={{ href: null }} />
          <Tabs.Screen name="khana-ai-chat" options={{ href: null }} />
          <Tabs.Screen name="finance" options={{ href: null }} />
          <Tabs.Screen name="reports" options={{ href: null }} />
          <Tabs.Screen name="support" options={{ href: null }} />
        </Tabs>
        {/* Global Khana AI floating action button — rendered as a sibling so
            it sits above every owner tab screen, horizontally centered just
            above the bottom tab bar. */}
        <KhanaAiFab />
      </View>
    </AuthGate>
  );
}
