import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Modal } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export interface TimePickerFieldProps {
  /** Current value in "HH:MM" 24-hour format, or empty string. */
  value: string;
  onChange: (next: string) => void;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  editable?: boolean;
  placeholder?: string;
}

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

function parseHHMM(s: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return { h: 9, m: 0 };
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return { h, m: mm };
}

function display12(hhmm: string): string {
  if (!hhmm) return "—";
  const { h, m } = parseHHMM(hhmm);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${pad(m)} ${period}`;
}

/**
 * Native time picker field — opens the platform's date-time picker
 * (Android: spinner dialog, iOS: inline wheel, Web: HTML <input type="time">).
 * Stores and returns time in "HH:MM" 24-hour format so it round-trips with
 * the server's text columns.
 */
export function TimePickerField({
  value, onChange, label, icon = "time-outline", editable = true, placeholder = "Tap to pick",
}: TimePickerFieldProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const initialDate = (() => {
    const { h, m } = parseHHMM(value || "09:00");
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  })();

  // Web — fall back to native HTML time input; DateTimePicker isn't supported.
  if (Platform.OS === "web") {
    return (
      <View style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name={icon} size={14} color={colors.mutedForeground} />
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
        </View>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {React.createElement("input" as any, {
          type: "time",
          value: value || "",
          disabled: !editable,
          onChange: (e: { target: { value: string } }) => onChange(e.target.value),
          style: {
            border: "none",
            background: "transparent",
            color: colors.foreground,
            fontSize: 22,
            fontFamily: "Inter_700Bold",
            padding: 0,
            marginTop: 6,
            outline: "none",
            width: "100%",
          },
        })}
        <Text style={{ color: value ? colors.primary : colors.mutedForeground, fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 }}>
          {value ? display12(value) : placeholder}
        </Text>
      </View>
    );
  }

  const onChangePicker = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS !== "ios") setOpen(false);
    if (event.type === "dismissed" || !selected) return;
    onChange(`${pad(selected.getHours())}:${pad(selected.getMinutes())}`);
  };

  return (
    <>
      <Pressable
        onPress={() => editable && setOpen(true)}
        disabled={!editable}
        style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border, opacity: editable ? 1 : 0.6 }]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name={icon} size={14} color={colors.mutedForeground} />
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
        </View>
        <Text style={[styles.value, { color: value ? colors.foreground : colors.mutedForeground }]}>
          {value ? display12(value) : placeholder}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 }}>
          {value ? `24-hour: ${value}` : "Tap to choose a time"}
        </Text>
      </Pressable>

      {open && Platform.OS === "android" && (
        <DateTimePicker
          mode="time"
          value={initialDate}
          is24Hour={false}
          display="spinner"
          onChange={onChangePicker}
        />
      )}

      {open && Platform.OS === "ios" && (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.iosBackdrop} onPress={() => setOpen(false)}>
            <Pressable onPress={(e) => e.stopPropagation()} style={[styles.iosSheet, { backgroundColor: colors.card }]}>
              <View style={[styles.iosHeader, { borderBottomColor: colors.border }]}>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>Cancel</Text>
                </Pressable>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 16 }}>{label}</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold", fontSize: 15 }}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                mode="time"
                value={initialDate}
                display="spinner"
                onChange={onChangePicker}
                style={{ alignSelf: "stretch" }}
                themeVariant="light"
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  field: { padding: 14, borderRadius: 12, borderWidth: 1, flex: 1 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  value: { fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 6 },
  iosBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  iosSheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 8, paddingBottom: 24 },
  iosHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
