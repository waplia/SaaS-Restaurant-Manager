import React from "react";
import { View } from "react-native";
import { AppModal } from "./AppModal";
import { AppText } from "./AppText";
import { AppButton } from "./AppButton";

export interface ConfirmationModalProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "destructive" turns the confirm button red. */
  tone?: "primary" | "destructive";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Yes/no confirmation dialog. Use whenever an action is destructive,
 * irreversible, or has financial impact (void order, refund, delete item,
 * close shift, write-off stock, etc).
 */
export function ConfirmationModal({
  visible, title, message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  loading,
  onConfirm, onCancel,
}: ConfirmationModalProps) {
  return (
    <AppModal visible={visible} onClose={onCancel} title={title} showClose={false}>
      {message ? (
        <AppText variant="body" color="mutedForeground" style={{ marginTop: 4 }}>
          {message}
        </AppText>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
        <AppButton
          label={cancelLabel}
          variant="ghost"
          onPress={onCancel}
          fullWidth
          style={{ flex: 1 }}
          disabled={loading}
        />
        <AppButton
          label={confirmLabel}
          variant={tone === "destructive" ? "destructive" : "primary"}
          onPress={onConfirm}
          fullWidth
          style={{ flex: 1 }}
          loading={loading}
        />
      </View>
    </AppModal>
  );
}
