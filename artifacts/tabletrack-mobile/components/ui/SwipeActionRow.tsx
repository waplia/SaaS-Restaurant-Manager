import React, { useRef } from "react";
import { Animated, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { Swipeable, RectButton } from "react-native-gesture-handler";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon, type AppIconName } from "./AppIcon";

export interface SwipeAction {
  label: string;
  icon?: AppIconName;
  /** Background color. Defaults: primary for left, destructive for right. */
  color?: string;
  onPress: () => void;
}

export interface SwipeActionRowProps {
  children: React.ReactNode;
  /** Action revealed by swiping right→left (most common). */
  rightAction?: SwipeAction;
  /** Action revealed by swiping left→right. */
  leftAction?: SwipeAction;
  /** When true, fully swiping triggers the action immediately. */
  triggerOnFullSwipe?: boolean;
  style?: ViewStyle;
}

/**
 * Row container with optional swipe-to-action affordances. Use in lists
 * where users do the same destructive/positive thing often — e.g. "swipe
 * to mark delivered", "swipe to void", "swipe to bump KOT".
 *
 * Built on react-native-gesture-handler's `Swipeable`, so it requires the
 * RootView to be a GestureHandlerRootView (already wired in `_layout.tsx`).
 */
export function SwipeActionRow({
  children, rightAction, leftAction, triggerOnFullSwipe = false, style,
}: SwipeActionRowProps) {
  const t = useTheme();
  const ref = useRef<Swipeable>(null);

  const renderAction = (
    action: SwipeAction,
    side: "left" | "right",
    progress: Animated.AnimatedInterpolation<number>,
  ) => {
    const color = action.color
      ?? (side === "right" ? t.colors.destructive : t.colors.primary);
    const translate = progress.interpolate({
      inputRange: [0, 1],
      outputRange: side === "right" ? [80, 0] : [-80, 0],
    });
    return (
      <Animated.View style={{ width: 96, transform: [{ translateX: translate }] }}>
        <RectButton
          style={[styles.action, { backgroundColor: color }]}
          onPress={() => {
            action.onPress();
            ref.current?.close();
          }}
        >
          {action.icon ? <AppIcon name={action.icon} size={20} color={"#fff"} /> : null}
          <AppText variant="small" weight="semibold" style={{ color: "#fff", marginTop: 4 }}>
            {action.label}
          </AppText>
        </RectButton>
      </Animated.View>
    );
  };

  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      renderRightActions={rightAction ? (p) => renderAction(rightAction, "right", p) : undefined}
      renderLeftActions={leftAction ? (p) => renderAction(leftAction, "left", p) : undefined}
      onSwipeableOpen={(direction) => {
        if (!triggerOnFullSwipe) return;
        if (direction === "right" && rightAction) rightAction.onPress();
        if (direction === "left" && leftAction) leftAction.onPress();
        ref.current?.close();
      }}
    >
      <View style={[{ backgroundColor: t.colors.card }, style]}>{children}</View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8,
  },
});
