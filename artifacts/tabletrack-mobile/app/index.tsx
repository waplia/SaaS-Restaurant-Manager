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

  // First-time / signed-out users land on the welcome screen (Create account /
  // Sign in / Continue with Google). Returning signed-in users go to their
  // role dashboard. The login screen is now reached *through* welcome, not
  // as the default entry point.
  if (!user) {
    return <Redirect href="/welcome" />;
  }

  return <Redirect href={roleHomePath(user.role) as never} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  logo: { width: 160, height: 160 },
  brand: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 12, letterSpacing: -0.5 },
});
