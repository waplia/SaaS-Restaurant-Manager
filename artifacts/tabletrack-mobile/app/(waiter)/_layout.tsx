import { View } from "react-native";
import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { AuthGate } from "@/components/AuthGate";
import { OfflineBanner } from "@/components/OfflineBanner";

export default function WaiterLayout() {
  const colors = useColors();
  return (
    <AuthGate allowedRoles={["waiter", "kitchen", "owner", "manager", "super_admin"]}>
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <OfflineBanner />
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="order/[tableId]"
        options={{
          headerShown: true,
          headerTitle: "Order",
          headerBackTitle: "Tables",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          headerTitleStyle: { fontFamily: "Inter_600SemiBold", color: colors.foreground },
        }}
      />
    </Stack>
    </View>
    </AuthGate>
  );
}
