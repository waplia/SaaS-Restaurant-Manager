import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Alert } from "@/components/ui/AppAlert";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { AppSwitch } from "@/components/ui/AppSwitch";
import { AppButton } from "@/components/ui/AppButton";

/**
 * Direct Ordering — mobile parity with web Settings → Direct Ordering
 * (`/restaurants/:id/settings/direct-ordering`). Master toggle, pickup/
 * delivery/scheduling switches, pricing thresholds, holiday closures
 * and SEO metadata for the public ordering page.
 */

type DirectData = {
  orderingEnabled?: boolean;
  allowPickup?: boolean;
  allowDelivery?: boolean;
  allowScheduling?: boolean;
  minOrderValue?: number;
  deliveryFee?: number;
  freeDeliveryThreshold?: number;
  deliveryRadiusKm?: number;
  schemaEnabled?: boolean;
  seoTitle?: string;
  seoDescription?: string;
  ogImageUrl?: string;
  cuisine?: string;
  priceRange?: string;
  customOrderingLink?: string;
  holidayClosures?: string[];
};

const DEFAULTS: Required<DirectData> = {
  orderingEnabled: true,
  allowPickup: true,
  allowDelivery: false,
  allowScheduling: true,
  minOrderValue: 0,
  deliveryFee: 0,
  freeDeliveryThreshold: 0,
  deliveryRadiusKm: 5,
  schemaEnabled: true,
  seoTitle: "",
  seoDescription: "",
  ogImageUrl: "",
  cuisine: "",
  priceRange: "$$",
  customOrderingLink: "",
  holidayClosures: [],
};

