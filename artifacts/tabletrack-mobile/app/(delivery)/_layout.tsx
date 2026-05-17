import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { AuthGate } from "@/components/AuthGate";

export default function DeliveryLayout() {
  const colors = useColors();
  return (
    <AuthGate allowedRoles={["delivery_executive", "owner", "manager", "super_admin"]}>
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="my-deliveries" options={{ headerShown: false }} />
      <Stack.Screen name="tiffin-route" options={{ headerShown: false }} />
    </Stack>
    </AuthGate>
  );
}
