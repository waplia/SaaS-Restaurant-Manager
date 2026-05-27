import React, { useState } from "react";
import { Modal, View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAcceptGuestVerification,
  useRejectGuestVerification,
  type GuestVerification,
} from "@/hooks/useGuestVerifications";
import { formatOrderNumber } from "@/lib/orderNumber";

interface Props {
  verification: GuestVerification | null;
  tableLabel?: string;
  onClose: () => void;
}

function waitText(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ${seconds % 60}s`;
}

export function GuestVerificationSheet({ verification, tableLabel, onClose }: Props) {
  const accept = useAcceptGuestVerification();
  const reject = useRejectGuestVerification();
  const [error, setError] = useState<string | null>(null);
  const busy = accept.isPending || reject.isPending;
  const open = !!verification;

  if (!verification) {
    return <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} />;
  }

  const v = verification;

  async function onAccept() {
    setError(null);
    try {
      await accept.mutateAsync(v.orderId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept");
    }
  }
  async function onReject() {
    setError(null);
    try {
      await reject.mutateAsync({ orderId: v.orderId, reason: "Guest not present" });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reject");
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Ionicons name="warning" size={20} color="#a16207" />
              <Text style={styles.title}>Verify guest at table</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color="#475569" /></Pressable>
          </View>

          <View style={styles.metaBlock}>
            <Text style={styles.tableLabel}>{tableLabel ? `Table ${tableLabel}` : v.tableId ? `Table ${v.tableId}` : "Order"}</Text>
            <Text style={styles.metaText}>Order #{formatOrderNumber(v.orderNumber)} · waiting {waitText(v.heldAt)}</Text>
            <Text style={styles.bodyText}>
              QR order placed without staff opening the table. Only accept if a guest is physically here.
            </Text>
          </View>

          <ScrollView style={styles.itemList} contentContainerStyle={{ paddingBottom: 8 }}>
            {v.items.map((it, idx) => (
              <View key={idx} style={styles.itemRow}>
                <Text style={styles.itemQty}>{it.quantity}×</Text>
                <Text style={styles.itemName} numberOfLines={2}>{it.name}</Text>
                <Text style={styles.itemPrice}>₹{Number(it.unitPrice).toLocaleString("en-IN")}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>₹{Number(v.totalAmount).toLocaleString("en-IN")}</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.btnReject]} disabled={busy} onPress={onReject}>
              {busy && reject.isPending ? <ActivityIndicator color="#b91c1c" /> : (
                <>
                  <Ionicons name="close-circle" size={16} color="#b91c1c" />
                  <Text style={styles.btnRejectText}>Reject</Text>
                </>
              )}
            </Pressable>
            <Pressable style={[styles.btn, styles.btnAccept]} disabled={busy} onPress={onAccept}>
              {busy && accept.isPending ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={16} color="#fff" />
                  <Text style={styles.btnAcceptText}>Accept & fire</Text>
                </>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, maxHeight: "85%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#0f172a" },
  metaBlock: { backgroundColor: "#fefce8", borderColor: "#facc15", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  tableLabel: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#854d0e" },
  metaText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#a16207", marginTop: 2 },
  bodyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#854d0e", marginTop: 8 },
  itemList: { maxHeight: 220, marginBottom: 8 },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0", gap: 12 },
  itemQty: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#0f172a", width: 32 },
  itemName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#0f172a" },
  itemPrice: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#475569" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 8, paddingBottom: 12, borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  totalLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#475569" },
  totalValue: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#0f172a" },
  error: { color: "#b91c1c", fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 8 },
  actions: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  btnReject: { borderWidth: 1.5, borderColor: "#fca5a5", backgroundColor: "#fff" },
  btnRejectText: { color: "#b91c1c", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  btnAccept: { backgroundColor: "#16a34a" },
  btnAcceptText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 },
});
