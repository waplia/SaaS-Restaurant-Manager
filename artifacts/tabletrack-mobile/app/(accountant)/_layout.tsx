import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

/**
 * Accountant bottom-tab shell. Five tabs:
 *   Finance · Expenses · Invoices · Reports · More
 *
 * Secondary screens (vendor payments, settlements, refunds, payment
 * reports, P&L drill-down) are mounted as `href: null` so they're
 * routable from the More tab and cross-links without showing a tab.
 */
export default function AccountantLayout() {
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Finance",
          tabBarIcon: ({ color }) => <Ionicons name="wallet-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: "Expenses",
          tabBarIcon: ({ color }) => <Ionicons name="receipt-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="invoices"
        options={{
          title: "Invoices",
          tabBarIcon: ({ color }) => <Ionicons name="document-text-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          tabBarIcon: ({ color }) => <Ionicons name="bar-chart-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color }) => <Ionicons name="ellipsis-horizontal" size={22} color={color} />,
        }}
      />

      {/* Secondary screens — reachable from More & Finance, not tabbed */}
      <Tabs.Screen name="vendor-payments" options={{ href: null, title: "Vendor Payments" }} />
      <Tabs.Screen name="settlements" options={{ href: null, title: "Settlements" }} />
      <Tabs.Screen name="refunds" options={{ href: null, title: "Refunds" }} />
      <Tabs.Screen name="payment-reports" options={{ href: null, title: "Payment Reports" }} />
      <Tabs.Screen name="pnl" options={{ href: null, title: "P&L" }} />
    </Tabs>
  );
}
