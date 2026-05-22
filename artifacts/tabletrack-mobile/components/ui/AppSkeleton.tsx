import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";

export interface AppSkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

/** Rounded shimmer block used in lists and cards while data loads. */
export function AppSkeleton({ width = "100%", height = 14, radius = 8, style }: AppSkeletonProps) {
  const t = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.base,
        {
          width: width as ViewStyle["width"],
          height,
          borderRadius: radius,
          backgroundColor: t.colors.muted,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function AppSkeletonList({ rows = 5 }: { rows?: number }) {
  const t = useTheme();
  return (
    <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: t.spacing.md,
            padding: t.spacing.md,
            backgroundColor: t.colors.card,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: t.colors.border,
          }}
        >
          <AppSkeleton width={36} height={36} radius={18} />
          <View style={{ flex: 1, gap: 6 }}>
            <AppSkeleton width="60%" height={12} />
            <AppSkeleton width="40%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ base: { overflow: "hidden" } });
