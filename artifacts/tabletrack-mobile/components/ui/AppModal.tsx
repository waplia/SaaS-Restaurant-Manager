import React from "react";
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import { useTheme } from "@/theme";
import { AppText } from "./AppText";
import { AppIcon } from "./AppIcon";

export interface AppModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  showClose?: boolean;
  /** Dismiss when the backdrop is tapped. Default true. */
  dismissOnBackdropPress?: boolean;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
}

/**
 * Centered modal dialog. Use for confirmations and small focused dialogs.
 * For pickers / lists / large forms, prefer `AppBottomSheet`.
 */
export function AppModal({
  visible,
  onClose,
  title,
  showClose = true,
  dismissOnBackdropPress = true,
  children,
  contentStyle,
}: AppModalProps) {
  const t = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: t.colors.overlay }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => dismissOnBackdropPress && onClose()}
        />
        <View
          style={[
            styles.card,
            { backgroundColor: t.colors.card, ...t.shadow("lg") },
            contentStyle,
          ]}
        >
          {(title || showClose) ? (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                {title ? <AppText variant="h2">{title}</AppText> : null}
              </View>
              {showClose ? (
                <Pressable hitSlop={10} onPress={onClose} accessibilityLabel="Close">
                  <AppIcon name="close" size={22} color="mutedForeground" />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={{ marginTop: title ? 8 : 0 }}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    padding: 20,
  },
  header: { flexDirection: "row", alignItems: "center" },
});
