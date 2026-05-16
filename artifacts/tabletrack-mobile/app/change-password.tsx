import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView, Platform, ActivityIndicator, KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export default function ChangePasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, accessToken, updateTokens } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const baseUrl = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

  async function onSubmit() {
    setError(null);
    setSuccess(false);

    if (!currentPassword) { setError("Enter your current password."); return; }
    if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("New password and confirmation do not match."); return; }
    if (newPassword === currentPassword) { setError("New password must be different from the current one."); return; }
    if (!user || !accessToken) { setError("You are not signed in."); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Could not change password" }));
        throw new Error(data.error ?? "Could not change password");
      }
      const data = await res.json() as { accessToken: string; refreshToken: string };
      // Swap in fresh tokens bound to the new tokenVersion so this device
      // stays signed in while every other session for this user is revoked.
      // updateTokens also refreshes the in-memory access token used by
      // setAuthTokenGetter, so subsequent API calls use the new credentials
      // without needing an app restart.
      await updateTokens(data.accessToken, data.refreshToken);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 24 : insets.top + 8, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn} testID="back-btn">
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Change password</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular" }}>
            For your security, changing your password will sign you out of every other device.
          </Text>

          <Field
            label="Current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            colors={colors}
            disabled={submitting}
            testID="input-current-password"
          />
          <Field
            label="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            colors={colors}
            disabled={submitting}
            hint="At least 8 characters."
            testID="input-new-password"
          />
          <Field
            label="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            colors={colors}
            disabled={submitting}
            testID="input-confirm-password"
          />

          {error && (
            <View style={[styles.banner, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "55" }]} testID="change-password-error">
              <Ionicons name="alert-circle-outline" size={18} color={colors.destructive} />
              <Text style={{ flex: 1, color: colors.destructive, fontSize: 13, fontFamily: "Inter_500Medium" }}>{error}</Text>
            </View>
          )}
          {success && (
            <View style={[styles.banner, { backgroundColor: colors.accent, borderColor: colors.primary + "55" }]} testID="change-password-success">
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
              <Text style={{ flex: 1, color: colors.primary, fontSize: 13, fontFamily: "Inter_500Medium" }}>
                Password updated. Other devices have been signed out.
              </Text>
            </View>
          )}

          <Pressable
            onPress={onSubmit}
            disabled={submitting}
            style={({ pressed }) => [
              styles.submitBtn,
              { backgroundColor: colors.primary, opacity: submitting ? 0.6 : pressed ? 0.85 : 1 },
            ]}
            testID="submit-change-password"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>Update password</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Field({
  label, value, onChangeText, colors, disabled, hint, testID,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  colors: ReturnType<typeof useColors>;
  disabled?: boolean;
  hint?: string;
  testID?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        style={[
          styles.input,
          { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
        ]}
        placeholderTextColor={colors.mutedForeground}
        testID={testID}
      />
      {hint && (
        <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{hint}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  submitBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
