import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { AuthGate } from "@/components/AuthGate";

export default function NewOrderLayout() {
  const colors = useColors();
  return (
    <AuthGate allowedRoles={["owner", "manager", "super_admin", "cashier", "waiter", "captain"]}>
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.primary,
          headerTitleStyle: { fontFamily: "Inter_700Bold", color: colors.foreground },
          contentStyle: { backgroundColor: colors.background },
          presentation: "modal",
        }}
      >
        <Stack.Screen name="index" options={{ title: "New Order" }} />
        <Stack.Screen name="table" options={{ title: "Pick a table" }} />
        <Stack.Screen name="customer" options={{ title: "Customer details" }} />
        <Stack.Screen name="menu" options={{ title: "Add items", headerBackTitle: "Back" }} />
      </Stack>
    </AuthGate>
  );
}
