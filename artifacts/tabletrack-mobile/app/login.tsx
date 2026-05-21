import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert, Image,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { useColors } from "@/hooks/useColors";
import { useAuth, type AuthUser } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

WebBrowser.maybeCompleteAuthSession();

// Resolve the OAuth client ID for the current platform. Falls back to the
// web client ID so a single configured ID keeps working in Expo Go via the
// proxy; standalone iOS/Android builds need their own per-platform IDs.
function resolveGoogleClientId(s: PublicAuthSettings | null | undefined): string | undefined {
  if (!s?.googleSignInEnabled) return undefined;
  const web = s.googleClientId ?? undefined;
  if (Platform.OS === "ios") return s.googleIosClientId ?? web;
  if (Platform.OS === "android") return s.googleAndroidClientId ?? web;
  return web;
}

// Isolated child so Google.useIdTokenAuthRequest is only called when we
// actually have a client ID for this platform — passing undefined throws
// "Client Id property `iosClientId` must be defined" at hook-call time.
function GoogleSignInButton({
  webClientId, iosClientId, androidClientId,
  label, disabled, onIdToken, onError, colors, styles, testID,
}: {
  webClientId?: string; iosClientId?: string; androidClientId?: string;
  label: string; disabled?: boolean;
  onIdToken: (idToken: string) => void;
  onError: (msg: string) => void;
  colors: ReturnType<typeof useColors>;
  styles: { secondaryBtn: object; secondaryBtnText: object };
  testID?: string;
}) {
  const [, , promptGoogle] = Google.useIdTokenAuthRequest({
    clientId: webClientId,
    iosClientId,
    androidClientId,
    webClientId,
  });
  async function press() {
    try {
      const res = await promptGoogle();
      if (res?.type === "success" && res.params.id_token) {
        onIdToken(res.params.id_token);
      } else if (res?.type === "error") {
        onError(res.error?.message ?? "Cancelled");
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Try again");
    }
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.secondaryBtn, {
        borderColor: colors.border,
        flexDirection: "row", gap: 8,
        opacity: pressed || disabled ? 0.7 : 1,
      }]}
      onPress={press}
      disabled={disabled}
      testID={testID}
    >
      <Ionicons name="logo-google" size={18} color={colors.foreground} />
      <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

type Tab = "password" | "mobile" | "email";
type Channel = "sms" | "whatsapp" | "email";

interface PublicAuthSettings {
  passwordLoginEnabled: boolean;
  mobileOtpLoginEnabled: boolean;
  emailOtpLoginEnabled: boolean;
  twoFactorEnabled: boolean;
  otpDefaultChannel: "sms" | "whatsapp";
  googleSignInEnabled?: boolean;
  googleClientId?: string | null;
  googleIosClientId?: string | null;
  googleAndroidClientId?: string | null;
}

interface LoginResp {
  accessToken?: string;
  refreshToken?: string;
  user?: AuthUser;
  requires2fa?: boolean;
  twoFactorChannel?: Channel;
  userId?: number;
  identifierHint?: string;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? "Request failed");
  }
  return data as T;
}

