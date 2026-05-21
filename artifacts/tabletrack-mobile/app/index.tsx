import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { roleHomePath } from "@/lib/roles";

export default function IndexScreen() {
  const { user, isLoading } = useAuth();
  const colors = useColors();

  if (isLoading) {
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

  // Signed-out users land directly on the login screen. The login screen
  // exposes a "New to KhanaLagao? Create account" CTA that takes new users
  // into the /register flow, which then routes owners into /onboarding on
  // first sign-in. Returning signed-in users go to their role dashboard.
  if (!user) {
    return <Redirect href="/login" />;
  }

  return <Redirect href={roleHomePath(user.role) as never} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  logo: { width: 160, height: 160 },
  brand: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 12, letterSpacing: -0.5 },
});
