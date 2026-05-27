import React from "react";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AuthGate } from "@/components/AuthGate";

/**
 * Marketing role app — bottom tabs for staff focused on campaigns,
 * customer segments, reviews, and templates. The fifth tab is a "More"
 * menu mirroring the shared role-more sheet (profile, settings, logout).
 */
export default function MarketingLayout() {
  const colors = useColors();
  return (
    <AuthGate allowedRoles={["marketing", "manager", "owner", "super_admin"]}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
          tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
          tabBarLabelStyle: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: "Campaigns", tabBarIcon: ({ color }) => <Feather name="send" size={20} color={color} /> }}
        />
        <Tabs.Screen
          name="customers"
          options={{ title: "Customers", tabBarIcon: ({ color }) => <Feather name="users" size={20} color={color} /> }}
        />
        <Tabs.Screen
          name="reviews"
          options={{ title: "Reviews", tabBarIcon: ({ color }) => <Feather name="message-circle" size={20} color={color} /> }}
        />
        <Tabs.Screen
          name="templates"
          options={{ title: "Templates", tabBarIcon: ({ color }) => <Feather name="file-text" size={20} color={color} /> }}
        />
        <Tabs.Screen
          name="more"
          options={{ title: "More", tabBarIcon: ({ color }) => <Feather name="more-horizontal" size={20} color={color} /> }}
        />
        {/* Hidden detail routes — not shown as tabs. */}
        <Tabs.Screen name="campaign/[id]" options={{ href: null }} />
      </Tabs>
    </AuthGate>
  );
}
