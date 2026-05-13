import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";

export default function WaiterLayout() {
  const colors = useColors();
  return (
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
  );
}
