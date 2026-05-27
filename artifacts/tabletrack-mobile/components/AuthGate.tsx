import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Props {
  children: React.ReactNode;
  allowedRoles?: ReadonlyArray<string>;
}

export function AuthGate({ children, allowedRoles }: Props) {
  const { user, isLoading, activeRole, roles } = useAuth();
  const colors = useColors();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (allowedRoles && !user.isSuperAdmin) {
    // Authorize strictly against the session's *active* role so the
    // "Continue as…" picker is the source of truth for what a multi-role
    // user can see in this session. Owners get a wildcard pass because
    // they routinely preview every staff surface from their own stack.
    // Falls back to user.role only when no active role is set yet
    // (first launch, before the user picks one).
    const sessionRole = activeRole ?? user.role;
    const isOwnerLike = sessionRole === "owner" || roles.includes("owner");
    const ok = isOwnerLike || allowedRoles.includes(sessionRole);
    if (!ok) return <Redirect href="/" />;
  }

  return <>{children}</>;
}
