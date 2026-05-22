import React, { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import { PhoneInput } from "@/components/PhoneInput";
import { parsePhone, expectedNationalLength } from "@workspace/phone-utils";

// Two-step "delete my account" flow:
//   step "password" → password + channel (+ phone) → server sends OTP
//   step "verify"   → enter 6-digit OTP → account soft-deleted, sign out
//   step "done"     → confirmation, bounce back to /login
type Step = "password" | "verify" | "done";
type Channel = "sms" | "email";

export default function DeleteAccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, accessToken } = useAuth();
  const [step, setStep] = useState<Step>("password");
  const [channel, setChannel] = useState<Channel>("sms");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [ttl, setTtl] = useState(5);
  const [loading, setLoading] = useState(false);

  function toE164(raw: string): string {
    const p = parsePhone(raw, "IN");
    const digits = p.national.replace(/\D+/g, "");
    if (!digits) return raw.trim();
    return `+${p.country.code.replace(/^\+/, "")}${digits}`;
  }
  function validatePhone(): string | null {
    const parsed = parsePhone(phone, "IN");
    const digits = parsed.national.replace(/\D+/g, "");
    if (!parsed.country.iso || !digits) return "Enter your mobile number.";
    const expected = expectedNationalLength(parsed.country.iso);
    if (expected > 0 && expected < 15 && digits.length !== expected) {
      return `Enter a ${expected}-digit mobile number for ${parsed.country.name}.`;
    }
    if (digits.length < 6) return "Enter a valid mobile number.";
    return null;
  }

  async function requestOtp() {
    if (password.length < 1) { Alert.alert("Required", "Enter your password."); return; }
    let phoneE164: string | undefined;
    if (channel === "sms") {
      const err = validatePhone();
      if (err) { Alert.alert("Check your number", err); return; }
      phoneE164 = toE164(phone);
    }
    setLoading(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/account/delete/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
        body: JSON.stringify({ password, channel, phone: phoneE164 }),
      });
      const data = (await r.json().catch(() => ({}))) as { ttlMinutes?: number; identifier?: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Could not send code.");
      if (typeof data.ttlMinutes === "number") setTtl(data.ttlMinutes);
      setIdentifier(data.identifier ?? (channel === "sms" ? phoneE164 ?? "" : user?.email ?? ""));
      setStep("verify");
    } catch (e) {
      Alert.alert("Couldn't send code", e instanceof Error ? e.message : "Please try again.");
    } finally { setLoading(false); }
  }

  async function confirmDelete() {
    if (!/^\d{6}$/.test(code.trim())) {
      Alert.alert("Required", channel === "sms" ? "Enter the 6-digit code from the SMS." : "Enter the 6-digit code from your email.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/account/delete/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
        body: JSON.stringify({ channel, identifier, code: code.trim(), reason: reason.trim() || undefined }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Could not delete account.");
      setStep("done");
      // Sign the user out locally and bounce to login after a brief
      // confirmation. The server already revoked their session + bumped
      // tokenVersion so even cached tokens stop working.
      setTimeout(async () => { await logout(); router.replace("/login"); }, 1500);
    } catch (e) {
      Alert.alert("Couldn't delete account", e instanceof Error ? e.message : "Please try again.");
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
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Delete account</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={[styles.warning, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "40" }]}>
          <Ionicons name="warning-outline" size={20} color={colors.destructive} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, color: colors.destructive, fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium" }}>
            This will sign you out and disable your account. A platform admin can restore it later if you change your mind.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {step === "password" && (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>Confirm it's you</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 14, lineHeight: 20 }}>
                Enter your password, then we'll send a 6-digit code to verify.
              </Text>

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
                <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                  <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    value={password} onChangeText={setPassword}
                    placeholder="Your current password" placeholderTextColor={colors.mutedForeground}
                    secureTextEntry autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["sms", "email"] as const).map(m => (
                  <Pressable
                    key={m}
                    onPress={() => setChannel(m)}
                    style={({ pressed }) => [{
                      flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
                      borderColor: channel === m ? colors.primary : colors.border,
                      backgroundColor: channel === m ? colors.primary + "18" : "transparent",
                      alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6,
                      opacity: pressed ? 0.85 : 1,
                    }]}
                  >
                    <Ionicons
                      name={m === "sms" ? "call-outline" : "mail-outline"}
                      size={16}
                      color={channel === m ? colors.primary : colors.mutedForeground}
                    />
                    <Text style={{
                      color: channel === m ? colors.primary : colors.foreground,
                      fontFamily: "Inter_600SemiBold", fontSize: 13,
                    }}>{m === "sms" ? "SMS" : "Email"}</Text>
                  </Pressable>
                ))}
              </View>

              {channel === "sms" ? (
                <View style={{ gap: 6 }}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>Mobile number</Text>
                  <PhoneInput value={phone} onChange={setPhone} defaultCountry="IN" placeholder="9876543210" testID="delete-phone" />
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    We'll send the code by SMS.
                  </Text>
                </View>
              ) : (
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  Code will be emailed to <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{user?.email}</Text>.
                </Text>
              )}

              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Reason (optional)</Text>
                <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                  <Ionicons name="chatbubble-outline" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    value={reason} onChangeText={setReason}
                    placeholder="Help us improve" placeholderTextColor={colors.mutedForeground}
                    maxLength={500}
                  />
                </View>
              </View>

              <Pressable
                onPress={requestOtp} disabled={loading}
                style={({ pressed }) => [styles.dangerBtn, { backgroundColor: colors.destructive, opacity: pressed || loading ? 0.85 : 1 }]}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.dangerBtnText}>Send code</Text>}
              </Pressable>
            </>
          )}

          {step === "verify" && (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>Enter verification code</Text>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.primary + "12", borderColor: colors.primary + "30", borderWidth: 1, borderRadius: 10, padding: 10 }}>
                <Ionicons name={channel === "sms" ? "chatbox-ellipses-outline" : "mail-outline"} size={16} color={colors.primary} style={{ marginTop: 2 }} />
                <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 13, lineHeight: 18 }}>
                  We sent a 6-digit code {channel === "sms" ? "via SMS to" : "to"}{" "}
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{identifier}</Text>.
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

              <Pressable
                onPress={confirmDelete} disabled={loading}
                style={({ pressed }) => [styles.dangerBtn, { backgroundColor: colors.destructive, opacity: pressed || loading ? 0.85 : 1 }]}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.dangerBtnText}>Delete my account</Text>}
              </Pressable>

              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Pressable onPress={() => { setStep("password"); setCode(""); }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>← Change details</Text>
                </Pressable>
                <Pressable onPress={requestOtp} disabled={loading}>
                  <Text style={{ color: colors.primary, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>Resend code</Text>
                </Pressable>
              </View>
            </>
          )}

          {step === "done" && (
            <View style={{ alignItems: "center", gap: 12, paddingVertical: 8 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.destructive + "22", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="checkmark-circle" size={32} color={colors.destructive} />
              </View>
              <Text style={[styles.title, { color: colors.foreground, textAlign: "center" }]}>Account deleted</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 14, textAlign: "center" }}>
                Signing you out…
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
  warning: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  card: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 14 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputWrap: {
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  dangerBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  dangerBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
