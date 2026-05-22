import React, { useEffect } from "react";
import {
  View,
  StyleSheet,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
  type ScrollViewProps,
  type ViewStyle,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useTheme } from "@/theme";

export interface AppScreenProps {
  children: React.ReactNode;
  /** Override background color. Defaults to theme background. */
  background?: string;
  /** When true, wraps children in a ScrollView with sensible defaults. */
  scroll?: boolean;
  /** Extra props for the inner ScrollView when `scroll` is true. */
  scrollProps?: ScrollViewProps;
  /** When true (default), wraps children in a KeyboardAvoidingView. */
  keyboardAvoiding?: boolean;
  /** Safe-area edges to apply. Defaults to top + bottom. */
  edges?: ReadonlyArray<Edge>;
  /** Extra style for the outer container. */
  style?: ViewStyle;
  /** Extra padding (horizontal) applied to the content. */
  padded?: boolean;
}

/**
 * Owns safe-area insets, status bar style, Android navigation-bar color,
 * background, and keyboard avoidance. Every screen should render its
 * content inside an `AppScreen` so this boilerplate stays in one place.
 */
export function AppScreen({
  children,
  background,
  scroll = false,
  scrollProps,
  keyboardAvoiding = true,
  edges = ["top", "bottom"],
  style,
  padded = false,
}: AppScreenProps) {
  const t = useTheme();
  const bg = background ?? t.colors.background;

  // Match Android system navigation bar to the screen background so users
  // never see a default black/gray bar peeking under our content.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    NavigationBar.setBackgroundColorAsync(bg).catch((err) => {
      if (__DEV__) console.warn("[AppScreen] nav-bar bg failed", err);
    });
    NavigationBar.setButtonStyleAsync(t.scheme === "dark" ? "light" : "dark").catch((err) => {
      if (__DEV__) console.warn("[AppScreen] nav-bar style failed", err);
    });
  }, [bg, t.scheme]);

  const content = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      {...scrollProps}
      contentContainerStyle={[
        padded ? { paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.lg } : null,
        scrollProps?.contentContainerStyle,
      ]}
      style={[{ flex: 1 }, scrollProps?.style]}
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        { flex: 1 },
        padded ? { paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.lg } : null,
      ]}
    >
      {children}
    </View>
  );

  const body = keyboardAvoiding ? (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
  );

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.root, { backgroundColor: bg }, style]}
    >
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} backgroundColor={bg} />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
