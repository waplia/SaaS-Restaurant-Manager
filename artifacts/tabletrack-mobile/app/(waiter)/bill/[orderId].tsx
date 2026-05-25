import React, { useState } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, Alert, ScrollView, Platform, Share,
} from "react-native";
import { useLocalSearchParams, useNavigation, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  getOrder, getGetOrderQueryKey,
  useUpdateOrder, usePayOrder,
} from "@workspace/api-client-react";
import type { OrderDetail } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

const PAYMENT_METHODS = [
  { key: "cash", label: "Cash", icon: "cash-outline" as const },
  { key: "card", label: "Card", icon: "card-outline" as const },
  { key: "upi", label: "UPI", icon: "phone-portrait-outline" as const },
];

export default function BillScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const { restaurantId } = useAuth();
  const isWeb = Platform.OS === "web";
  const id = Number(orderId);

  const [selectedPayment, setSelectedPayment] = useState("cash");
  const [confirming, setConfirming] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: getGetOrderQueryKey(restaurantId, id),
    queryFn: () => getOrder(restaurantId, id),
    enabled: !!id,
  });

  const updateOrder = useUpdateOrder();
  const payOrder = usePayOrder();

  const order = data as OrderDetail | null;

  React.useEffect(() => {
    navigation.setOptions({ title: `Bill — Order #${(order as { orderNumber?: string } | null)?.orderNumber ?? id}` });
  }, [order, id]);

  const handleConfirmPayment = () => {
    if (!order) return;
    Alert.alert(
      "Confirm Payment",
      `Mark this order as paid via ${PAYMENT_METHODS.find((m) => m.key === selectedPayment)?.label ?? selectedPayment}?\n\nTotal: ₹${Number(order.totalAmount).toLocaleString()}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            setConfirming(true);
            try {
              await payOrder.mutateAsync({
                restaurantId,
                id: order.id,
                data: { paymentMethod: selectedPayment as "cash" | "card" | "upi" },
              });
              await updateOrder.mutateAsync({
                restaurantId,
                id: order.id,
                data: { status: "completed" },
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              qc.invalidateQueries({ queryKey: getGetOrderQueryKey(restaurantId, id) });
              Alert.alert("Payment Confirmed!", `Order #${(order as { orderNumber?: string }).orderNumber} marked as paid.`, [
                { text: "OK", onPress: () => router.back() },
              ]);
            } catch {
              Alert.alert("Error", "Could not confirm payment. Please try again.");
            } finally {
              setConfirming(false);
            }
          },
        },
      ]
    );
  };

  const handlePrintBill = async () => {
    if (!order) return;
    type BillItem = { id: number; menuItemName: string; quantity: number; totalPrice?: string; unitPrice?: string };
    const items = (order.items ?? []) as BillItem[];
    const lines = items.map(it => `• ${it.menuItemName} x${it.quantity}  ₹${Number(it.totalPrice ?? it.unitPrice).toLocaleString()}`).join("\n");
    const orderNumber = (order as { orderNumber?: string }).orderNumber ?? id;
    const subtotal = Number(order.subtotal ?? order.totalAmount);
    const tax = Number((order as { taxAmount?: string }).taxAmount ?? 0);
    const discount = Number((order as { discountAmount?: string }).discountAmount ?? 0);
    const total = Number(order.totalAmount);
    const message =
      `Order #${orderNumber}\n` +
      `------------------------------\n` +
      `${lines}\n` +
      `------------------------------\n` +
      `Subtotal: ₹${subtotal.toLocaleString()}\n` +
      (tax > 0 ? `Tax: ₹${tax.toFixed(2)}\n` : "") +
      (discount > 0 ? `Discount: -₹${discount.toFixed(2)}\n` : "") +
      `Total: ₹${total.toLocaleString()}\n\n` +
      `Thank you for dining with us!`;
    try {
      await Share.share({ message, title: `Bill — Order #${orderNumber}` });
    } catch {
      Alert.alert("Share Bill", "Could not open the share sheet.");
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>Order not found</Text>
        </View>
      </View>
    );
  }

  const isPaid = (order as { paymentStatus?: string }).paymentStatus === "paid";
  type BillItem = { id: number; menuItemName: string; quantity: number; totalPrice?: string; unitPrice?: string; notes?: string | null; appliedRule?: { id: number; name: string; ruleType: string; originalUnitPrice: string; adjustedUnitPrice: string } | null };
  const items = (order.items ?? []) as BillItem[];
  const subtotal = Number(order.subtotal ?? order.totalAmount);
  const taxAmount = Number((order as { taxAmount?: string }).taxAmount ?? 0);
  const discountAmount = Number((order as { discountAmount?: string }).discountAmount ?? 0);
  const totalAmount = Number(order.totalAmount);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: (isWeb ? 16 : insets.top) + 16,
            paddingBottom: (isWeb ? 34 : insets.bottom) + 24,
          },
        ]}
      >
        {!isPaid && (
          <View style={[styles.paymentSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Payment Method</Text>
            <View style={styles.paymentMethods}>
              {PAYMENT_METHODS.map((m) => (
                <Pressable
                  key={m.key}
                  onPress={() => setSelectedPayment(m.key)}
                  style={[
                    styles.methodBtn,
                    {
                      borderColor: selectedPayment === m.key ? colors.primary : colors.border,
                      backgroundColor: selectedPayment === m.key ? colors.primary + "15" : colors.muted,
                    },
                  ]}
                >
                  <Ionicons
                    name={m.icon}
                    size={20}
                    color={selectedPayment === m.key ? colors.primary : colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.methodLabel,
                      { color: selectedPayment === m.key ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {m.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.confirmBtn,
                { backgroundColor: colors.primary, opacity: pressed || confirming ? 0.8 : 1, marginTop: 4 },
              ]}
              onPress={handleConfirmPayment}
              disabled={confirming}
            >
              {confirming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={styles.confirmBtnText}>Confirm Payment</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.printBtn,
                { borderColor: colors.border, opacity: pressed ? 0.7 : 1, justifyContent: "center" },
              ]}
              onPress={handlePrintBill}
            >
              <Ionicons name="print-outline" size={18} color={colors.foreground} />
              <Text style={[styles.printBtnText, { color: colors.foreground }]}>Print Bill</Text>
            </Pressable>
          </View>
        )}

        {isPaid && (
          <Pressable
            style={({ pressed }) => [
              styles.confirmBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back-outline" size={18} color="#fff" />
            <Text style={styles.confirmBtnText}>Back to Tables</Text>
          </Pressable>
        )}

        <View style={[styles.billCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.billHeader}>
            <Ionicons name="receipt-outline" size={20} color={colors.primary} />
            <Text style={[styles.billTitle, { color: colors.foreground }]}>
              Order #{(order as { orderNumber?: string }).orderNumber ?? id}
            </Text>
            {isPaid && (
              <View style={[styles.paidBadge, { backgroundColor: "#22c55e20" }]}>
                <Text style={styles.paidText}>PAID</Text>
              </View>
            )}
          </View>

          <FlatList
            scrollEnabled={false}
            data={items}
            keyExtractor={(item) => String(item.id)}
            ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
            renderItem={({ item }) => (
              <View style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={[styles.itemName, { color: colors.foreground }]}>{item.menuItemName}</Text>
                  {item.appliedRule ? (
                    <Text style={[styles.itemNote, { color: "#10b981" }]} numberOfLines={1}>
                      {item.appliedRule.name} · ₹{Number(item.appliedRule.originalUnitPrice).toFixed(2)} → ₹{Number(item.appliedRule.adjustedUnitPrice).toFixed(2)}
                    </Text>
                  ) : null}
                  {item.notes ? (
                    <Text style={[styles.itemNote, { color: colors.mutedForeground }]}>{item.notes}</Text>
                  ) : null}
                </View>
                <Text style={[styles.itemQty, { color: colors.mutedForeground }]}>×{item.quantity}</Text>
                <Text style={[styles.itemPrice, { color: colors.foreground }]}>
                  ₹{Number(item.totalPrice ?? item.unitPrice).toLocaleString()}
                </Text>
              </View>
            )}
          />

          <View style={[styles.totalsSection, { borderTopColor: colors.border }]}>
            {subtotal !== totalAmount && (
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Subtotal</Text>
                <Text style={[styles.totalValue, { color: colors.foreground }]}>₹{subtotal.toLocaleString()}</Text>
              </View>
            )}
            {taxAmount > 0 && (
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Tax</Text>
                <Text style={[styles.totalValue, { color: colors.foreground }]}>₹{taxAmount.toFixed(2)}</Text>
              </View>
            )}
            {discountAmount > 0 && (
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Discount</Text>
                <Text style={[styles.totalValue, { color: "#22c55e" }]}>-₹{discountAmount.toFixed(2)}</Text>
              </View>
            )}
            <View style={[styles.totalRow, styles.grandTotalRow]}>
              <Text style={[styles.grandTotalLabel, { color: colors.foreground }]}>Total</Text>
              <Text style={[styles.grandTotalValue, { color: colors.primary }]}>₹{totalAmount.toLocaleString()}</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  billCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  billHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, paddingBottom: 12 },
  billTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  paidBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  paidText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#22c55e" },
  separator: { height: 1, marginHorizontal: 16 },
  itemRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  itemNote: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  itemQty: { fontSize: 13, fontFamily: "Inter_400Regular", minWidth: 24, textAlign: "center" },
  itemPrice: { fontSize: 13, fontFamily: "Inter_600SemiBold", minWidth: 64, textAlign: "right" },
  totalsSection: { borderTopWidth: 1, padding: 16, gap: 6 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  totalValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  grandTotalRow: { marginTop: 6, paddingTop: 6 },
  grandTotalLabel: { fontSize: 16, fontFamily: "Inter_700Bold" },
  grandTotalValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  paymentSection: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  paymentMethods: { flexDirection: "row", gap: 10 },
  methodBtn: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5 },
  methodLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
  printBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 12, borderWidth: 1 },
  printBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  confirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 12, marginBottom: 4 },
  confirmBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