function isValidYMD(s: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

export default function DirectOrderingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user, restaurantId } = useAuth();
  const qc = useQueryClient();
  const canEdit =
    user?.role === "owner" || user?.role === "manager" || user?.role === "super_admin";

  const settingsQ = useQuery({
    queryKey: ["settings", "direct-ordering", restaurantId],
    queryFn: () =>
      customFetch<{ section: string; data: DirectData; updatedAt: string | null }>(
        `/api/restaurants/${restaurantId}/settings/direct-ordering`,
      ),
    enabled: restaurantId != null,
  });

  const [data, setData] = useState<Required<DirectData>>(DEFAULTS);

  useEffect(() => {
    if (!settingsQ.data) return;
    const d = settingsQ.data.data ?? {};
    setData({
      orderingEnabled: d.orderingEnabled ?? DEFAULTS.orderingEnabled,
      allowPickup: d.allowPickup ?? DEFAULTS.allowPickup,
      allowDelivery: d.allowDelivery ?? DEFAULTS.allowDelivery,
      allowScheduling: d.allowScheduling ?? DEFAULTS.allowScheduling,
      minOrderValue: Number(d.minOrderValue ?? 0),
      deliveryFee: Number(d.deliveryFee ?? 0),
      freeDeliveryThreshold: Number(d.freeDeliveryThreshold ?? 0),
      deliveryRadiusKm: Number(d.deliveryRadiusKm ?? 5),
      schemaEnabled: d.schemaEnabled ?? DEFAULTS.schemaEnabled,
      seoTitle: String(d.seoTitle ?? ""),
      seoDescription: String(d.seoDescription ?? ""),
      ogImageUrl: String(d.ogImageUrl ?? ""),
      cuisine: String(d.cuisine ?? ""),
      priceRange: String(d.priceRange ?? "$$"),
      customOrderingLink: String(d.customOrderingLink ?? ""),
      holidayClosures: Array.isArray(d.holidayClosures) ? d.holidayClosures : [],
    });
  }, [settingsQ.data]);

  const saveMut = useMutation({
    mutationFn: (payload: DirectData) =>
      customFetch(`/api/restaurants/${restaurantId}/settings/direct-ordering`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "direct-ordering", restaurantId] });
      Alert.alert("Saved", "Direct ordering updated.");
    },
    onError: (err: unknown) => {
      Alert.alert("Save failed", err instanceof Error ? err.message : "Try again.");
    },
  });

  const patch = (p: Partial<Required<DirectData>>) => setData((d) => ({ ...d, ...p }));

  const submit = () => {
    for (const date of data.holidayClosures) {
      if (!isValidYMD(date)) {
        Alert.alert("Holiday date", `"${date}" is not valid. Use YYYY-MM-DD.`);
        return;
      }
    }
    if (data.minOrderValue < 0 || data.deliveryFee < 0 || data.freeDeliveryThreshold < 0 || data.deliveryRadiusKm < 0) {
      Alert.alert("Pricing", "Values cannot be negative.");
      return;
    }
    saveMut.mutate(data);
  };

  const addHoliday = () => {
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    setData((d) => ({ ...d, holidayClosures: [...d.holidayClosures, ymd] }));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "Direct Ordering", headerShown: false }} />
      <View style={[styles.appBar, { paddingTop: (isWeb ? 0 : insets.top) + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.appBarTitle, { color: colors.foreground }]}>Direct Ordering</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primary + "1A" }]}>
            <Ionicons name="globe-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>Public ordering page</Text>
            <Text style={[styles.heroDesc, { color: colors.mutedForeground }]}>
              Configure your own restaurant&apos;s direct ordering — pickup, delivery,
              minimum order value, and SEO for Google &amp; social shares.
            </Text>
          </View>
        </View>

        {settingsQ.isLoading ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            {/* Master toggle */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ToggleRow
                colors={colors}
                title="Direct ordering enabled"
                desc="Master switch for the public ordering page."
                value={data.orderingEnabled}
                onChange={(v) => patch({ orderingEnabled: v })}
                disabled={!canEdit}
              />
            </View>

            <Text style={[styles.section, { color: colors.mutedForeground }]}>Order types</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 14 }]}>
              <ToggleRow
                colors={colors}
                title="Allow pickup"
                desc="Customers can collect orders from your store."
                value={data.allowPickup}
                onChange={(v) => patch({ allowPickup: v })}
                disabled={!canEdit || !data.orderingEnabled}
              />
              <View style={[styles.hr, { backgroundColor: colors.border }]} />
              <ToggleRow
                colors={colors}
                title="Allow delivery"
                desc="Send orders out for delivery within your radius."
                value={data.allowDelivery}
                onChange={(v) => patch({ allowDelivery: v })}
                disabled={!canEdit || !data.orderingEnabled}
              />
              <View style={[styles.hr, { backgroundColor: colors.border }]} />
              <ToggleRow
                colors={colors}
                title="Allow scheduling"
                desc="Let customers pre-order for a later time."
                value={data.allowScheduling}
                onChange={(v) => patch({ allowScheduling: v })}
                disabled={!canEdit || !data.orderingEnabled}
              />
            </View>

            <Text style={[styles.section, { color: colors.mutedForeground }]}>Pricing & limits</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <NumericField colors={colors} label="Min order value" value={data.minOrderValue} onChange={(v) => patch({ minOrderValue: v })} editable={canEdit} />
                </View>
                <View style={{ flex: 1 }}>
                  <NumericField colors={colors} label="Delivery radius (km)" value={data.deliveryRadiusKm} onChange={(v) => patch({ deliveryRadiusKm: v })} editable={canEdit} />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <NumericField colors={colors} label="Flat delivery fee" value={data.deliveryFee} onChange={(v) => patch({ deliveryFee: v })} editable={canEdit && data.allowDelivery} />
                </View>
                <View style={{ flex: 1 }}>
                  <NumericField colors={colors} label="Free delivery above" value={data.freeDeliveryThreshold} onChange={(v) => patch({ freeDeliveryThreshold: v })} editable={canEdit && data.allowDelivery} />
                </View>
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_400Regular" }}>
                Set "Free delivery above" to 0 if you never waive the delivery fee.
              </Text>
            </View>

            {/* Holiday closures */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <Text style={[styles.section, { color: colors.mutedForeground }]}>Holiday closures</Text>
              {canEdit && (
                <Pressable onPress={addHoliday} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="add-circle" size={18} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Add date</Text>
                </Pressable>
              )}
            </View>
            {data.holidayClosures.length === 0 ? (
              <View style={[styles.emptyMini, { borderColor: colors.border }]}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium" }}>
                  No closure dates. Ordering follows your regular hours.
                </Text>
              </View>
            ) : (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 8 }]}>
                {data.holidayClosures.map((date, idx) => (
                  <View key={idx} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <TextInput
                      value={date}
                      editable={canEdit}
                      onChangeText={(v) => patch({ holidayClosures: data.holidayClosures.map((d, i) => (i === idx ? v : d)) })}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{
                        flex: 1,
                        color: colors.foreground,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: colors.border,
                        backgroundColor: colors.background,
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        fontSize: 14,
                        fontFamily: "Inter_500Medium",
                      }}
                    />
                    {canEdit && (
                      <Pressable onPress={() => patch({ holidayClosures: data.holidayClosures.filter((_, i) => i !== idx) })} hitSlop={8} style={{ padding: 6 }}>
                        <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* SEO + Branding */}
            <Text style={[styles.section, { color: colors.mutedForeground }]}>SEO & social</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
              <TextField colors={colors} label="Page title" value={data.seoTitle} onChange={(v) => patch({ seoTitle: v })} placeholder="Spice Garden — Order Online" editable={canEdit} />
              <TextField colors={colors} label="Description" value={data.seoDescription} onChange={(v) => patch({ seoDescription: v })} placeholder="Authentic North-Indian cuisine, delivered hot." multiline editable={canEdit} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <TextField colors={colors} label="Cuisine" value={data.cuisine} onChange={(v) => patch({ cuisine: v })} placeholder="Indian, Chinese" editable={canEdit} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Price range</Text>
                  <View style={{ flexDirection: "row", gap: 4, marginTop: 4 }}>
                    {(["$", "$$", "$$$", "$$$$"]).map((p) => {
                      const active = data.priceRange === p;
                      return (
                        <Pressable
                          key={p}
                          onPress={() => canEdit && patch({ priceRange: p })}
                          style={[
                            styles.priceSeg,
                            {
                              backgroundColor: active ? colors.primary : colors.background,
                              borderColor: active ? colors.primary : colors.border,
                            },
                          ]}
                        >
                          <Text style={{ color: active ? "#fff" : colors.foreground, fontFamily: "Inter_700Bold", fontSize: 13 }}>{p}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>
              <TextField colors={colors} label="Social share image URL" value={data.ogImageUrl} onChange={(v) => patch({ ogImageUrl: v })} placeholder="https://…/og-image.jpg" editable={canEdit} />
              <TextField colors={colors} label="Custom ordering link (optional)" value={data.customOrderingLink} onChange={(v) => patch({ customOrderingLink: v })} placeholder="https://order.yoursite.com" editable={canEdit} />
              <ToggleRow
                colors={colors}
                title="Inject schema.org JSON-LD"
                desc="Helps search engines display rich results for your ordering page."
                value={data.schemaEnabled}
                onChange={(v) => patch({ schemaEnabled: v })}
                disabled={!canEdit}
              />
            </View>

            {!canEdit && (
              <View style={[styles.lockBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={16} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 }}>
                  Only owners and managers can change direct-ordering settings.
                </Text>
              </View>
            )}

            {canEdit && (
              <AppButton
                label="Save changes"
                leftIcon="checkmark-circle-outline"
                loading={saveMut.isPending}
                onPress={submit}
                fullWidth
              />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

type Colors = ReturnType<typeof useColors>;

function ToggleRow({
  colors, title, desc, value, onChange, disabled,
}: {
  colors: Colors;
  title: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>{desc}</Text>
      </View>
      <AppSwitch value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

function NumericField({
  colors, label, value, onChange, editable,
}: {
  colors: Colors;
  label: string;
  value: number;
  onChange: (v: number) => void;
  editable: boolean;
}) {
  const [text, setText] = useState(String(value));
  // Only resync from the prop when the prop's numeric value diverges from
  // what's currently shown — otherwise typing "5." would be clobbered back
  // to "5" because the parent's number is 5 and would re-render this field.
  useEffect(() => {
    const current = Number(text);
    if (!Number.isFinite(current) || current !== value) {
      setText(String(value));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={text}
        editable={editable}
        onChangeText={(v) => {
          const cleaned = v.replace(/[^0-9.]/g, "");
          setText(cleaned);
          const n = Number(cleaned);
          if (Number.isFinite(n)) onChange(n);
        }}
        placeholder="0"
        placeholderTextColor={colors.mutedForeground}
        keyboardType="decimal-pad"
        style={{
          color: colors.foreground,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: colors.background,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          marginTop: 4,
          fontSize: 14,
          fontFamily: "Inter_600SemiBold",
          opacity: editable ? 1 : 0.55,
        }}
      />
    </View>
  );
}

function TextField({
  colors, label, value, onChange, placeholder, editable, multiline,
}: {
  colors: Colors;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  editable: boolean;
  multiline?: boolean;
}) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        editable={editable}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        style={{
          color: colors.foreground,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: colors.background,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          marginTop: 4,
          fontSize: 14,
          fontFamily: "Inter_500Medium",
          minHeight: multiline ? 72 : undefined,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  appBarTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold" },
  heroCard: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, alignItems: "flex-start" },
  heroIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  heroDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  section: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 2 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  cardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  priceSeg: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 6, borderWidth: 1 },
  emptyMini: { borderRadius: 10, borderWidth: 1, borderStyle: "dashed", padding: 14, alignItems: "center" },
  lockBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
});
