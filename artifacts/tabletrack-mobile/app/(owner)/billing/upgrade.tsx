import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator, Alert, Platform, Linking, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { RoleGate } from "@/components/RoleGate";
import { BRAND } from "@/constants/brand";

type MobileConfig = {
  webBillingPortalUrl: string;
  gatewayCheckoutEnabledAndroid: boolean;
  iosUpgradeOptions: string[];
  androidUpgradeOptions: string[];
};

type AppSettings = {
  supportEmail?: string | null;
  supportPhone?: string | null;
  supportWhatsapp?: string | null;
  appName?: string;
};

function UpgradeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ targetPlanId?: string; billingPeriod?: string }>();
  const targetPlanId = params.targetPlanId ? Number(params.targetPlanId) : undefined;
  const billingPeriod = (params.billingPeriod === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";

  const [note, setNote] = useState("");

  const { data: cfg, isLoading: cfgLoading } = useQuery({
    queryKey: ["billing-mobile-config", restaurantId],
    queryFn: () => customFetch<MobileConfig>(`/api/restaurants/${restaurantId}/billing/mobile-config`),
    staleTime: 5 * 60_000,
  });

  const { data: appSettings } = useQuery({
    queryKey: ["public-app-settings"],
    queryFn: () => customFetch<AppSettings>(`/api/public/app-settings`).catch(() => ({} as AppSettings)),
    staleTime: 10 * 60_000,
  });

  const submit = useMutation({
    mutationFn: (contactMethod: "email" | "phone" | "whatsapp" | null) =>
      customFetch(`/api/restaurants/${restaurantId}/billing/upgrade-request`, {
        method: "POST",
        body: JSON.stringify({ targetPlanId, billingPeriod, note: note.trim() || undefined, contactMethod }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing-mobile-summary", restaurantId] });
      Alert.alert("Request received", "Our team will reach out shortly.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => {
      Alert.alert("Could not submit", e.message || "Please try again later.");
    },
  });

  const allowed = new Set(
    Platform.OS === "android" ? cfg?.androidUpgradeOptions ?? [] : cfg?.iosUpgradeOptions ?? [],
  );
  // Web preview falls back to all non-paywall options.
  const isWeb = Platform.OS === "web";
  const showPayNow = !isWeb && Platform.OS === "android" && allowed.has("pay_now") && cfg?.gatewayCheckoutEnabledAndroid;
  const showWeb = isWeb || allowed.has("continue_on_web");
  const showContact = isWeb || allowed.has("contact_sales");
  const showRequest = isWeb || allowed.has("request_upgrade");

  const openWeb = () => {
    const url = cfg?.webBillingPortalUrl;
    if (!url) return;
    void Linking.openURL(url);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Upgrade" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: Platform.OS === "web" ? 120 : insets.bottom + (Platform.OS === "android" ? 140 : 110) }}>
        {cfgLoading ? (
          <View style={{ paddingTop: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.h2, { color: colors.foreground }]}>How would you like to upgrade?</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 6 }}>
                {Platform.OS === "ios"
                  ? "App Store rules mean subscription checkout happens on the web or with our team."
                  : "Pick the option that works best for you."}
              </Text>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Note (optional)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Anything our team should know?"
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>

            {showPayNow ? (
              <ActionRow
                colors={colors}
                icon="card-outline"
                iconBg={BRAND.success}
                title="Pay now"
                subtitle="Checkout in-app via Razorpay / Cashfree"
                onPress={() => Alert.alert("Pay now", "In-app checkout opens in the next screen on Android. Coming via your payment gateway shortly.")}
              />
            ) : null}

            {showContact && appSettings?.supportWhatsapp ? (
              <ActionRow
                colors={colors}
                icon="logo-whatsapp"
                iconBg="#25D366"
                title="Chat on WhatsApp"
                subtitle={appSettings.supportWhatsapp}
                onPress={() => {
                  const num = (appSettings.supportWhatsapp ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "");
                  const text = encodeURIComponent(
                    `Hi, I'd like to upgrade my plan${targetPlanId ? ` (plan #${targetPlanId}, ${billingPeriod})` : ""}.${note.trim() ? `\n\nNote: ${note.trim()}` : ""}`,
                  );
                  void Linking.openURL(`https://wa.me/${num}?text=${text}`);
                  submit.mutate("whatsapp");
                }}
                disabled={submit.isPending}
              />
            ) : null}

            {showContact ? (
              <ActionRow
                colors={colors}
                icon="call-outline"
                iconBg={BRAND.info}
                title="Contact sales"
                subtitle={appSettings?.supportPhone ?? appSettings?.supportEmail ?? "Talk to our team"}
                onPress={() => {
                  if (appSettings?.supportPhone) {
                    void Linking.openURL(`tel:${appSettings.supportPhone.replace(/\s+/g, "")}`);
                    submit.mutate("phone");
                  } else if (appSettings?.supportEmail) {
                    void Linking.openURL(`mailto:${appSettings.supportEmail}?subject=Upgrade%20request`);
                    submit.mutate("email");
                  } else {
                    submit.mutate(null);
                  }
                }}
                disabled={submit.isPending}
              />
            ) : null}

            {showRequest ? (
              <ActionRow
                colors={colors}
                icon="paper-plane-outline"
                iconBg={BRAND.primary}
                title="Request upgrade"
                subtitle="Our team will reach out to set things up"
                onPress={() => submit.mutate(null)}
                disabled={submit.isPending}
                loading={submit.isPending}
              />
            ) : null}

            {showWeb ? (
              <ActionRow
                colors={colors}
                icon="open-outline"
                iconBg={colors.foreground}
                title="Continue on web"
                subtitle="Manage plans, payment methods and invoices"
                onPress={openWeb}
              />
            ) : null}

            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6, textAlign: "center" }}>
              {Platform.OS === "ios"
                ? "Subscription purchases are not available inside the iOS app."
                : "Your plan changes once payment is confirmed."}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ActionRow({
  colors, icon, iconBg, title, subtitle, onPress, disabled, loading,
}: {
  colors: ReturnType<typeof useColors>;
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed || disabled ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>{title}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text>
      </View>
      {loading ? <ActivityIndicator color={colors.mutedForeground} /> : <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />}
    </Pressable>
  );
}

export default function Upgrade() {
  return (
    <RoleGate module="billing">
      <UpgradeScreen />
    </RoleGate>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 16 },
  h2: { fontSize: 16, fontFamily: "Inter_700Bold" },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4, marginLeft: 4 },
  input: { minHeight: 80, borderRadius: 12, borderWidth: 1, padding: 12, fontFamily: "Inter_400Regular", fontSize: 14, textAlignVertical: "top" },
  action: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  actionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
