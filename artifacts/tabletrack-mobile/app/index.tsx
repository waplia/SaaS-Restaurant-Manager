import { useEffect } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { roleHomePath } from "@/lib/roles";

export default function IndexScreen() {
  const { user, isLoading } = useAuth();
  const colors = useColors();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    router.replace(roleHomePath(user.role) as never);
  }, [user, isLoading]);

  return (
    <View style={[styles.root, { backgroundColor: "#ffffff" }]}>
      <Image
        source={require("../assets/images/brand-logo.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="KhanaLagao logo"
      />
      <Text style={[styles.brand, { color: colors.foreground }]}>KhanaLagao</Text>
      <ActivityIndicator color={colors.primary} size="small" style={{ marginTop: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  logo: { width: 160, height: 160 },
  brand: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 12, letterSpacing: -0.5 },
});
