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
import { TimePickerField } from "@/components/TimePickerField";

/**
 * Business Hours — mobile parity with the web Settings → Open / Close
 * (`/settings/open-close`). Per-day hours, holiday calendar, and a
 * "Close now" emergency override. Owners/managers can edit; super_admin
 * too. Other roles see read-only.
 */

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type DayHours = {
  open: boolean;
  from: string; // HH:MM
  to: string; // HH:MM
};

type Holiday = {
  date: string; // YYYY-MM-DD
  label?: string;
  closed: boolean;
  from?: string;
  to?: string;
};

type Override = {
  closeNow: boolean;
  reason?: string;
  reopenAt?: string;
};

type HoursData = {
  hours?: Partial<Record<DayKey, DayHours>>;
  holidays?: Holiday[];
  override?: Override;
};

const DAYS: { key: DayKey; label: string; long: string }[] = [
  { key: "mon", label: "Mon", long: "Monday" },
  { key: "tue", label: "Tue", long: "Tuesday" },
  { key: "wed", label: "Wed", long: "Wednesday" },
  { key: "thu", label: "Thu", long: "Thursday" },
  { key: "fri", label: "Fri", long: "Friday" },
  { key: "sat", label: "Sat", long: "Saturday" },
  { key: "sun", label: "Sun", long: "Sunday" },
];

const DEFAULT_DAY: DayHours = { open: true, from: "09:00", to: "22:00" };

function defaultHours(): Record<DayKey, DayHours> {
  return {
    mon: { ...DEFAULT_DAY },
    tue: { ...DEFAULT_DAY },
    wed: { ...DEFAULT_DAY },
    thu: { ...DEFAULT_DAY },
    fri: { ...DEFAULT_DAY },
    sat: { ...DEFAULT_DAY },
    sun: { open: false, from: "09:00", to: "22:00" },
  };
}

