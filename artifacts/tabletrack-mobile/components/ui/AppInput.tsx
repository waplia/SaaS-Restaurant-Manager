import React, { useState, forwardRef } from "react";
import {
  TextInput,
  View,
  StyleSheet,
  Pressable,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon, type AppIconName } from "./AppIcon";

export interface AppInputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  helperText?: string;
  error?: string | null;
  leftIcon?: AppIconName;
  rightIcon?: AppIconName;
  onRightIconPress?: () => void;
  containerStyle?: ViewStyle;
  /** Visual style: filled (default) or outlined. */
  appearance?: "filled" | "outlined";
}

/**
 * Form input with rounded border, focus state, label, helper text, and
 * error state. Uses Inter via `AppText` for the surrounding labels and
 * applies it directly to the `TextInput` style so the typed text uses the
 * brand font on both iOS and Android.
 */
export const AppInput = forwardRef<TextInput, AppInputProps>(function AppInput(
  {
    label,
    helperText,
    error,
    leftIcon,
    rightIcon,
    onRightIconPress,
    containerStyle,
    appearance = "filled",
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const hasError = !!error;

  const borderColor = hasError
    ? t.colors.destructive
    : focused
      ? t.colors.primary
      : t.colors.border;

  const bg = appearance === "outlined" ? "transparent" : t.colors.surfaceAlt;

  return (
    <View style={containerStyle}>
      {label ? (
        <AppText variant="label" color="mutedForeground" style={{ marginBottom: 6 }}>
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.row,
          {
            backgroundColor: bg,
            borderColor,
            borderWidth: 1,
            borderRadius: 12,
            minHeight: 48,
            paddingHorizontal: 12,
          },
        ]}
      >
        {leftIcon ? (
          <AppIcon name={leftIcon} size={18} color={focused ? "primary" : "mutedForeground"} />
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={t.colors.mutedForeground}
          selectionColor={t.colors.primary}
          {...rest}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[
            styles.input,
            {
              color: t.colors.foreground,
              fontFamily: t.fontFamily.regular,
              fontSize: 15,
            },
          ]}
        />
        {rightIcon ? (
          <Pressable hitSlop={10} onPress={onRightIconPress} disabled={!onRightIconPress}>
            <AppIcon name={rightIcon} size={18} color="mutedForeground" />
          </Pressable>
        ) : null}
      </View>
      {hasError ? (
        <AppText variant="small" color="destructive" style={{ marginTop: 4 }}>
          {error}
        </AppText>
      ) : helperText ? (
        <AppText variant="small" color="mutedForeground" style={{ marginTop: 4 }}>
          {helperText}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, paddingVertical: 10 },
});
