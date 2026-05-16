import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { rolesAllow, type ModuleKey } from "@/lib/roles";

export function RoleGate({ module, children }: { module: ModuleKey; children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const colors = useColors();

  if (isLoading) return null;
  if (!user) return null;
  if (rolesAllow(user.role, module)) return <>{children}</>;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
        <Ionicons name="lock-closed" size={28} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Not available for your role</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        Ask the owner or manager to grant access to this section.
      </Text>
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
      >
        <Text style={styles.btnText}>Go back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  iconWrap: { width: 64, height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  btn: { marginTop: 12, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 24 },
  btnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
