import React, { useState, useEffect } from "react";
import { Modal, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  orderLabel: string;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void> | void;
}

const MAX = 200;

/**
 * Cross-platform "Cancel KOT" reason form. Replaces the iOS-only
 * Alert.prompt so Android cooks can cancel a ticket too. Server requires
 * a reason of at least 3 characters.
 */
export function KdsCancelSheet({ visible, orderLabel, submitting, onClose, onSubmit }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setReason("");
      setError(null);
    }
  }, [visible]);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 3 && !submitting;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.kbWrap}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <Text style={[styles.title, { color: colors.foreground }]}>Cancel {orderLabel}</Text>
          <Text style={[styles.help, { color: colors.mutedForeground }]}>
            This will void the kitchen ticket. A reason of at least 3 characters is required for the audit log.
          </Text>
          <TextInput
            value={reason}
            onChangeText={(t) => { setReason(t.slice(0, MAX)); if (error) setError(null); }}
            placeholder="Why is this order being cancelled?"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted, borderColor: error ? "#dc2626" : colors.border }]}
            multiline
            numberOfLines={4}
            autoFocus
            maxLength={MAX}
          />
          <View style={styles.metaRow}>
            <Text style={[styles.counter, { color: trimmed.length < 3 ? "#dc2626" : colors.mutedForeground }]}>
              {trimmed.length < 3 ? `${3 - trimmed.length} more characters` : "OK"}
            </Text>
            <Text style={[styles.counter, { color: colors.mutedForeground }]}>{reason.length}/{MAX}</Text>
          </View>
          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={14} color="#dc2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              disabled={submitting}
              style={({ pressed }) => [styles.btn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>Back</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (!canSubmit) return;
                try {
                  await onSubmit(trimmed);
                } catch (err) {
                  setError((err as Error)?.message ?? "Could not cancel.");
                }
              }}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: "#b91c1c", borderColor: "#b91c1c", opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold" }}>
                {submitting ? "Cancelling…" : "Confirm Cancel"}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  kbWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 10 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "#d1d5db" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  help: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 90, textAlignVertical: "top", fontFamily: "Inter_400Regular" },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  counter: { fontSize: 11, fontFamily: "Inter_500Medium" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorText: { color: "#dc2626", fontSize: 12, fontFamily: "Inter_500Medium" },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
