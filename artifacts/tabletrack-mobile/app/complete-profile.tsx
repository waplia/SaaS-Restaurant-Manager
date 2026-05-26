import React, { useEffect, useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import { PhoneInput } from "@/components/PhoneInput";

type AuthUser = { id: number; name: string | null; email: string; role: string;
  tenantId: number | null; restaurantId: number | null; isSuperAdmin: boolean; phone?: string | null };

// Reached only when /auth/google/verify returned `pending: true`. Until phone
// is verified via OTP the user has no access token and can't reach any other
// screen — phone verification is mandatory.
export default function CompleteProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const params = useLocalSearchParams<{ pendingToken?: string; missingRestaurant?: string }>();
  const pendingToken = params.pendingToken ?? "";
  const missingRestaurant = params.missingRestaurant === "1";
  const baseUrl = `${getApiBaseUrl()}/api`;

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [restaurantName, setRestaurantName] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${baseUrl}/auth/settings/public`);
        if (r.ok) {
          const s = (await r.json()) as { whatsappEnabled?: boolean };
          if (s.whatsappEnabled === false) {
            setWhatsappEnabled(false);
            setChannel("sms");
          }
        }
      } catch { /* default to enabled */ }
    })();
  }, [baseUrl]);

  async function requestOtp() {
    if (!phone.trim()) { Alert.alert("Required", "Enter your mobile number."); return; }
    if (missingRestaurant && !restaurantName.trim()) {
      Alert.alert("Required", "Enter your restaurant name."); return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${baseUrl}/auth/google/pending/request-otp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, phone: phone.trim(), channel }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error ?? "Could not send code");
      setStep("code");
    } catch (e) {
      Alert.alert("Could not send code", e instanceof Error ? e.message : "Try again");
    } finally { setLoading(false); }
  }

  async function verifyCode() {
    if (code.length !== 6) { Alert.alert("Invalid code", "Enter the 6-digit code."); return; }
    setLoading(true);
    try {
      const r = await fetch(`${baseUrl}/auth/google/pending/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingToken, phone: phone.trim(), code, channel,
          restaurantName: restaurantName.trim() || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error ?? "Invalid code");
      const payload = data as { accessToken: string; refreshToken: string; user: AuthUser };
      await login(payload.accessToken, payload.refreshToken, {
        ...payload.user,
        name: payload.user.name ?? payload.user.email ?? "",
      });
      router.replace("/");
    } catch (e) {
      Alert.alert("Verification failed", e instanceof Error ? e.message : "Try again");
    } finally { setLoading(false); }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 24 }} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: colors.foreground }]}>
            Verify your phone to finish signing up
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            We need to confirm your mobile number before your account becomes active.
          </Text>

          {step === "phone" && (
            <View style={{ marginTop: 24, gap: 16 }}>
              {missingRestaurant && (
                <View>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>Restaurant name</Text>
                  <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: "transparent" }]}>
                    <Ionicons name="restaurant-outline" size={18} color={colors.mutedForeground} />
                    <TextInput style={[styles.input, { color: colors.foreground }]}
                      value={restaurantName} onChangeText={setRestaurantName}
                      placeholder="Enter your restaurant name" placeholderTextColor={colors.mutedForeground} />
                  </View>
                </View>
              )}
              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Mobile number</Text>
                <PhoneInput value={phone} onChange={setPhone} defaultCountry="IN" placeholder="Enter your mobile number" />
              </View>
              {whatsappEnabled && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["sms", "whatsapp"] as const).map(c => (
                    <Pressable key={c} onPress={() => setChannel(c)}
                      style={[styles.chip, { borderColor: channel === c ? colors.primary : colors.border,
                        backgroundColor: channel === c ? colors.primary + "14" : "transparent" }]}>
                      <Text style={{ color: channel === c ? colors.primary : colors.mutedForeground, fontWeight: "500" }}>
                        {c === "sms" ? "SMS" : "WhatsApp"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Pressable onPress={requestOtp} disabled={loading}
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed || loading ? 0.8 : 1 }]}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send code</Text>}
              </Pressable>
            </View>
          )}

          {step === "code" && (
            <View style={{ marginTop: 24, gap: 16 }}>
              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Verification code</Text>
                <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: "transparent" }]}>
                  <Ionicons name="keypad-outline" size={18} color={colors.mutedForeground} />
                  <TextInput style={[styles.input, { color: colors.foreground, letterSpacing: 4 }]}
                    value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                    keyboardType="number-pad" maxLength={6}
                    placeholder="Enter 6-digit code" placeholderTextColor={colors.mutedForeground} autoFocus />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={() => { setStep("phone"); setCode(""); }} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.foreground }}>Back</Text>
                </Pressable>
                <Pressable onPress={verifyCode} disabled={loading || code.length !== 6}
                  style={({ pressed }) => [styles.primaryBtn, { flex: 1, backgroundColor: colors.primary,
                    opacity: pressed || loading || code.length !== 6 ? 0.7 : 1 }]}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Verify & continue</Text>}
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "600" },
  subtitle: { fontSize: 14, marginTop: 6 },
  label: { fontSize: 13, marginBottom: 6 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 48 },
  input: { flex: 1, fontSize: 15 },
  chip: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10, borderWidth: 1 },
  primaryBtn: { paddingVertical: 14, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  secondaryBtn: { paddingHorizontal: 18, paddingVertical: 14, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
