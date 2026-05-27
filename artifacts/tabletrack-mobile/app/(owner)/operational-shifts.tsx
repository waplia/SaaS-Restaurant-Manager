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
import { AppBottomSheet } from "@/components/ui/AppBottomSheet";
import { AppButton } from "@/components/ui/AppButton";

/**
 * Operational Shifts — mobile parity with the web Staff Scheduling
 * → Settings (shift definitions). Lets owner/manager/super_admin
 * create, edit and deactivate shifts that drive attendance late-min
 * calculations and the schedule grid.
 */

type Shift = {
  id: number;
  name: string;
  startTime: string; // "HH:MM:SS"
  endTime: string; // "HH:MM:SS"
  days: string[] | null;
  isActive?: boolean | null;
};

type ShiftDraft = {
  id?: number;
  name: string;
  startTime: string;
  endTime: string;
  days: string[];
};

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function normaliseHHMM(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const stripped = s.replace(/^(\d{1,2}:\d{2}):\d{2}$/, "$1");
  const ampm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(stripped);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2] ?? "0");
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (ampm[3] === "pm" && h !== 12) h += 12;
    if (ampm[3] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
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
  const clean = hhmm.slice(0, 5);
  const [hStr, mStr] = clean.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function durationLabel(start: string, end: string): string {
  const s = normaliseHHMM(start);
  const e = normaliseHHMM(end);
  if (!s || !e) return "";
  const [sh, sm] = s.split(":").map(Number);
  const [eh, em] = e.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

export default function OperationalShiftsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user, restaurantId } = useAuth();
  const qc = useQueryClient();
  const canEdit =
    user?.role === "owner" || user?.role === "manager" || user?.role === "super_admin";

  const shiftsQ = useQuery({
    queryKey: ["shifts", restaurantId],
    queryFn: () => customFetch<Shift[]>(`/api/restaurants/${restaurantId}/shifts`),
    enabled: restaurantId != null,
  });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<ShiftDraft>({ name: "", startTime: "", endTime: "", days: [] });

  const openCreate = () => {
    setDraft({ name: "", startTime: "", endTime: "", days: [] });
    setSheetOpen(true);
  };
  const openEdit = (s: Shift) => {
    setDraft({
      id: s.id,
      name: s.name,
      startTime: s.startTime.slice(0, 5),
      endTime: s.endTime.slice(0, 5),
      days: Array.isArray(s.days) ? s.days : [],
    });
    setSheetOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async (d: ShiftDraft) => {
      const payload = {
        name: d.name.trim(),
        startTime: d.startTime,
        endTime: d.endTime,
        days: d.days,
      };
      if (d.id) {
        return customFetch<Shift>(`/api/restaurants/${restaurantId}/shifts/${d.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      return customFetch<Shift>(`/api/restaurants/${restaurantId}/shifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts", restaurantId] });
      setSheetOpen(false);
    },
    onError: (err: unknown) => {
      Alert.alert("Save failed", err instanceof Error ? err.message : "Try again.");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/shifts/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts", restaurantId] }),
    onError: (err: unknown) => {
      Alert.alert("Delete failed", err instanceof Error ? err.message : "Try again.");
    },
  });

  const submit = () => {
    Keyboard.dismiss();
    const name = draft.name.trim();
    if (!name) {
      Alert.alert("Name required", "Give the shift a short name like Morning or Dinner.");
      return;
    }
    const s = normaliseHHMM(draft.startTime);
    const e = normaliseHHMM(draft.endTime);
    if (!s) {
      Alert.alert("Start time", "Enter a valid time like 09:00 or 9am.");
      return;
    }
    if (!e) {
      Alert.alert("End time", "Enter a valid time like 17:00 or 5pm.");
      return;
    }
    if (s === e) {
      Alert.alert("Hours", "Start and end can't be the same.");
      return;
    }
    saveMut.mutate({ ...draft, name, startTime: s, endTime: e });
  };

  const confirmDelete = (shift: Shift) => {
    Alert.alert("Delete shift", `Remove "${shift.name}"? Existing schedules using this shift will be unaffected, but it won't appear in new assignments.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMut.mutate(shift.id) },
    ]);
  };

  const toggleDay = (key: string) =>
    setDraft(d => ({
      ...d,
      days: d.days.includes(key) ? d.days.filter(x => x !== key) : [...d.days, key],
    }));

  const shifts = useMemo(() => {
    return (shiftsQ.data ?? []).filter(s => s.isActive !== false);
  }, [shiftsQ.data]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "Operational Shifts", headerShown: false }} />
      <View
        style={[
          styles.appBar,
          { paddingTop: (isWeb ? 0 : insets.top) + 8, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.appBarTitle, { color: colors.foreground }]}>Operational Shifts</Text>
        {canEdit ? (
          <Pressable onPress={openCreate} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="add" size={26} color={colors.primary} />
          </Pressable>
        ) : (
          <View style={{ width: 32 }} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 120,
          gap: 14,
        }}
      >
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primary + "1A" }]}>
            <Ionicons name="calendar-number-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>Shift definitions</Text>
            <Text style={[styles.heroDesc, { color: colors.mutedForeground }]}>
              Reusable shifts (Morning, Evening…) that you assign on the schedule.
              Used to compute scheduled hours, lateness and over-time.
            </Text>
          </View>
        </View>

        {shiftsQ.isLoading ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : shifts.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="time-outline" size={32} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: "Inter_600SemiBold", marginTop: 8 }}>
              No shifts yet
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 }}>
              Add your first shift to start scheduling staff.
            </Text>
            {canEdit && (
              <Pressable
                onPress={openCreate}
                style={({ pressed }) => [
                  styles.emptyBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Add shift</Text>
              </Pressable>
            )}
          </View>
        ) : (
          shifts.map(s => (
            <Pressable
              key={s.id}
              onPress={() => canEdit && openEdit(s)}
              disabled={!canEdit}
              style={({ pressed }) => [
                styles.shiftCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.shiftName, { color: colors.foreground }]} numberOfLines={1}>{s.name}</Text>
                <Text style={[styles.shiftTime, { color: colors.primary }]}>
                  {displayTime(s.startTime)} – {displayTime(s.endTime)}
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                    {"  ·  "}{durationLabel(s.startTime, s.endTime)}
                  </Text>
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                  {DAYS.map(d => {
                    const active = (s.days ?? []).includes(d.key);
                    return (
                      <View
                        key={d.key}
                        style={[
                          styles.dayPill,
                          {
                            backgroundColor: active ? colors.primary + "1A" : "transparent",
                            borderColor: active ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: active ? colors.primary : colors.mutedForeground }}>
                          {d.label[0]}
                        </Text>
                      </View>
                    );
                  })}
                  {(s.days ?? []).length === 0 && (
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                      No fixed days
                    </Text>
                  )}
                </View>
              </View>
              {canEdit && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Pressable
                    onPress={() => openEdit(s)}
                    hitSlop={8}
                    style={{ padding: 6 }}
                  >
                    <Ionicons name="create-outline" size={20} color={colors.mutedForeground} />
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDelete(s)}
                    hitSlop={8}
                    style={{ padding: 6 }}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.destructive} />
                  </Pressable>
                </View>
              )}
            </Pressable>
          ))
        )}

        {!canEdit && (
          <View
            style={[
              styles.lockBox,
              { backgroundColor: colors.muted, borderColor: colors.border },
            ]}
          >
            <Ionicons name="lock-closed-outline" size={16} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 }}>
              Only owners and managers can change shift definitions.
            </Text>
          </View>
        )}
      </ScrollView>

      <AppBottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={draft.id ? "Edit shift" : "New shift"}
      >
        <SheetField
          colors={colors}
          label="Shift name"
          value={draft.name}
          onChange={v => setDraft(d => ({ ...d, name: v }))}
          placeholder="Morning, Dinner, Late night…"
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <SheetField
              colors={colors}
              label="Starts"
              value={draft.startTime}
              onChange={v => setDraft(d => ({ ...d, startTime: v }))}
              placeholder="09:00"
              numeric
            />
          </View>
          <View style={{ flex: 1 }}>
            <SheetField
              colors={colors}
              label="Ends"
              value={draft.endTime}
              onChange={v => setDraft(d => ({ ...d, endTime: v }))}
              placeholder="17:00"
              numeric
            />
          </View>
        </View>

        <View style={{ marginTop: 4 }}>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Days of week</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {DAYS.map(d => {
              const active = draft.days.includes(d.key);
              return (
                <Pressable
                  key={d.key}
                  onPress={() => toggleDay(d.key)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.primary + "1A" : "transparent",
                  }}
                >
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: active ? colors.primary : colors.foreground }}>
                    {d.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 6 }}>
            Pick days this shift runs on. Leave blank for ad-hoc shifts.
          </Text>
        </View>

        <AppButton
          label={draft.id ? "Save changes" : "Create shift"}
          leftIcon="checkmark-circle-outline"
          loading={saveMut.isPending}
          onPress={submit}
          fullWidth
        />
      </AppBottomSheet>
    </View>
  );
}

type Colors = ReturnType<typeof useColors>;

function SheetField({
  colors,
  label,
  value,
  onChange,
  placeholder,
  numeric,
}: {
  colors: Colors;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <View style={[styles.fieldBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={numeric ? (Platform.OS === "ios" ? "numbers-and-punctuation" : "default") : "default"}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          color: colors.foreground,
          fontSize: 16,
          fontFamily: "Inter_600SemiBold",
          paddingVertical: 4,
          marginTop: 2,
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
  shiftCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  shiftName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  shiftTime: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  dayPill: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCard: {
    alignItems: "center",
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  emptyBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  lockBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  fieldBox: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
});
