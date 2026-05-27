import React from "react";
import { Stack } from "expo-router";
import { AuthGate } from "@/components/AuthGate";

export default function CashierLayout() {
  return (
    <AuthGate allowedRoles={["cashier", "manager", "owner", "super_admin"]}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="pay/[orderId]" options={{ presentation: "card" }} />
      </Stack>
    </AuthGate>
  );
}
