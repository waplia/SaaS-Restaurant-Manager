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
  const { user, isLoading } = useAuth();
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

  if (allowedRoles && !allowedRoles.includes(user.role) && !user.isSuperAdmin) {
    return <Redirect href="/" />;
  }

  return <>{children}</>;
}
