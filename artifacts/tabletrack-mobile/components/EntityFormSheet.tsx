import React from "react";
import {
  View, Text, StyleSheet, Modal, Pressable, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { BRAND } from "@/constants/brand";

/**
 * Reusable bottom-sheet form used by all owner CRUD screens.
 * Hosts arbitrary field children, a primary submit button, and an
 * optional secondary "Delete" button (shown only in edit mode).
 */
export function EntityFormSheet({
  visible, onClose, title, children, submitting, canSubmit, onSubmit, submitLabel,
  onDelete, deleting, deleteLabel = "Delete", deleteConfirmMessage,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  submitLabel: string;
  onDelete?: () => void;
  deleting?: boolean;
  deleteLabel?: string;
  deleteConfirmMessage?: string;
}) {
  const colors = useColors();
  const handleDelete = () => {
    if (!onDelete) return;
    Alert.alert(
      "Delete",
      deleteConfirmMessage ?? "This cannot be undone. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: onDelete },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 4 }}>
            {children}
          </ScrollView>
          <Pressable
            disabled={!canSubmit}
            onPress={onSubmit}
            style={({ pressed }) => [
              styles.submit,
              { backgroundColor: colors.primary, opacity: !canSubmit ? 0.4 : pressed ? 0.85 : 1 },
            ]}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.submitText}>{submitLabel}</Text>
            )}
          </Pressable>
          {onDelete ? (
            <Pressable
              onPress={handleDelete}
              disabled={deleting}
              style={({ pressed }) => [
                styles.delete,
                { borderColor: BRAND.danger, opacity: deleting ? 0.5 : pressed ? 0.7 : 1 },
              ]}
            >
              {deleting ? (
                <ActivityIndicator color={BRAND.danger} />
              ) : (
                <Text style={[styles.deleteText, { color: BRAND.danger }]}>{deleteLabel}</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function FormField({
  label, children,
}: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={[fieldStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      {children}
    </View>
  );
}

export const formInputStyle = (colors: ReturnType<typeof useColors>) => ({
  borderWidth: 1,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontFamily: "Inter_400Regular" as const,
  fontSize: 14,
  color: colors.foreground,
  borderColor: colors.border,
  backgroundColor: colors.background,
});

const fieldStyles = StyleSheet.create({
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
});

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  backdropTouch: { flex: 1 },
  sheet: { padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 6, maxHeight: "85%" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  submit: { marginTop: 16, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  submitText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  delete: { marginTop: 8, paddingVertical: 11, borderRadius: 10, alignItems: "center", borderWidth: 1 },
  deleteText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
