import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert, Linking,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth, type AuthUser } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import { PhoneInput } from "@/components/PhoneInput";
import { roleHomePath } from "@/lib/roles";

type Step = "details" | "otp";
type Channel = "sms" | "whatsapp";

interface AuthResp {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}
interface OtpStartResp { registrationToken: string }

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data as T;
}

// Splits "+91 9876543210" → { countryCode: "+91", local: "9876543210" }.
// Mirrors the parsing in web register.tsx so the API behaves identically.
function splitPhone(input: string): { countryCode: string; local: string } {
  const trimmed = input.trim();
  const m = trimmed.match(/^(\+\d{1,4})(.*)$/);
  return {
    countryCode: m?.[1] ?? "+91",
    local: (m?.[2] ?? trimmed).replace(/[^\d]/g, ""),
  };
}

export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();

  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [referral, setReferral] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [terms, setTerms] = useState(false);
  const [channel, setChannel] = useState<Channel>("sms");
  const [showPassword, setShowPassword] = useState(false);

  const [token, setToken] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [resendIn, setResendIn] = useState(0);

  const [signupEnabled, setSignupEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${getApiBaseUrl()}/api/auth/settings/public`);
        if (r.ok) {
          const s = (await r.json()) as { signupEnabled?: boolean; otpDefaultChannel?: "sms" | "whatsapp" };
          if (s.signupEnabled === false) setSignupEnabled(false);
          if (s.otpDefaultChannel === "whatsapp") setChannel("whatsapp");
        }
      } catch { /* default to enabled */ }
    })();
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function validateDetails(): string | null {
    if (!name.trim()) return "Enter your full name.";
    if (!restaurantName.trim()) return "Enter your restaurant name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email.";
    if (!phone.trim()) return "Enter your mobile number.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== confirm) return "Passwords don't match.";
    if (!terms) return "Please accept the Terms & Privacy Policy to continue.";
    return null;
  }

  async function startOtp() {
    const err = validateDetails();
    if (err) { Alert.alert("Check your details", err); return; }
    setLoading(true);
    try {
      const { countryCode, local } = splitPhone(phone);
      const r = await postJSON<OtpStartResp>("/auth/register/start", {
        countryCode, phone: local, channel, referralCode: referral.trim() || undefined,
      });
      setToken(r.registrationToken);
      setResendIn(30);
      setStep("otp");
    } catch (e) {
      Alert.alert("Couldn't start signup", e instanceof Error ? e.message : "Try again");
    } finally { setLoading(false); }
  }

  async function resendOtp() {
    if (resendIn > 0) return;
    setLoading(true);
    try {
      const { countryCode, local } = splitPhone(phone);
      const r = await postJSON<OtpStartResp>("/auth/register/start", {
        countryCode, phone: local, channel, referralCode: referral.trim() || undefined,
      });
      setToken(r.registrationToken);
      setResendIn(30);
    } catch (e) {
      Alert.alert("Couldn't resend", e instanceof Error ? e.message : "Try again");
    } finally { setLoading(false); }
  }

  async function verifyAndComplete() {
    if (!token || otpCode.length !== 6) return;
    setLoading(true);
    try {
      await postJSON("/auth/register/verify-otp", { registrationToken: token, code: otpCode, channel });
      const auth = await postJSON<AuthResp>("/auth/register/complete", {
        registrationToken: token,
        restaurantName: restaurantName.trim(),
        ownerName: name.trim(),
        email: email.trim(),
        password,
      });
      await login(auth.accessToken, auth.refreshToken, auth.user);
      // After registration, owners go to onboarding; non-owner roles wouldn't
      // be created via signup (backend creates the user as owner), but we
      // still respect role-based home in case that ever changes.
      const owner = auth.user.role === "owner" || auth.user.role === "manager" || auth.user.role === "super_admin";
      router.replace((owner ? "/onboarding" : roleHomePath(auth.user.role)) as Parameters<typeof router.replace>[0]);
    } catch (e) {
      Alert.alert("Verification failed", e instanceof Error ? e.message : "Try again");
    } finally { setLoading(false); }
  }

  if (!signupEnabled) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, padding: 24, paddingTop: insets.top + 48 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Signups are paused</Text>
        <Text style={[styles.help, { color: colors.mutedForeground, marginTop: 8 }]}>
          New signups are temporarily disabled. Please come back later.
        </Text>
        <Pressable style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 24 }]} onPress={() => router.replace("/welcome")}>
          <Text style={styles.primaryBtnText}>Back to welcome</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable onPress={() => (step === "otp" ? setStep("details") : router.back())} hitSlop={12} style={{ padding: 4 }}>
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {step === "details" ? "Create your account" : "Verify your mobile"}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {step === "details" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Field label="Full name" colors={colors}>
              <TextInputBox value={name} onChangeText={setName} placeholder="Priya Sharma" colors={colors} icon="person-outline" />
            </Field>
            <Field label="Restaurant name" colors={colors}>
              <TextInputBox value={restaurantName} onChangeText={setRestaurantName} placeholder="Spice Garden" colors={colors} icon="restaurant-outline" />
            </Field>
            <Field label="Email" colors={colors}>
              <TextInputBox
                value={email} onChangeText={setEmail} placeholder="you@restaurant.com"
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                colors={colors} icon="mail-outline"
              />
            </Field>
            <Field label="Mobile number" colors={colors}>
              <PhoneInput value={phone} onChange={setPhone} defaultCountry="IN" placeholder="9876543210" testID="register-phone" />
            </Field>
            <Field label="Password" colors={colors}>
              <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  value={password} onChangeText={setPassword}
                  placeholder="At least 8 characters" placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showPassword}
                />
                <Pressable onPress={() => setShowPassword((p) => !p)} hitSlop={10}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </Field>
            <Field label="Confirm password" colors={colors}>
              <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  value={confirm} onChangeText={setConfirm}
                  placeholder="Repeat your password" placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showPassword}
                />
              </View>
            </Field>
            <Field label="Referral code (optional)" colors={colors}>
              <TextInputBox value={referral} onChangeText={setReferral} placeholder="FRIEND10" colors={colors} icon="pricetag-outline" autoCapitalize="characters" />
            </Field>

            <Pressable
              onPress={() => setTerms((t) => !t)}
              style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 4 }}
            >
              <View style={[styles.checkbox, { borderColor: terms ? colors.primary : colors.border, backgroundColor: terms ? colors.primary : "transparent" }]}>
                {terms && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 13, lineHeight: 18 }}>
                I agree to the{" "}
                <Text style={{ color: colors.primary }} onPress={() => Linking.openURL("https://khanalagao.com/terms").catch(() => {})}>
                  Terms of Service
                </Text>{" "}
                and{" "}
                <Text style={{ color: colors.primary }} onPress={() => Linking.openURL("https://khanalagao.com/privacy").catch(() => {})}>
                  Privacy Policy
                </Text>.
              </Text>
            </Pressable>

            <View style={{ marginTop: 4 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Send verification code via</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                {(["sms", "whatsapp"] as Channel[]).map((c) => (
                  <Pressable key={c} onPress={() => setChannel(c)}
                    style={[styles.channelBtn, {
                      borderColor: channel === c ? colors.primary : colors.border,
                      backgroundColor: channel === c ? colors.primary + "14" : "transparent",
                    }]}>
                    <Text style={{ color: channel === c ? colors.primary : colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                      {c === "sms" ? "SMS" : "WhatsApp"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Pressable
              onPress={startOtp} disabled={loading}
              style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed || loading ? 0.85 : 1 }]}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
            </Pressable>

            <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center" }}>
              Already have an account?{" "}
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }} onPress={() => router.replace("/login")}>
                Sign in
              </Text>
            </Text>
          </View>
        )}

        {step === "otp" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              We sent a 6-digit code to{" "}
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{phone}</Text>
              {" "}via {channel === "whatsapp" ? "WhatsApp" : "SMS"}.{" "}
              <Text style={{ color: colors.primary }} onPress={() => setStep("details")}>Change</Text>
            </Text>
            <Field label="Verification code" colors={colors}>
              <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                <Ionicons name="key-outline" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground, letterSpacing: 4 }]}
                  value={otpCode}
                  onChangeText={(v) => setOtpCode(v.replace(/\D/g, "").slice(0, 6))}
                  keyboardType="number-pad" maxLength={6}
                  placeholder="123456" placeholderTextColor={colors.mutedForeground}
                  autoFocus
                />
              </View>
            </Field>

            <Pressable
              onPress={verifyAndComplete}
              disabled={loading || otpCode.length !== 6}
              style={({ pressed }) => [styles.primaryBtn, {
                backgroundColor: colors.primary,
                opacity: pressed || loading || otpCode.length !== 6 ? 0.6 : 1,
              }]}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Verify & create account</Text>}
            </Pressable>

            <Pressable onPress={resendOtp} disabled={resendIn > 0 || loading}>
              <Text style={{ color: resendIn > 0 ? colors.mutedForeground : colors.primary, textAlign: "center", fontSize: 13 }}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, colors, children }: { label: string; colors: ReturnType<typeof useColors>; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      {children}
    </View>
  );
}

function TextInputBox({
  value, onChangeText, placeholder, colors, icon, keyboardType, autoCapitalize, autoCorrect,
}: {
  value: string; onChangeText: (v: string) => void; placeholder: string;
  colors: ReturnType<typeof useColors>; icon: keyof typeof Ionicons.glyphMap;
  keyboardType?: "default" | "email-address" | "phone-pad" | "number-pad";
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  autoCorrect?: boolean;
}) {
  return (
    <View style={[styles.inputWrap, { borderColor: colors.border }]}>
      <Ionicons name={icon} size={18} color={colors.mutedForeground} />
      <TextInput
        style={[styles.input, { color: colors.foreground }]}
        value={value} onChangeText={onChangeText}
        placeholder={placeholder} placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType} autoCapitalize={autoCapitalize} autoCorrect={autoCorrect}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 14 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  help: { fontSize: 14, fontFamily: "Inter_400Regular" },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputWrap: {
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  primaryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  channelBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
