import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Props {
  children: React.ReactNode;
  allowedRoles?: ReadonlyArray<string>;
}

export function AuthGate({ children, allowedRoles }: Props) {
  const { user, isLoading } = useAuth();
  const colors = useColors();

  // Stabilize the role list across renders so effect deps don't churn when
  // callers pass an inline array literal.
  const rolesKey = allowedRoles ? allowedRoles.join(",") : "";

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    const roles = rolesKey ? rolesKey.split(",") : null;
    if (roles && !roles.includes(user.role) && !user.isSuperAdmin) {
      router.replace("/");
    }
  }, [user, isLoading, rolesKey]);

  if (isLoading || !user) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (allowedRoles && !allowedRoles.includes(user.role) && !user.isSuperAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  return <>{children}</>;
}
