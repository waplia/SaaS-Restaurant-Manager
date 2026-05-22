import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/theme";

export interface AppSwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}

const W = 46;
const H = 28;
const KNOB = 22;

/**
 * Custom switch that never shows the default Android switch visuals — the
 * track and thumb are fully owned by the theme so iOS and Android look
 * identical.
 */
export function AppSwitch({ value, onValueChange, disabled }: AppSwitchProps) {
  const t = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const trackColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [t.colors.border, t.colors.primary],
  });
  const translate = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, W - KNOB - 2],
  });

  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View
          style={[
            styles.knob,
            {
              transform: [{ translateX: translate }],
              backgroundColor: "#fff",
              ...t.shadow("xs"),
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, justifyContent: "center" },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2 },
});
