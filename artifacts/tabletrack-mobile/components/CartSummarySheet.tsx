import React, { useState } from "react";
import {
  View, Text, Modal, Pressable, ScrollView, StyleSheet, ActivityIndicator, TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useCart } from "@/context/CartContext";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSend: () => Promise<void> | void;
  taxRate?: number;
  serviceCharge?: number;
  busy?: boolean;
  primaryLabel?: string;
}

export function CartSummarySheet({ visible, onClose, onSend, taxRate = 0, serviceCharge = 0, busy, primaryLabel = "Send to Kitchen" }: Props) {
  const colors = useColors();
  const { cart, updateQuantity, removeLine, updateNote, total } = useCart();
  const [noteEditing, setNoteEditing] = useState<string | null>(null);

  const subtotal = total;
  const tax = subtotal * (taxRate || 0);
  const service = subtotal * (serviceCharge || 0);
  const grand = subtotal + tax + service;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>Your Cart</Text>
          <Pressable onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 16 }}>
          {cart.items.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, textAlign: "center", paddingVertical: 24 }}>Cart is empty.</Text>
          ) : cart.items.map((line) => {
            const mods = line.modifiers ?? [];
            const modSum = mods.reduce((s, m) => s + m.priceDelta, 0);
            const lineTotal = (line.price + modSum) * line.quantity;
            return (
              <View key={line.lineId} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.lineName, { color: colors.foreground }]} numberOfLines={1}>{line.name}</Text>
                  {mods.map((m) => (
                    <Text key={`${line.lineId}-${m.modifierId}`} style={[styles.mod, { color: colors.mutedForeground }]} numberOfLines={1}>
                      · {m.name}{m.priceDelta ? ` (+₹${m.priceDelta})` : ""}
                    </Text>
                  ))}
                  {noteEditing === line.lineId ? (
                    <TextInput
                      value={line.note ?? ""}
                      onChangeText={(t) => updateNote(line.lineId, t)}
                      onBlur={() => setNoteEditing(null)}
                      autoFocus
                      placeholder="Note for kitchen"
                      placeholderTextColor={colors.mutedForeground}
                      style={[styles.noteInput, { borderColor: colors.border, color: colors.foreground }]}
                    />
                  ) : line.note ? (
                    <Pressable onPress={() => setNoteEditing(line.lineId)}>
                      <Text style={[styles.note, { color: colors.primary }]} numberOfLines={1}>Note: {line.note}</Text>
                    </Pressable>
                  ) : (
                    <Pressable onPress={() => setNoteEditing(line.lineId)}>
                      <Text style={[styles.addNote, { color: colors.mutedForeground }]}>+ Add note</Text>
                    </Pressable>
                  )}
                </View>

                <View style={styles.stepper}>
                  <Pressable
                    onPress={() => {
                      if (line.quantity === 1) removeLine(line.lineId);
                      else updateQuantity(line.lineId, -1);
                    }}
                    style={[styles.stepBtn, { backgroundColor: colors.muted }]}
                  >
                    <Ionicons name={line.quantity === 1 ? "trash-outline" : "remove"} size={14} color={colors.foreground} />
                  </Pressable>
                  <Text style={[styles.qty, { color: colors.foreground }]}>{line.quantity}</Text>
                  <Pressable onPress={() => updateQuantity(line.lineId, 1)} style={[styles.stepBtn, { backgroundColor: colors.primary }]}>
                    <Ionicons name="add" size={14} color="#fff" />
                  </Pressable>
                </View>

                <Text style={[styles.lineTotal, { color: colors.foreground }]}>₹{lineTotal.toLocaleString("en-IN")}</Text>
              </View>
            );
          })}

          {cart.items.length > 0 ? (
            <View style={[styles.totals, { borderColor: colors.border }]}>
              <Totals label="Subtotal" value={subtotal} colors={colors} />
              {tax > 0 ? <Totals label={`Tax (${Math.round((taxRate || 0) * 100)}%)`} value={tax} colors={colors} /> : null}
              {service > 0 ? <Totals label={`Service (${Math.round((serviceCharge || 0) * 100)}%)`} value={service} colors={colors} /> : null}
              <View style={styles.totalRow}>
                <Text style={[styles.grand, { color: colors.foreground }]}>Grand Total</Text>
                <Text style={[styles.grand, { color: colors.foreground }]}>₹{grand.toLocaleString("en-IN")}</Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <Pressable
            disabled={busy || cart.items.length === 0}
            onPress={onSend}
            style={[styles.cta, { backgroundColor: cart.items.length === 0 ? colors.muted : colors.primary, opacity: busy ? 0.7 : 1 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="flame-outline" size={18} color="#fff" />
                <Text style={styles.ctaText}>{primaryLabel}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Totals({ label, value, colors }: { label: string; value: number; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.totalValue, { color: colors.foreground }]}>₹{value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "85%", borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8 },
  header: { flexDirection: "row", alignItems: "center", padding: 16, paddingBottom: 8 },
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold" },
  close: { padding: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1 },
  lineName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  mod: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  note: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 4 },
  addNote: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 4 },
  noteInput: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6, marginTop: 4, fontSize: 12 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepBtn: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  qty: { fontSize: 13, fontFamily: "Inter_700Bold", minWidth: 16, textAlign: "center" },
  lineTotal: { fontSize: 14, fontFamily: "Inter_700Bold", minWidth: 60, textAlign: "right" },
  totals: { borderTopWidth: 1, marginTop: 10, paddingTop: 12, gap: 6 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  totalValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  grand: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  footer: { padding: 12, borderTopWidth: 1 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  ctaText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});
