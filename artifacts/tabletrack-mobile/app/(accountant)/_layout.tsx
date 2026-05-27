import React from "react";
import { Stack } from "expo-router";
import { AuthGate } from "@/components/AuthGate";

export default function AccountantLayout() {
  return (
    <AuthGate allowedRoles={["accountant", "payroll", "manager", "owner", "super_admin"]}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </AuthGate>
  );
}
