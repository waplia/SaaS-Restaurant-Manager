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
import { PhoneInput } from "@/components/PhoneInput";
import { parsePhone, expectedNationalLength } from "@workspace/phone-utils";

// OTP-based password reset (replaces the old email-link flow).
//   step "email"   → enter email, server emails a 6-digit code
//   step "verify"  → enter the code + new password on the same screen
//   step "done"    → confirmation, bounce back to /login
type Step = "email" | "verify" | "done";
type Method = "email" | "phone";

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [method, setMethod] = useState<Method>("email");
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ttl, setTtl] = useState(15);
  const [loading, setLoading] = useState(false);

  const identifierLabel = method === "phone" ? phone : email;

  // Convert the PhoneInput's stored value ("91 9876543210") to E.164 form
  // ("+919876543210") for the API.
  function toE164(raw: string): string {
    const p = parsePhone(raw, "IN");
    const digits = p.national.replace(/\D+/g, "");
    if (!digits) return raw.trim();
    return `+${p.country.code.replace(/^\+/, "")}${digits}`;
  }

  // Validate the phone using the shared country metadata (same source the
  // register / wallet flows use) so users get the right country-aware
  // length check.
  function validatePhone(): string | null {
    const parsed = parsePhone(phone, "IN");
    const digits = parsed.national.replace(/\D+/g, "");
    if (!parsed.country.iso || !digits) {
      return "Enter your mobile number.";
    }
    const expected = expectedNationalLength(parsed.country.iso);
    if (expected > 0 && expected < 15 && digits.length !== expected) {
      return `Enter a ${expected}-digit mobile number for ${parsed.country.name}.`;
    }
    if (digits.length < 6) {
      return "Enter a valid mobile number.";
    }
    return null;
  }

  async function requestCode(isResend = false) {
    if (method === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        Alert.alert("Required", "Enter a valid email.");
        return;
      }
    } else {
      const err = validatePhone();
      if (err) { Alert.alert("Check your number", err); return; }
    }
    setLoading(true);
    try {
      const url = method === "phone"
        ? `${getApiBaseUrl()}/api/auth/forgot-password-phone`
        : `${getApiBaseUrl()}/api/auth/forgot-password`;
      const body = method === "phone"
        ? { phone: toE164(phone) }
        : { email: email.trim() };
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as { ttlMinutes?: number; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Couldn't send code.");
      if (typeof data.ttlMinutes === "number") setTtl(data.ttlMinutes);
      if (isResend) {
        Alert.alert("Code sent", method === "phone"
          ? "A new code has been sent via SMS."
          : "A new code has been sent to your email.");
      }
      setStep("verify");
    } catch (e) {
      Alert.alert("Something went wrong", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitReset() {
    if (!/^\d{6}$/.test(code.trim())) {
      Alert.alert("Required", method === "phone"
        ? "Enter the 6-digit code from the SMS."
        : "Enter the 6-digit code from your email.");
      return;
    }
    if (password.length < 8)          { Alert.alert("Too short", "Password must be at least 8 characters."); return; }
    if (password !== confirm)         { Alert.alert("Mismatch", "Passwords do not match."); return; }
    setLoading(true);
    try {
      const url = method === "phone"
        ? `${getApiBaseUrl()}/api/auth/reset-password-phone`
        : `${getApiBaseUrl()}/api/auth/reset-password`;
      const body = method === "phone"
        ? { phone: toE164(phone), code: code.trim(), newPassword: password }
        : { email: email.trim().toLowerCase(), code: code.trim(), newPassword: password };
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Reset failed.");
      setStep("done");
      setTimeout(() => router.replace("/login"), 1500);
    } catch (e) {
      Alert.alert("Couldn't reset password", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setLoading(false);
    }
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
          {step === "email" && (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>Forgot your password?</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 14, lineHeight: 20 }}>
                Choose how you'd like to receive a 6-digit reset code.
              </Text>

              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["email", "phone"] as const).map(m => (
                  <Pressable
                    key={m}
                    onPress={() => setMethod(m)}
                    style={({ pressed }) => [{
                      flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
                      borderColor: method === m ? colors.primary : colors.border,
                      backgroundColor: method === m ? colors.primary + "18" : "transparent",
                      alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6,
                      opacity: pressed ? 0.85 : 1,
                    }]}
                  >
                    <Ionicons
                      name={m === "email" ? "mail-outline" : "call-outline"}
                      size={16}
                      color={method === m ? colors.primary : colors.mutedForeground}
                    />
                    <Text style={{
                      color: method === m ? colors.primary : colors.foreground,
                      fontFamily: "Inter_600SemiBold", fontSize: 13,
                    }}>{m === "email" ? "Email" : "Phone"}</Text>
                  </Pressable>
                ))}
              </View>

              {method === "email" ? (
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
              ) : (
                <View style={{ gap: 6 }}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>Mobile number</Text>
                  <PhoneInput value={phone} onChange={setPhone} defaultCountry="IN" placeholder="9876543210" testID="forgot-phone" />
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    Use the mobile number on your account. We'll send the code via SMS.
                  </Text>
                </View>
              )}

              <Pressable
                onPress={() => requestCode(false)} disabled={loading}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed || loading ? 0.85 : 1 }]}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send code</Text>}
              </Pressable>

              <Pressable onPress={() => router.replace("/login")}>
                <Text style={{ color: colors.mutedForeground, textAlign: "center", fontSize: 13 }}>
                  Remembered it? <Text style={{ color: colors.primary }}>Sign in</Text>
                </Text>
              </Pressable>
            </>
          )}

          {step === "verify" && (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>Enter code &amp; new password</Text>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.primary + "12", borderColor: colors.primary + "30", borderWidth: 1, borderRadius: 10, padding: 10 }}>
                <Ionicons name={method === "phone" ? "chatbox-ellipses-outline" : "mail-outline"} size={16} color={colors.primary} style={{ marginTop: 2 }} />
                <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 13, lineHeight: 18 }}>
                  We sent a 6-digit code {method === "phone" ? "via SMS to" : "to"}{" "}
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{identifierLabel}</Text>.
                  It expires in {ttl} minutes.
                </Text>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Verification code</Text>
                <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                  <Ionicons name="keypad-outline" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground, letterSpacing: 8, textAlign: "center", fontSize: 18, fontFamily: "Inter_600SemiBold" }]}
                    value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456" placeholderTextColor={colors.mutedForeground}
                    keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode"
                  />
                </View>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>New password</Text>
                <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                  <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    value={password} onChangeText={setPassword}
                    placeholder="At least 8 characters" placeholderTextColor={colors.mutedForeground}
                    secureTextEntry autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Confirm new password</Text>
                <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                  <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    value={confirm} onChangeText={setConfirm}
                    placeholder="Repeat new password" placeholderTextColor={colors.mutedForeground}
                    secureTextEntry autoCapitalize="none"
                  />
                </View>
              </View>

              <Pressable
                onPress={submitReset} disabled={loading}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed || loading ? 0.85 : 1 }]}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Update password</Text>}
              </Pressable>

              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Pressable onPress={() => { setStep("email"); setCode(""); setPassword(""); setConfirm(""); }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    ← Change {method === "phone" ? "phone" : "email"}
                  </Text>
                </Pressable>
                <Pressable onPress={() => requestCode(true)} disabled={loading}>
                  <Text style={{ color: colors.primary, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>Resend code</Text>
                </Pressable>
              </View>
            </>
          )}

          {step === "done" && (
            <View style={{ alignItems: "center", gap: 12, paddingVertical: 8 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary + "22", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="checkmark-circle" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.title, { color: colors.foreground, textAlign: "center" }]}>Password updated!</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 14, textAlign: "center" }}>
                Redirecting you to sign in…
              </Text>
            </View>
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
