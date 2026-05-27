import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { Alert } from "@/components/ui/AppAlert";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

/**
 * Business Hours — mobile parity with the web Settings → General
 * (openingTime / closingTime) on the restaurants table. Owners and
 * managers can edit; super_admin too. Other roles see read-only.
 */

type RestaurantRecord = {
  id: number;
  name: string;
  openingTime?: string | null;
  closingTime?: string | null;
};

/** Normalise "9", "9:5", "09:5", "9:30 am", "21:00:00" → "HH:MM" or null. */
function normaliseHHMM(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  // Accept "HH:MM:SS" by stripping seconds.
  const stripped = s.replace(/^(\d{1,2}:\d{2}):\d{2}$/, "$1");
  // 12h with am/pm.
  const ampm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(stripped);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2] ?? "0");
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (ampm[3] === "pm" && h !== 12) h += 12;
    if (ampm[3] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  // 24h.
  const m24 = /^(\d{1,2})(?::(\d{2}))?$/.exec(stripped);
  if (m24) {
    const h = Number(m24[1]);
    const mm = Number(m24[2] ?? "0");
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  return null;
}

function displayTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function BusinessHoursScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user, restaurantId } = useAuth();
  const qc = useQueryClient();
  // Server gate: PATCH /api/restaurants/:id requires owner or super_admin
  // (see api-server/src/routes/restaurants.ts). Mobile mirrors that exactly
  // so managers see read-only fields instead of getting a 403 on Save.
  const canEdit = user?.role === "owner" || user?.role === "super_admin";

  const restaurantQ = useQuery({
    queryKey: ["restaurant-info", restaurantId],
    queryFn: () => customFetch<RestaurantRecord>(`/api/restaurants/${restaurantId}`),
    enabled: restaurantId != null,
  });

  const [openingTime, setOpeningTime] = useState("");
  const [closingTime, setClosingTime] = useState("");

  useEffect(() => {
    if (restaurantQ.data) {
      setOpeningTime((restaurantQ.data.openingTime ?? "").slice(0, 5));
      setClosingTime((restaurantQ.data.closingTime ?? "").slice(0, 5));
    }
  }, [restaurantQ.data]);

  const saveMut = useMutation({
    mutationFn: (patch: { openingTime: string; closingTime: string }) =>
      customFetch<RestaurantRecord>(`/api/restaurants/${restaurantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["restaurant-info", restaurantId] });
      Alert.alert("Saved", "Business hours updated.");
    },
    onError: (err: unknown) => {
      Alert.alert("Save failed", err instanceof Error ? err.message : "Try again.");
    },
  });

  const submit = () => {
    Keyboard.dismiss();
    const o = normaliseHHMM(openingTime);
    const c = normaliseHHMM(closingTime);
    if (!o) {
      Alert.alert("Opening time", "Enter a valid time like 09:00 or 9am.");
      return;
    }
    if (!c) {
      Alert.alert("Closing time", "Enter a valid time like 23:00 or 11pm.");
      return;
    }
    if (o === c) {
      Alert.alert("Hours", "Opening and closing time can't be the same.");
      return;
    }
    setOpeningTime(o);
    setClosingTime(c);
    saveMut.mutate({ openingTime: o, closingTime: c });
  };

  const previewOpen = useMemo(() => {
    const v = normaliseHHMM(openingTime);
    return v ? displayTime(v) : null;
  }, [openingTime]);
  const previewClose = useMemo(() => {
    const v = normaliseHHMM(closingTime);
    return v ? displayTime(v) : null;
  }, [closingTime]);

  const sameOpenClose = previewOpen && previewOpen === previewClose;
  const isLoading = restaurantQ.isLoading;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "Business Hours", headerShown: false }} />
      <View
        style={[
          styles.appBar,
          { paddingTop: (isWeb ? 0 : insets.top) + 8, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.appBarTitle, { color: colors.foreground }]}>Business Hours</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 120,
          gap: 16,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.heroCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View
            style={[styles.heroIcon, { backgroundColor: colors.primary + "1A" }]}
          >
            <Ionicons name="time-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>
              When are you open?
            </Text>
            <Text style={[styles.heroDesc, { color: colors.mutedForeground }]}>
              Shown on your customer site, QR menu and printed bills. Use 24-hour
              (e.g. 09:00) or 12-hour (e.g. 9am).
            </Text>
          </View>
        </View>

        {isLoading ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <Text style={[styles.section, { color: colors.mutedForeground }]}>
              Today's hours
            </Text>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <TimeField
                colors={colors}
                label="Opens"
                value={openingTime}
                onChange={setOpeningTime}
                preview={previewOpen}
                editable={canEdit}
                icon="sunny-outline"
              />
              <TimeField
                colors={colors}
                label="Closes"
                value={closingTime}
                onChange={setClosingTime}
                preview={previewClose}
                editable={canEdit}
                icon="moon-outline"
              />
            </View>

            {sameOpenClose && (
              <View
                style={[
                  styles.warnBox,
                  { backgroundColor: colors.destructive + "1A", borderColor: colors.destructive },
                ]}
              >
                <Ionicons name="warning-outline" size={16} color={colors.destructive} />
                <Text style={{ color: colors.destructive, fontSize: 12, flex: 1, fontFamily: "Inter_500Medium" }}>
                  Opening and closing time can't be identical.
                </Text>
              </View>
            )}

            {previewOpen && previewClose && !sameOpenClose && (
              <View
                style={[
                  styles.previewBox,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Ionicons name="storefront-outline" size={18} color={colors.primary} />
                <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>
                  Open {previewOpen} – {previewClose}
                </Text>
              </View>
            )}

            {!canEdit && (
              <View
                style={[
                  styles.previewBox,
                  { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Ionicons name="lock-closed-outline" size={16} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium" }}>
                  Only the owner can change business hours.
                </Text>
              </View>
            )}

            {canEdit && (
              <Pressable
                onPress={submit}
                disabled={saveMut.isPending}
                style={({ pressed }) => [
                  styles.saveBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed || saveMut.isPending ? 0.7 : 1,
                  },
                ]}
              >
                {saveMut.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={styles.saveText}>Save changes</Text>
                  </>
                )}
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

type Colors = ReturnType<typeof useColors>;

function TimeField({
  colors,
  label,
  value,
  onChange,
  preview,
  editable,
  icon,
}: {
  colors: Colors;
  label: string;
  value: string;
  onChange: (v: string) => void;
  preview: string | null;
  editable: boolean;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View
      style={[
        styles.timeField,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={icon} size={14} color={colors.mutedForeground} />
        <Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>{label}</Text>
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        editable={editable}
        placeholder="09:00"
        placeholderTextColor={colors.mutedForeground}
        keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          color: colors.foreground,
          fontSize: 22,
          fontFamily: "Inter_700Bold",
          paddingVertical: 4,
          marginTop: 6,
        }}
      />
      <Text
        style={{
          color: preview ? colors.primary : colors.mutedForeground,
          fontSize: 11,
          fontFamily: "Inter_500Medium",
          marginTop: 2,
        }}
      >
        {preview ?? "—"}
      </Text>
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
  heroCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  heroIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  heroDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  section: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 2 },
  timeField: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1 },
  timeLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  warnBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  previewBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  saveText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
