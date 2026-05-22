import React, { useMemo, useState } from "react";
import { View, Pressable, StyleSheet, FlatList, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon } from "./AppIcon";
import { AppInput } from "./AppInput";
import { AppBottomSheet } from "./AppBottomSheet";

export interface DropdownOption<T extends string | number = string> {
  value: T;
  label: string;
  description?: string;
}

export interface AppDropdownProps<T extends string | number = string> {
  label?: string;
  value: T | null | undefined;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  /** Show a search input above the options list. Default true when >7 options. */
  searchable?: boolean;
  disabled?: boolean;
  error?: string | null;
  helperText?: string;
  containerStyle?: ViewStyle;
  /** Sheet title. Defaults to the field `label`. */
  sheetTitle?: string;
}

/**
 * Opens an `AppBottomSheet` containing a searchable list — never the raw
 * Android `Picker`. Renders consistently on both platforms.
 */
export function AppDropdown<T extends string | number = string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  searchable,
  disabled,
  error,
  helperText,
  containerStyle,
  sheetTitle,
}: AppDropdownProps<T>) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((o) => o.value === value) ?? null;
  const showSearch = searchable ?? options.length > 7;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  return (
    <View style={containerStyle}>
      {label ? (
        <AppText variant="label" color="mutedForeground" style={{ marginBottom: 6 }}>
          {label}
        </AppText>
      ) : null}
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: t.colors.surfaceAlt,
            borderColor: error ? t.colors.destructive : t.colors.border,
            opacity: disabled ? 0.6 : pressed ? 0.9 : 1,
          },
        ]}
      >
        <AppText
          variant="body"
          color={selected ? "foreground" : "mutedForeground"}
          numberOfLines={1}
          style={{ flex: 1 }}
        >
          {selected ? selected.label : placeholder}
        </AppText>
        <AppIcon name="chevron-down" size={18} color="mutedForeground" />
      </Pressable>
      {error ? (
        <AppText variant="small" color="destructive" style={{ marginTop: 4 }}>{error}</AppText>
      ) : helperText ? (
        <AppText variant="small" color="mutedForeground" style={{ marginTop: 4 }}>{helperText}</AppText>
      ) : null}

      <AppBottomSheet
        visible={open}
        onClose={() => { setOpen(false); setSearch(""); }}
        title={sheetTitle ?? label ?? "Select"}
        scrollable={false}
      >
        {showSearch ? (
          <AppInput
            placeholder="Search"
            value={search}
            onChangeText={setSearch}
            leftIcon="search"
            autoFocus
          />
        ) : null}
        <FlatList
          data={filtered}
          keyExtractor={(o) => String(o.value)}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.colors.border }} />
          )}
          renderItem={({ item }) => {
            const isSelected = item.value === value;
            return (
              <Pressable
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                  setSearch("");
                }}
                style={({ pressed }) => [
                  styles.option,
                  { backgroundColor: pressed ? t.colors.muted : "transparent" },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <AppText variant="body" weight={isSelected ? "semibold" : "regular"}>
                    {item.label}
                  </AppText>
                  {item.description ? (
                    <AppText variant="small" color="mutedForeground">
                      {item.description}
                    </AppText>
                  ) : null}
                </View>
                {isSelected ? <AppIcon name="checkmark" size={18} color="primary" /> : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <AppText variant="body" color="mutedForeground" align="center" style={{ padding: 24 }}>
              No matches
            </AppText>
          }
          style={{ maxHeight: 420 }}
        />
      </AppBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
