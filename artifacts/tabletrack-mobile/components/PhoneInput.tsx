import React, { useMemo, useState } from "react";
import {
  View, Text, TextInput, Pressable, Modal, FlatList, StyleSheet, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  COUNTRY_CODES,
  DEFAULT_ISO,
  parsePhone,
  resolveCountry,
  formatPhone,
  expectedNationalLength,
  type CountryCode,
} from "@workspace/phone-utils";
import { useColors } from "@/hooks/useColors";

interface PhoneInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** ISO-2 default country (e.g. "IN", "AE"). */
  defaultCountry?: string;
  editable?: boolean;
  testID?: string;
}

/**
 * React-Native phone field with an inline country/flag selector. Shares the
 * exact same country data + parsing logic as the web admin and wallet apps.
 */
export function PhoneInput({
  value,
  onChange,
  placeholder = "9876543210",
  defaultCountry = DEFAULT_ISO,
  editable = true,
  testID,
}: PhoneInputProps) {
  const colors = useColors();
  const parsed = useMemo(
    () => parsePhone(value, defaultCountry),
    [value, defaultCountry],
  );
  const country =
    parsed.country.iso ? parsed.country : resolveCountry(defaultCountry);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRY_CODES;
    const numeric = q.replace(/^\+/, "");
    return COUNTRY_CODES.filter(c =>
      c.name.toLowerCase().includes(q)
      || c.iso.toLowerCase().includes(q)
      || c.code.includes(numeric)
      || c.code.slice(1).startsWith(numeric)
    );
  }, [search]);

  function emit(next: CountryCode, national: string) {
    const cap = expectedNationalLength(next.iso);
    const digits = national.replace(/\D+/g, "").slice(0, cap);
    onChange(formatPhone(next, digits));
  }

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        disabled={!editable}
        onPress={() => setOpen(true)}
        style={[
          styles.country,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
        testID={testID ? `${testID}-country` : undefined}
      >
        <Text style={{ fontSize: 16 }}>{country.flag}</Text>
        <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14 }}>
          {country.code}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.mutedForeground} />
      </Pressable>
      <TextInput
        value={parsed.national}
        onChangeText={t => emit(country, t)}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType="phone-pad"
        editable={editable}
        maxLength={expectedNationalLength(country.iso)}
        testID={testID}
        style={[
          styles.input,
          { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
        ]}
      />

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)} transparent>
        <View style={[styles.modalBg]}>
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>
                Select country
              </Text>
              <Pressable onPress={() => setOpen(false)}>
                <Ionicons name="close" size={22} color={colors.foreground} />
              </Pressable>
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search country or code"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.search,
                { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
              ]}
            />
            <FlatList
              data={filtered}
              keyExtractor={c => c.iso}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = item.iso === country.iso;
                return (
                  <Pressable
                    onPress={() => {
                      emit(item, parsed.national);
                      setOpen(false);
                      setSearch("");
                    }}
                    style={[
                      styles.option,
                      { borderBottomColor: colors.border },
                      selected && { backgroundColor: colors.card },
                    ]}
                  >
                    <Text style={{ fontSize: 18 }}>{item.flag}</Text>
                    <Text style={{ color: colors.foreground, flex: 1 }}>{item.name}</Text>
                    <Text style={{ color: colors.mutedForeground }}>{item.code}</Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={{ textAlign: "center", padding: 24, color: colors.mutedForeground }}>
                  No matches
                </Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  country: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 96,
    justifyContent: "space-between",
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "85%", paddingBottom: 24 },
  sheetHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 16, borderBottomWidth: 1,
  },
  search: { margin: 12, padding: 10, borderWidth: 1, borderRadius: 10, fontSize: 14 },
  option: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
