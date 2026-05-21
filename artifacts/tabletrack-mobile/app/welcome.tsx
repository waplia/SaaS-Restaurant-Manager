import React from "react";
import { View, Text, Image, Pressable, StyleSheet, ScrollView, Linking, Platform } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function WelcomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === "ios";
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={styles.brand}>
          <Image
            source={require("../assets/images/brand-logo.png")}
            style={styles.logoImg}
            resizeMode="contain"
            accessibilityLabel="KhanaLagao logo"
          />
          <Text style={[styles.brandName, { color: colors.foreground }]}>KhanaLagao</Text>
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
            Run your restaurant from your pocket. Orders, kitchen, tables, customers — all in one place.
          </Text>
        </View>

        <View style={{ gap: 12, marginTop: 32 }}>
          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={() => router.push("/register" as never)}
            testID="welcome-register"
          >
            <Text style={styles.primaryBtnText}>Create account</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.secondaryBtn,
              { borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={() => router.push("/login")}
            testID="welcome-login"
          >
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>I already have an account</Text>
          </Pressable>

          {isIOS && (
            // Apple sign-in is intentionally a no-op stub: the backend has no
            // /auth/apple/verify endpoint today. Task spec says to flag rather
            // than invent one. We surface the button on iOS so the UI is
            // ready, but it explains the situation when tapped.
            <Pressable
              style={({ pressed }) => [
                styles.secondaryBtn,
                { borderColor: colors.border, flexDirection: "row", gap: 8, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={() => router.push("/login")}
              testID="welcome-apple-stub"
            >
              <Ionicons name="logo-apple" size={18} color={colors.foreground} />
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Continue with Apple (coming soon)</Text>
            </Pressable>
          )}
        </View>

        <Text style={[styles.legal, { color: colors.mutedForeground }]}>
          By continuing you agree to our{" "}
          <Text style={{ color: colors.primary }} onPress={() => Linking.openURL("https://khanalagao.com/terms").catch(() => {})}>
            Terms
          </Text>{" "}
          and{" "}
          <Text style={{ color: colors.primary }} onPress={() => Linking.openURL("https://khanalagao.com/privacy").catch(() => {})}>
            Privacy Policy
          </Text>.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, justifyContent: "center" },
  brand: { alignItems: "center", gap: 12 },
  logoImg: { width: 120, height: 120 },
  brandName: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  tagline: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 320, lineHeight: 22, marginTop: 4 },
  primaryBtn: { borderRadius: 12, paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  secondaryBtnText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  legal: { fontSize: 12, textAlign: "center", marginTop: 24, lineHeight: 18 },
});
