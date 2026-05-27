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
 * Tax & GST — mobile parity with web Settings → Taxes
 * (`/restaurants/:id/settings/taxes`). Manage a list of tax rates
 * (GST, VAT, service tax), choose inclusive/exclusive, restrict to
 * order modes, and configure compound + exemption rules.
 */

type TaxType = "inclusive" | "exclusive";
type AppliesTo = "dine-in" | "takeaway" | "delivery";

type TaxRate = {
  id: string;
  name: string;
  rate: number;
  type: TaxType;
  appliesTo: AppliesTo[];
  isDefault: boolean;
};

type TaxesData = {
  rates?: TaxRate[];
  compoundTax?: boolean;
  exemptionRules?: string;
};

const APPLIES_OPTIONS: { key: AppliesTo; label: string }[] = [
  { key: "dine-in", label: "Dine-in" },
  { key: "takeaway", label: "Takeaway" },
  { key: "delivery", label: "Delivery" },
];

function uid(): string {
  return `tax_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function TaxGstScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user, restaurantId } = useAuth();
  const qc = useQueryClient();
  const canEdit =
    user?.role === "owner" || user?.role === "manager" || user?.role === "super_admin";

  const settingsQ = useQuery({
    queryKey: ["settings", "taxes", restaurantId],
    queryFn: () =>
      customFetch<{ section: string; data: TaxesData; updatedAt: string | null }>(
        `/api/restaurants/${restaurantId}/settings/taxes`,
      ),
    enabled: restaurantId != null,
  });

  const [rates, setRates] = useState<TaxRate[]>([]);
  const [compoundTax, setCompoundTax] = useState(false);
  const [exemptionRules, setExemptionRules] = useState("");

  useEffect(() => {
    if (!settingsQ.data) return;
    const d = settingsQ.data.data ?? {};
    const hydrated = Array.isArray(d.rates)
      ? d.rates.map((r) => ({
          id: String(r.id ?? uid()),
          name: String(r.name ?? ""),
          rate: Number(r.rate ?? 0),
          type: (r.type === "inclusive" ? "inclusive" : "exclusive") as TaxType,
          appliesTo: (Array.isArray(r.appliesTo)
            ? (r.appliesTo as string[]).filter((x): x is AppliesTo => x === "dine-in" || x === "takeaway" || x === "delivery")
            : ["dine-in", "takeaway", "delivery"]) as AppliesTo[],
          isDefault: !!r.isDefault,
        }))
      : [];
    setRates(hydrated);
    setCompoundTax(!!d.compoundTax);
    setExemptionRules(String(d.exemptionRules ?? ""));
  }, [settingsQ.data]);

  const saveMut = useMutation({
    mutationFn: (payload: TaxesData) =>
      customFetch(`/api/restaurants/${restaurantId}/settings/taxes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "taxes", restaurantId] });
      Alert.alert("Saved", "Tax settings updated.");
    },
    onError: (err: unknown) => {
      Alert.alert("Save failed", err instanceof Error ? err.message : "Try again.");
    },
  });

  const addRate = () => {
    setRates((prev) => [
      ...prev,
      {
        id: uid(),
        name: prev.length === 0 ? "GST" : "New tax",
        rate: 5,
        type: "exclusive",
        appliesTo: ["dine-in", "takeaway", "delivery"],
        isDefault: prev.length === 0,
      },
    ]);
  };

  const patchRate = (id: string, patch: Partial<TaxRate>) =>
    setRates((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, ...patch }
          : patch.isDefault
            ? { ...r, isDefault: false } // enforce single default
            : r,
      ),
    );

  const removeRate = (id: string) =>
    setRates((prev) => prev.filter((r) => r.id !== id));

  const toggleApplies = (id: string, key: AppliesTo) => {
    setRates((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const has = r.appliesTo.includes(key);
        return { ...r, appliesTo: has ? r.appliesTo.filter((x) => x !== key) : [...r.appliesTo, key] };
      }),
    );
  };

  const submit = () => {
    for (const r of rates) {
      if (!r.name.trim()) {
        Alert.alert("Tax name required", "Each tax needs a name like GST or VAT.");
        return;
      }
      if (!Number.isFinite(r.rate) || r.rate < 0 || r.rate > 100) {
        Alert.alert("Rate", `"${r.name}" must be between 0 and 100%.`);
        return;
      }
      if (r.appliesTo.length === 0) {
        Alert.alert("Applies to", `"${r.name}" must apply to at least one order type.`);
        return;
      }
    }
    saveMut.mutate({ rates, compoundTax, exemptionRules });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "Tax & GST", headerShown: false }} />
      <View style={[styles.appBar, { paddingTop: (isWeb ? 0 : insets.top) + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.appBarTitle, { color: colors.foreground }]}>Tax & GST</Text>
        {canEdit ? (
          <Pressable onPress={addRate} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="add" size={26} color={colors.primary} />
          </Pressable>
        ) : (
          <View style={{ width: 32 }} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primary + "1A" }]}>
            <Ionicons name="receipt-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>Tax rates</Text>
            <Text style={[styles.heroDesc, { color: colors.mutedForeground }]}>
              Add GST, VAT or service charge. "Exclusive" adds tax on top of the price;
              "inclusive" treats the price as already including tax.
            </Text>
          </View>
        </View>

        {settingsQ.isLoading ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            {rates.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="receipt-outline" size={32} color={colors.mutedForeground} />
                <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 8 }}>
                  No tax rates yet
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 }}>
                  Add your first tax (e.g. GST 5%). Bills will show it as a line item.
                </Text>
                {canEdit && (
                  <Pressable onPress={addRate} style={({ pressed }) => [styles.emptyBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 }]}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Add tax rate</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                {rates.map((r) => (
                  <View key={r.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                      <View style={{ flex: 1 }}>
                        <Field
                          colors={colors}
                          label="Tax name"
                          value={r.name}
                          onChange={(v) => patchRate(r.id, { name: v })}
                          placeholder="GST, VAT, Service tax"
                          editable={canEdit}
                        />
                      </View>
                      {canEdit && (
                        <Pressable onPress={() => removeRate(r.id)} hitSlop={8} style={{ padding: 8 }}>
                          <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                        </Pressable>
                      )}
                    </View>

                    <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Field
                          colors={colors}
                          label="Rate (%)"
                          value={String(r.rate)}
                          onChange={(v) => patchRate(r.id, { rate: Number(v.replace(/[^0-9.]/g, "")) || 0 })}
                          placeholder="5"
                          numeric
                          editable={canEdit}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Type</Text>
                        <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                          {(["exclusive", "inclusive"] as TaxType[]).map((t) => {
                            const active = r.type === t;
                            return (
                              <Pressable
                                key={t}
                                onPress={() => canEdit && patchRate(r.id, { type: t })}
                                style={[
                                  styles.segment,
                                  {
                                    backgroundColor: active ? colors.primary : colors.background,
                                    borderColor: active ? colors.primary : colors.border,
                                  },
                                ]}
                              >
                                <Text style={{ color: active ? "#fff" : colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 12, textTransform: "capitalize" }}>
                                  {t}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    </View>

                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 12 }]}>
                      Applies to
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {APPLIES_OPTIONS.map((opt) => {
                        const active = r.appliesTo.includes(opt.key);
                        return (
                          <Pressable
                            key={opt.key}
                            onPress={() => canEdit && toggleApplies(r.id, opt.key)}
                            style={[
                              styles.chip,
                              {
                                backgroundColor: active ? colors.primary + "1A" : "transparent",
                                borderColor: active ? colors.primary : colors.border,
                              },
                            ]}
                          >
                            {active && <Ionicons name="checkmark" size={14} color={colors.primary} />}
                            <Text style={{ color: active ? colors.primary : colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                              {opt.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12, gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                          Default tax
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 }}>
                          Auto-applies to new items unless overridden.
                        </Text>
                      </View>
                      <AppSwitch
                        value={r.isDefault}
                        onValueChange={(v) => patchRate(r.id, { isDefault: v })}
                        disabled={!canEdit}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Compound tax</Text>
                  <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
                    Apply later taxes on top of earlier tax-inclusive amounts.
                  </Text>
                </View>
                <AppSwitch value={compoundTax} onValueChange={setCompoundTax} disabled={!canEdit} />
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Exemption rules</Text>
              <Text style={[styles.cardDesc, { color: colors.mutedForeground, marginBottom: 8 }]}>
                Notes for staff about tax-exempt items, categories or customers.
              </Text>
              <TextInput
                value={exemptionRules}
                onChangeText={setExemptionRules}
                editable={canEdit}
                multiline
                numberOfLines={4}
                placeholder="e.g. Children's meals are exempt from service charge. Diplomatic GST exemption with proof."
                placeholderTextColor={colors.mutedForeground}
                style={{
                  color: colors.foreground,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  minHeight: 88,
                  textAlignVertical: "top",
                  fontSize: 13,
                  fontFamily: "Inter_400Regular",
                }}
              />
            </View>

            {!canEdit && (
              <View style={[styles.lockBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={16} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 }}>
                  Only owners and managers can change tax settings.
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

function Field({
  colors, label, value, onChange, placeholder, editable, numeric,
}: {
  colors: Colors;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  editable: boolean;
  numeric?: boolean;
}) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={numeric ? "decimal-pad" : "default"}
        autoCorrect={false}
        autoCapitalize={numeric ? "none" : "sentences"}
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
  card: { padding: 14, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  cardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  segment: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 8, borderWidth: 1 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  emptyCard: { alignItems: "center", padding: 24, borderRadius: 14, borderWidth: 1, gap: 6 },
  emptyBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  lockBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
});
