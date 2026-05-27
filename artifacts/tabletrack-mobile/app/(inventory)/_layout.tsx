import React from "react";
import { Stack } from "expo-router";
import { AuthGate } from "@/components/AuthGate";

export default function InventoryLayout() {
  return (
    <AuthGate allowedRoles={["inventory_manager", "manager", "owner", "super_admin"]}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </AuthGate>
  );
}