function isValidYMD(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export default function BusinessHoursScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user, restaurantId } = useAuth();
  const qc = useQueryClient();
  const canEdit =
    user?.role === "owner" || user?.role === "manager" || user?.role === "super_admin";

  const settingsQ = useQuery({
    queryKey: ["settings", "open-close", restaurantId],
    queryFn: () =>
      customFetch<{ section: string; data: HoursData; updatedAt: string | null }>(
        `/api/restaurants/${restaurantId}/settings/open-close`,
      ),
    enabled: restaurantId != null,
  });

  const [hours, setHours] = useState<Record<DayKey, DayHours>>(defaultHours());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [override, setOverride] = useState<Override>({ closeNow: false });

  // Hydrate from server.
  useEffect(() => {
    if (!settingsQ.data) return;
    const d = settingsQ.data.data ?? {};
    const merged = defaultHours();
    if (d.hours) {
      for (const k of Object.keys(merged) as DayKey[]) {
        const h = d.hours[k];
        if (h) merged[k] = { open: !!h.open, from: h.from || "09:00", to: h.to || "22:00" };
      }
    }
    setHours(merged);
    setHolidays(Array.isArray(d.holidays) ? d.holidays : []);
    setOverride(d.override ?? { closeNow: false });
  }, [settingsQ.data]);

  const saveMut = useMutation({
    mutationFn: (payload: HoursData) =>
      customFetch(`/api/restaurants/${restaurantId}/settings/open-close`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "open-close", restaurantId] });
      Alert.alert("Saved", "Business hours updated.");
    },
    onError: (err: unknown) => {
      Alert.alert("Save failed", err instanceof Error ? err.message : "Try again.");
    },
  });

  const submit = () => {
    // Validate per-day hours.
    for (const d of DAYS) {
      const h = hours[d.key];
      if (h.open && h.from === h.to) {
        Alert.alert(d.long, "Opening and closing time can't be the same.");
        return;
      }
    }
    for (const h of holidays) {
      if (!isValidYMD(h.date)) {
        Alert.alert("Holiday date", "Use YYYY-MM-DD format.");
        return;
      }
    }
    saveMut.mutate({ hours, holidays, override });
  };

  const setDay = (key: DayKey, patch: Partial<DayHours>) =>
    setHours((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const addHoliday = () => {
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    setHolidays((prev) => [...prev, { date: ymd, label: "", closed: true }]);
  };

  const todayKey: DayKey = useMemo(() => {
    const idx = new Date().getDay(); // 0=sun..6=sat
    const map: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return map[idx];
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "Business Hours", headerShown: false }} />
      <View style={[styles.appBar, { paddingTop: (isWeb ? 0 : insets.top) + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.appBarTitle, { color: colors.foreground }]}>Business Hours</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primary + "1A" }]}>
            <Ionicons name="time-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>When are you open?</Text>
            <Text style={[styles.heroDesc, { color: colors.mutedForeground }]}>
              Set per-day hours, schedule holidays and use "Close now" for an emergency closure.
              Shown on your customer site, QR menu and printed bills.
            </Text>
          </View>
        </View>

        {settingsQ.isLoading ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            {/* Close-now override */}
            <View style={[styles.card, { backgroundColor: override.closeNow ? colors.destructive + "10" : colors.card, borderColor: override.closeNow ? colors.destructive : colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="warning-outline" size={20} color={override.closeNow ? colors.destructive : colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Close now (emergency)</Text>
                  <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>Immediately block new orders, regardless of regular hours.</Text>
                </View>
                <AppSwitch value={override.closeNow} onValueChange={(v) => setOverride((o) => ({ ...o, closeNow: v }))} disabled={!canEdit} />
              </View>
              {override.closeNow && (
                <View style={{ marginTop: 12, gap: 8 }}>
                  <TextField
                    colors={colors}
                    label="Reason (shown to customers)"
                    value={override.reason ?? ""}
                    onChange={(v) => setOverride((o) => ({ ...o, reason: v }))}
                    placeholder="Power outage, family emergency…"
                    editable={canEdit}
                  />
                  <TextField
                    colors={colors}
                    label="Auto-reopen at (optional)"
                    value={override.reopenAt ?? ""}
                    onChange={(v) => setOverride((o) => ({ ...o, reopenAt: v }))}
                    placeholder="2026-05-29 18:00"
                    editable={canEdit}
                  />
                </View>
              )}
            </View>

            {/* Per-day hours */}
            <Text style={[styles.section, { color: colors.mutedForeground }]}>Weekly hours</Text>
            <View style={{ gap: 10 }}>
              {DAYS.map((d) => {
                const h = hours[d.key];
                const isToday = d.key === todayKey;
                return (
                  <View
                    key={d.key}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.card,
                        borderColor: isToday ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{d.long}</Text>
                          {isToday && (
                            <View style={[styles.todayPill, { backgroundColor: colors.primary + "1A" }]}>
                              <Text style={{ color: colors.primary, fontSize: 10, fontFamily: "Inter_700Bold" }}>TODAY</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
                          {h.open ? "Open this day" : "Closed all day"}
                        </Text>
                      </View>
                      <AppSwitch value={h.open} onValueChange={(v) => setDay(d.key, { open: v })} disabled={!canEdit} />
                    </View>
                    {h.open && (
                      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                        <TimePickerField
                          label="Opens"
                          icon="sunny-outline"
                          value={h.from}
                          onChange={(v) => setDay(d.key, { from: v })}
                          editable={canEdit}
                        />
                        <TimePickerField
                          label="Closes"
                          icon="moon-outline"
                          value={h.to}
                          onChange={(v) => setDay(d.key, { to: v })}
                          editable={canEdit}
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {/* Holidays */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <Text style={[styles.section, { color: colors.mutedForeground }]}>Holidays</Text>
              {canEdit && (
                <Pressable onPress={addHoliday} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="add-circle" size={18} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Add holiday</Text>
                </Pressable>
              )}
            </View>

            {holidays.length === 0 ? (
              <View style={[styles.emptyMini, { borderColor: colors.border }]}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium" }}>
                  No holidays scheduled. Add one to close the restaurant on specific dates.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {holidays.map((h, idx) => (
                  <View key={idx} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <TextField
                          colors={colors}
                          label="Date (YYYY-MM-DD)"
                          value={h.date}
                          onChange={(v) => setHolidays((arr) => arr.map((x, i) => (i === idx ? { ...x, date: v } : x)))}
                          placeholder="2026-12-25"
                          editable={canEdit}
                        />
                      </View>
                      {canEdit && (
                        <Pressable onPress={() => setHolidays((arr) => arr.filter((_, i) => i !== idx))} hitSlop={8} style={{ padding: 8 }}>
                          <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                        </Pressable>
                      )}
                    </View>
                    <View style={{ height: 8 }} />
                    <TextField
                      colors={colors}
                      label="Label (optional)"
                      value={h.label ?? ""}
                      onChange={(v) => setHolidays((arr) => arr.map((x, i) => (i === idx ? { ...x, label: v } : x)))}
                      placeholder="Diwali, Christmas…"
                      editable={canEdit}
                    />
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 }}>
                      <Text style={{ color: colors.foreground, flex: 1, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                        Fully closed
                      </Text>
                      <AppSwitch
                        value={h.closed}
                        onValueChange={(v) => setHolidays((arr) => arr.map((x, i) => (i === idx ? { ...x, closed: v } : x)))}
                        disabled={!canEdit}
                      />
                    </View>
                    {!h.closed && (
                      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                        <TimePickerField
                          label="From"
                          icon="sunny-outline"
                          value={h.from ?? "10:00"}
                          onChange={(v) => setHolidays((arr) => arr.map((x, i) => (i === idx ? { ...x, from: v } : x)))}
                          editable={canEdit}
                        />
                        <TimePickerField
                          label="To"
                          icon="moon-outline"
                          value={h.to ?? "18:00"}
                          onChange={(v) => setHolidays((arr) => arr.map((x, i) => (i === idx ? { ...x, to: v } : x)))}
                          editable={canEdit}
                        />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {!canEdit && (
              <View style={[styles.lockBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={16} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 }}>
                  Only owners and managers can change business hours.
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

function TextField({
  colors, label, value, onChange, placeholder, editable,
}: {
  colors: Colors;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  editable: boolean;
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
        autoCorrect={false}
        autoCapitalize="none"
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
  card: { padding: 14, borderRadius: 12, borderWidth: 1 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  cardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  todayPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  emptyMini: { borderRadius: 10, borderWidth: 1, borderStyle: "dashed", padding: 14, alignItems: "center" },
  lockBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
});
