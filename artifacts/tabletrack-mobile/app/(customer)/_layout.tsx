import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";

export default function CustomerLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        headerTitleStyle: { fontFamily: "Inter_600SemiBold", color: colors.foreground },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="menu" options={{ headerTitle: "Menu", headerBackTitle: "Scan" }} />
      <Stack.Screen name="cart" options={{ headerTitle: "Your Order", headerBackTitle: "Menu" }} />
      <Stack.Screen name="track" options={{ headerTitle: "Order Status", headerBackTitle: "Back" }} />
      <Stack.Screen name="cake-booking" options={{ headerTitle: "Pre-order Cake", headerBackTitle: "Back" }} />
      <Stack.Screen name="plans" options={{ headerTitle: "Meal Plans", headerBackTitle: "Back" }} />
      <Stack.Screen name="my-subscriptions" options={{ headerTitle: "My Subscriptions", headerBackTitle: "Back" }} />
      <Stack.Screen name="tiffin" options={{ headerTitle: "My Tiffin", headerBackTitle: "Back" }} />
      <Stack.Screen name="rewards" options={{ headerTitle: "My Rewards", headerBackTitle: "Back" }} />
    </Stack>
  );
}
