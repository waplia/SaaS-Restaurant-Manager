import React from "react";
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon } from "./AppIcon";

export interface AppBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Show a close icon button on the right of the header. Default true. */
  showClose?: boolean;
  /** Max height as a viewport fraction (0–1). Default 0.85. */
  maxHeightFraction?: number;
  /** Wrap children in a ScrollView. Default true. */
  scrollable?: boolean;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
  /** Right-side adornment placed beside the title (e.g. action button). */
  headerRight?: React.ReactNode;
}

/**
 * Themed bottom sheet built on `Modal` with a backdrop, rounded top corners,
 * grab handle, and consistent header. Replaces every raw Android `Modal` /
 * `Picker` in the app so pickers and dropdowns look identical on both
 * platforms.
 */
export function AppBottomSheet({
  visible,
  onClose,
  title,
  showClose = true,
  maxHeightFraction = 0.85,
  scrollable = true,
  children,
  contentStyle,
  headerRight,
}: AppBottomSheetProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, t.spacing.lg);

  const inner = scrollable ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        { padding: t.spacing.lg, paddingBottom: bottomPad, gap: t.spacing.md },
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ padding: t.spacing.lg, paddingBottom: bottomPad, gap: t.spacing.md }, contentStyle]}>
      {children}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: t.colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ width: "100%" }}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: t.colors.background,
                maxHeight: `${Math.round(maxHeightFraction * 100)}%`,
                ...t.shadow("lg"),
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: t.colors.border }]} />
            {(title || showClose || headerRight) ? (
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  {title ? <AppText variant="h2">{title}</AppText> : null}
                </View>
                {headerRight}
                {showClose ? (
                  <Pressable hitSlop={10} onPress={onClose} style={{ marginLeft: 8 }} accessibilityLabel="Close">
                    <AppIcon name="close" size={22} color="mutedForeground" />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {inner}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 4,
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
});