function routeForRole(role: string) {
  if (role === "owner" || role === "manager" || role === "super_admin") return "/(owner)";
  if (role === "waiter" || role === "captain") return "/(waiter)/(tabs)";
  // Kitchen/chef live inside the (owner) stack on the dedicated kitchen screen.
  // Sending them to (waiter)/notifications used to bounce them via AuthGate and
  // index.tsx in a redirect loop ("Maximum update depth exceeded"). Keep this
  // map aligned with `lib/roles.ts:roleHomePath` so a fresh login and a cached
  // session land on the same screen.
  if (role === "kitchen" || role === "chef") return "/(owner)/kitchen";
  if (role === "cashier") return "/(owner)/orders";
  if (role === "inventory_manager") return "/(owner)/inventory";
  if (role === "accountant" || role === "payroll") return "/(owner)/finance";
  if (role === "hr") return "/(owner)/staff";
  if (role === "marketing") return "/(owner)/growth";
  if (role === "delivery_executive") return "/(delivery)/my-deliveries";
  if (role === "customer") return "/(customer)";
  return "/(owner)";
}

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const isWeb = Platform.OS === "web";

  const [authSettings, setAuthSettings] = useState<PublicAuthSettings | null>(null);
  const [tab, setTab] = useState<Tab>("password");

  // password
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // otp request/verify
  const [otpIdentifier, setOtpIdentifier] = useState("");
  const [otpChannel, setOtpChannel] = useState<Channel>("sms");
  const [otpCode, setOtpCode] = useState("");
  const [otpStep, setOtpStep] = useState<"request" | "verify">("request");
  const [devCode, setDevCode] = useState<string | null>(null);

  // 2fa
  const [twoFa, setTwoFa] = useState<{ userId: number; channel: Channel; hint?: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const base = getApiBaseUrl();
        const res = await fetch(`${base}/api/auth/settings/public`);
        if (res.ok) {
          const s = (await res.json()) as PublicAuthSettings;
          setAuthSettings(s);
          setOtpChannel(s.otpDefaultChannel === "whatsapp" ? "whatsapp" : "sms");
          if (!s.passwordLoginEnabled) {
            if (s.mobileOtpLoginEnabled) setTab("mobile");
            else if (s.emailOtpLoginEnabled) setTab("email");
          }
        }
      } catch { /* fall back to defaults */ }
    })();
  }, []);

  async function finishLogin(data: { accessToken: string; refreshToken: string; user: AuthUser }) {
    await login(data.accessToken, data.refreshToken ?? "", data.user);
    router.replace(routeForRole(data.user.role) as Parameters<typeof router.replace>[0]);
  }

  async function handlePasswordLogin() {
    if (!identifier.trim() || !password.trim()) {
      Alert.alert("Required", "Please enter your email or mobile number and password.");
      return;
    }
    setLoading(true);
    try {
      const r = await postJSON<LoginResp>("/auth/login-2fa", { identifier: identifier.trim(), password });
      if (r.requires2fa && r.userId && r.twoFactorChannel) {
        setTwoFa({ userId: r.userId, channel: r.twoFactorChannel, hint: r.identifierHint });
      } else if (r.accessToken && r.refreshToken && r.user) {
        await finishLogin({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
      } else {
        Alert.alert("Login failed", "Invalid login details.");
      }
    } catch (err) {
      Alert.alert("Login failed", err instanceof Error ? err.message : "Invalid login details");
    } finally { setLoading(false); }
  }

  // Google sign-in is implemented in a child component (GoogleSignInButton)
  // because expo-auth-session's Google.useIdTokenAuthRequest validates
  // `iosClientId` / `androidClientId` at hook-call time on native — passing
  // `undefined` throws "Client Id property `iosClientId` must be defined".
  // Mounting the child only when a client ID is configured guarantees the
  // hook is never called with missing values, while still respecting the
  // Rules of Hooks (the child's hook is unconditional within its own render).
  const googleConfigured = !!resolveGoogleClientId(authSettings);
  async function handleGoogleIdToken(idToken: string) {
    setLoading(true);
    try {
      const r = await postJSON<LoginResp & {
        pending?: boolean; pendingToken?: string;
        needsProfileCompletion?: boolean;
        missing?: { phone: boolean; restaurantName: boolean };
      }>("/auth/google/verify", { idToken });
      if (r.pending && r.pendingToken) {
        router.replace({
          pathname: "/complete-profile",
          params: {
            pendingToken: r.pendingToken,
            missingRestaurant: r.missing?.restaurantName ? "1" : "0",
          },
        } as Parameters<typeof router.replace>[0]);
        return;
      }
      if (r.accessToken && r.refreshToken && r.user) {
        await finishLogin({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
      } else {
        Alert.alert("Google sign-in failed", "Server did not return a session.");
      }
    } catch (err) {
      Alert.alert("Google sign-in failed", err instanceof Error ? err.message : "Try again");
    } finally { setLoading(false); }
  }

  async function handleSendOtp() {
    if (!otpIdentifier.trim()) {
      Alert.alert("Required", tab === "email" ? "Enter your email." : "Enter your phone number.");
      return;
    }
    setLoading(true);
    try {
      const r = await postJSON<{ ok: boolean; devCode?: string }>("/auth/request-otp", {
        channel: tab === "email" ? "email" : otpChannel,
        identifier: otpIdentifier.trim(),
      });
      setDevCode(r.devCode ?? null);
      setOtpStep("verify");
    } catch (err) {
      Alert.alert("Could not send code", err instanceof Error ? err.message : "Try again");
    } finally { setLoading(false); }
  }

  async function handleVerifyOtp() {
    if (otpCode.length !== 6) return;
    setLoading(true);
    try {
      const r = await postJSON<LoginResp>("/auth/verify-otp", {
        channel: tab === "email" ? "email" : otpChannel,
        identifier: otpIdentifier.trim(),
        code: otpCode,
      });
      if (r.requires2fa && r.userId && r.twoFactorChannel) {
        setTwoFa({ userId: r.userId, channel: r.twoFactorChannel, hint: r.identifierHint });
      } else if (r.accessToken && r.refreshToken && r.user) {
        await finishLogin({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
      }
    } catch (err) {
      Alert.alert("Invalid code", err instanceof Error ? err.message : "Try again");
    } finally { setLoading(false); }
  }

  async function handleVerify2fa() {
    if (!twoFa || twoFaCode.length !== 6) return;
    setLoading(true);
    try {
      const r = await postJSON<{ accessToken: string; refreshToken: string; user: AuthUser }>("/auth/2fa/verify", { userId: twoFa.userId, code: twoFaCode });
      await finishLogin(r);
    } catch (err) {
      Alert.alert("Invalid code", err instanceof Error ? err.message : "Try again");
    } finally { setLoading(false); }
  }

  const availableTabs: Tab[] = [];
  if (authSettings?.passwordLoginEnabled !== false) availableTabs.push("password");
  if (authSettings?.mobileOtpLoginEnabled !== false) availableTabs.push("mobile");
  if (authSettings?.emailOtpLoginEnabled !== false) availableTabs.push("email");

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: isWeb ? 67 + 32 : insets.top + 16, paddingBottom: isWeb ? 34 : insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Image
            source={require("../assets/images/brand-logo.png")}
            style={styles.logoImg}
            resizeMode="contain"
            accessibilityLabel="KhanaLagao logo"
          />
          <Text style={[styles.brandName, { color: colors.foreground }]}>KhanaLagao</Text>
          <Text style={[styles.brandSub, { color: colors.mutedForeground }]}>Restaurant Management</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {twoFa ? (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>Two-factor authentication</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                Enter the 6-digit code sent via {twoFa.channel === "email" ? "email" : twoFa.channel === "whatsapp" ? "WhatsApp" : "SMS"}
                {twoFa.hint ? ` to ${twoFa.hint}` : ""}.
              </Text>
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Code</Text>
                <View style={[styles.inputWrap, { borderColor: colors.input, backgroundColor: colors.muted }]}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    value={twoFaCode}
                    onChangeText={(v) => setTwoFaCode(v.replace(/\D/g, "").slice(0, 6))}
                    keyboardType="number-pad"
                    placeholder="123456"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={() => { setTwoFa(null); setTwoFaCode(""); }}>
                  <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.loginBtn, { backgroundColor: colors.primary, flex: 1, opacity: loading || twoFaCode.length !== 6 ? 0.6 : 1 }]}
                  onPress={handleVerify2fa}
                  disabled={loading || twoFaCode.length !== 6}
                >
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Verify</Text>}
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>Sign in</Text>

              {availableTabs.length > 1 && (
                <View style={[styles.tabs, { backgroundColor: colors.muted }]}>
                  {availableTabs.map((t) => (
                    <Pressable key={t} onPress={() => { setTab(t); setOtpStep("request"); setOtpCode(""); }}
                      style={[styles.tab, tab === t && { backgroundColor: colors.card }]}>
                      <Text style={{ color: tab === t ? colors.foreground : colors.mutedForeground, fontSize: 13, fontFamily: "Inter_500Medium" }}>
                        {t === "password" ? "Password" : t === "mobile" ? "Mobile" : "Email"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {tab === "password" && (
                <>
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.mutedForeground }]}>Email or mobile number</Text>
                    <View style={[styles.inputWrap, { borderColor: colors.input, backgroundColor: colors.muted }]}>
                      <Ionicons name="person-outline" size={18} color={colors.mutedForeground} />
                      <TextInput
                        style={[styles.input, { color: colors.foreground }]}
                        value={identifier} onChangeText={setIdentifier}
                        placeholder="you@example.com or +91 98765 43210"
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                        testID="email-input"
                      />
                    </View>
                  </View>
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
                    <View style={[styles.inputWrap, { borderColor: colors.input, backgroundColor: colors.muted }]}>
                      <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
                      <TextInput
                        style={[styles.input, { color: colors.foreground }]}
                        value={password} onChangeText={setPassword}
                        placeholder="••••••••" placeholderTextColor={colors.mutedForeground}
                        secureTextEntry={!showPassword} testID="password-input"
                      />
                      <Pressable onPress={() => setShowPassword((p) => !p)} hitSlop={10}>
                        <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={colors.mutedForeground} />
                      </Pressable>
                    </View>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.loginBtn, { backgroundColor: colors.primary, opacity: pressed || loading ? 0.8 : 1 }]}
                    onPress={handlePasswordLogin} disabled={loading} testID="login-button"
                  >
                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Sign in</Text>}
                  </Pressable>
                  {authSettings?.googleSignInEnabled && googleConfigured ? (
                    <>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>or</Text>
                        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                      </View>
                      <GoogleSignInButton
                        webClientId={authSettings?.googleClientId ?? undefined}
                        iosClientId={authSettings?.googleIosClientId ?? authSettings?.googleClientId ?? undefined}
                        androidClientId={authSettings?.googleAndroidClientId ?? authSettings?.googleClientId ?? undefined}
                        label="Continue with Google"
                        disabled={loading}
                        onIdToken={(t) => { void handleGoogleIdToken(t); }}
                        onError={(m) => Alert.alert("Google sign-in failed", m)}
                        colors={colors}
                        styles={styles}
                      />
                    </>
                  ) : null}
                </>
              )}

              {(tab === "mobile" || tab === "email") && otpStep === "request" && (
                <>
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.mutedForeground }]}>{tab === "email" ? "Email" : "Phone number"}</Text>
                    <View style={[styles.inputWrap, { borderColor: colors.input, backgroundColor: colors.muted }]}>
                      <Ionicons name={tab === "email" ? "mail-outline" : "call-outline"} size={18} color={colors.mutedForeground} />
                      <TextInput
                        style={[styles.input, { color: colors.foreground }]}
                        value={otpIdentifier} onChangeText={setOtpIdentifier}
                        placeholder={tab === "email" ? "you@example.com" : "+91 9876543210"}
                        placeholderTextColor={colors.mutedForeground}
                        keyboardType={tab === "email" ? "email-address" : "phone-pad"}
                        autoCapitalize="none" autoCorrect={false}
                      />
                    </View>
                  </View>
                  {tab === "mobile" && (
                    <View style={styles.field}>
                      <Text style={[styles.label, { color: colors.mutedForeground }]}>Send code via</Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {(["sms", "whatsapp"] as const).map((c) => (
                          <Pressable key={c} onPress={() => setOtpChannel(c)}
                            style={[styles.channelBtn, {
                              borderColor: otpChannel === c ? colors.primary : colors.border,
                              backgroundColor: otpChannel === c ? colors.primary + "10" : "transparent",
                            }]}>
                            <Text style={{ color: otpChannel === c ? colors.primary : colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                              {c === "sms" ? "SMS" : "WhatsApp"}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                  <Pressable
                    style={({ pressed }) => [styles.loginBtn, { backgroundColor: colors.primary, opacity: pressed || loading || !otpIdentifier ? 0.6 : 1 }]}
                    onPress={handleSendOtp} disabled={loading || !otpIdentifier}
                  >
                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Send code</Text>}
                  </Pressable>
                </>
              )}

              {(tab === "mobile" || tab === "email") && otpStep === "verify" && (
                <>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                    Code sent to <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{otpIdentifier}</Text>.{" "}
                    <Text style={{ color: colors.primary }} onPress={() => { setOtpStep("request"); setOtpCode(""); }}>Change</Text>
                  </Text>
                  {devCode ? (
                    <Text style={{ color: "#92400e", backgroundColor: "#fef3c7", padding: 6, borderRadius: 6, fontSize: 12 }}>
                      Dev code: {devCode}
                    </Text>
                  ) : null}
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.mutedForeground }]}>Code</Text>
                    <View style={[styles.inputWrap, { borderColor: colors.input, backgroundColor: colors.muted }]}>
                      <Ionicons name="key-outline" size={18} color={colors.mutedForeground} />
                      <TextInput
                        style={[styles.input, { color: colors.foreground }]}
                        value={otpCode}
                        onChangeText={(v) => setOtpCode(v.replace(/\D/g, "").slice(0, 6))}
                        keyboardType="number-pad" placeholder="123456"
                        placeholderTextColor={colors.mutedForeground}
                      />
                    </View>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.loginBtn, { backgroundColor: colors.primary, opacity: pressed || loading || otpCode.length !== 6 ? 0.6 : 1 }]}
                    onPress={handleVerifyOtp} disabled={loading || otpCode.length !== 6}
                  >
                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Verify & sign in</Text>}
                  </Pressable>
                </>
              )}
            </>
          )}

          {/* Signup entry point — mobile doesn't have a dedicated signup screen,
              so we offer Google as the in-app signup path here. Same handler as
              login: the backend's /auth/google/verify creates the account on
              first sign-in. Restaurant-name / phone collection happens on the
              /complete-profile screen if Super Admin requires it. */}
          {!twoFa && authSettings?.googleSignInEnabled && googleConfigured ? (
            <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center" }}>
                New to {"KhanaLagao"}?
              </Text>
              <GoogleSignInButton
                webClientId={authSettings?.googleClientId ?? undefined}
                iosClientId={authSettings?.googleIosClientId ?? authSettings?.googleClientId ?? undefined}
                androidClientId={authSettings?.googleAndroidClientId ?? authSettings?.googleClientId ?? undefined}
                label="Sign up with Google"
                disabled={loading}
                onIdToken={(t) => { void handleGoogleIdToken(t); }}
                onError={(m) => Alert.alert("Google sign-in failed", m)}
                colors={colors}
                styles={styles}
                testID="signup-google-button"
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 20, justifyContent: "center", gap: 32 },
  brand: { alignItems: "center", gap: 8 },
  logoImg: { width: 96, height: 96 },
  brandName: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  brandSub: { fontSize: 14, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 16 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  tabs: { flexDirection: "row", padding: 4, borderRadius: 10, gap: 4 },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputWrap: {
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  loginBtn: { borderRadius: 10, paddingVertical: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  loginBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  secondaryBtnText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  channelBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: "center" },
});
