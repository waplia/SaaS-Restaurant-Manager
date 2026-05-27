import React from "react";
import { Stack } from "expo-router";
import { AuthGate } from "@/components/AuthGate";

export default function ChefLayout() {
  return (
    <AuthGate allowedRoles={["chef", "kitchen", "owner", "manager", "super_admin"]}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </AuthGate>
  );
}
