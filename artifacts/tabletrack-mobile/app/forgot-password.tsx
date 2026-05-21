import React, { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

// The backend only exposes an email-link reset flow (POST /auth/forgot-password
// + POST /auth/reset-password with a token from the email link). There is no
// OTP-based password reset endpoint, so this screen mirrors the web app exactly
// — submit your email, then check your inbox for the reset link.
export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert("Required", "Enter a valid email.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!r.ok) throw new Error("Request failed");
      setSent(true);
    } catch (e) {
      Alert.alert("Something went wrong", e instanceof Error ? e.message : "Please try again.");
    } finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Reset password</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {sent ? (
            <View style={{ alignItems: "center", gap: 12, paddingVertical: 8 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary + "22", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="mail-outline" size={28} color={colors.primary} />
              </View>
              <Text style={[styles.title, { color: colors.foreground, textAlign: "center" }]}>Check your inbox</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                If an account exists for{" "}
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{email}</Text>,
                we've sent a password reset link. Tap the link in the email to set a new password.
              </Text>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 12, alignSelf: "stretch" }]}
                onPress={() => router.replace("/login")}
              >
                <Text style={styles.primaryBtnText}>Back to sign in</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>Forgot your password?</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 14, lineHeight: 20 }}>
                Enter the email you used to sign up. We'll send you a secure link to set a new password.
              </Text>

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
                <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                  <Ionicons name="mail-outline" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    value={email} onChangeText={setEmail}
                    placeholder="you@restaurant.com" placeholderTextColor={colors.mutedForeground}
                    keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                  />
                </View>
              </View>

              <Pressable
                onPress={submit} disabled={loading}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed || loading ? 0.85 : 1 }]}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send reset link</Text>}
              </Pressable>

              <Pressable onPress={() => router.replace("/login")}>
                <Text style={{ color: colors.mutedForeground, textAlign: "center", fontSize: 13 }}>
                  Remembered it? <Text style={{ color: colors.primary }}>Sign in</Text>
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 14 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputWrap: {
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  primaryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
