import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { AuthGate } from "@/components/AuthGate";

export default function DeliveryLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  return (
    <AuthGate allowedRoles={["delivery_executive", "owner", "manager", "super_admin"]}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.mutedForeground,
            tabBarStyle: {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              borderTopWidth: 1,
              height: (isWeb ? 12 : insets.bottom) + 56,
              paddingTop: 6,
              paddingBottom: (isWeb ? 12 : insets.bottom) + 4,
            },
            tabBarLabelStyle: { fontSize: 11, fontFamily: "Inter_500Medium" },
          }}
        >
          <Tabs.Screen
            name="assigned"
            options={{
              title: "Assigned",
              tabBarIcon: ({ color, size }) => <Ionicons name="bicycle-outline" size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="map"
            options={{
              title: "Map",
              tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="cash"
            options={{
              title: "Cash",
              tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="history"
            options={{
              title: "History",
              tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} />,
            }}
          />
          <Tabs.Screen
            name="more"
            options={{
              title: "More",
              tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" size={size} color={color} />,
            }}
          />
          <Tabs.Screen name="[id]" options={{ href: null }} />
          <Tabs.Screen name="tiffin-route" options={{ href: null }} />
        </Tabs>
      </View>
    </AuthGate>
  );
}
