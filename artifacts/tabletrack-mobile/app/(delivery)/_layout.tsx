import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";

export default function DeliveryLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="my-deliveries" options={{ headerShown: false }} />
      <Stack.Screen name="tiffin-route" options={{ headerShown: false }} />
    </Stack>
  );
}
