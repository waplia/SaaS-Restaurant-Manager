import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { AuthGate } from "@/components/AuthGate";

export default function WaiterLayout() {
  const colors = useColors();
  return (
    <AuthGate allowedRoles={["waiter", "kitchen", "owner", "manager", "super_admin"]}>
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
    </AuthGate>
  );
}
