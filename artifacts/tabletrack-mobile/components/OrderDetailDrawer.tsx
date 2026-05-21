import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Animated, Dimensions, ActivityIndicator,
  ScrollView, BackHandler, Alert, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  getOrder, getGetOrderQueryKey, getListOrdersQueryKey,
  useUpdateOrder, usePayOrder,
} from "@workspace/api-client-react";
import type { OrderDetail } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

const STATUS_FLOW: Record<string, string> = {
  pending: "in_progress",
  confirmed: "preparing",
  in_progress: "ready",
  preparing: "ready",
  ready: "served",
  served: "completed",
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: "#fff7ed", text: "#c2410c" },
  confirmed: { bg: "#eff6ff", text: "#1d4ed8" },
  in_progress: { bg: "#eff6ff", text: "#1d4ed8" },
  preparing: { bg: "#fff7ed", text: "#c2410c" },
  ready: { bg: "#faf5ff", text: "#7e22ce" },
  served: { bg: "#f9fafb", text: "#6b7280" },
  completed: { bg: "#f0fdf4", text: "#15803d" },
  cancelled: { bg: "#fef2f2", text: "#b91c1c" },
};

const PAYMENT_METHODS = [
  { key: "cash", label: "Cash", icon: "cash-outline" as const },
  { key: "card", label: "Card", icon: "card-outline" as const },
  { key: "upi", label: "UPI", icon: "phone-portrait-outline" as const },
];

interface OrderDetailDrawerProps {
  orderId: number | null;
  onClose: () => void;
}

export function OrderDetailDrawer({ orderId, onClose }: OrderDetailDrawerProps) {
  const colors = useColors();
  const qc = useQueryClient();
  const { restaurantId } = useAuth();
  const screenW = Dimensions.get("window").width;
  const drawerW = Math.min(420, screenW);
  const slide = useRef(new Animated.Value(drawerW)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const isOpen = orderId !== null;
  const [mounted, setMounted] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState("cash");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: getGetOrderQueryKey(restaurantId, orderId ?? 0),
    queryFn: () => getOrder(restaurantId, orderId as number),
    enabled: isOpen,
  });

  const order = data as OrderDetail | null;
  const updateOrder = useUpdateOrder();
  const payOrder = usePayOrder();

  useEffect(() => {
    if (isOpen) setMounted(true);
    Animated.parallel([
      Animated.timing(slide, {
        toValue: isOpen ? 0 : drawerW,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: isOpen ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && !isOpen) setMounted(false);
    });
  }, [isOpen, drawerW, slide, fade]);

  useEffect(() => {
    if (!isOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [isOpen, onClose]);

  const refreshLists = () => {
    if (!orderId) return;
    qc.invalidateQueries({ queryKey: getGetOrderQueryKey(restaurantId, orderId) });
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey(restaurantId) });
  };

  const handleAdvance = async () => {
    if (!order) return;
    const next = STATUS_FLOW[order.status];
    if (!next) return;
    setBusy(true);
    try {
      await updateOrder.mutateAsync({ restaurantId, id: order.id, data: { status: next } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshLists();
    } catch {
      Alert.alert("Update failed", "Could not advance the order.");
    } finally {
      setBusy(false);
    }
  };

  const handlePay = () => {
    if (!order) return;
    Alert.alert(
      "Confirm Payment",
      `Mark this order as paid via ${PAYMENT_METHODS.find((m) => m.key === selectedPayment)?.label ?? selectedPayment}?\n\nTotal: ₹${Number(order.totalAmount).toLocaleString()}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            setBusy(true);
            try {
              await payOrder.mutateAsync({
                restaurantId,
                id: order.id,
                data: { paymentMethod: selectedPayment as "cash" | "card" | "upi" },
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              refreshLists();
              onClose();
            } catch {
              Alert.alert("Payment failed", "Could not record payment.");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleCancel = () => {
    if (!order) return;
    Alert.alert("Cancel Order", "Are you sure?", [
      { text: "Back", style: "cancel" },
      {
        text: "Cancel Order",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await updateOrder.mutateAsync({ restaurantId, id: order.id, data: { status: "cancelled" } });
            refreshLists();
            onClose();
          } catch {
            Alert.alert("Failed", "Could not cancel the order.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handlePriority = async () => {
    if (!order) return;
    setBusy(true);
    try {
      await updateOrder.mutateAsync({
        restaurantId,
        id: order.id,
        data: { isPriority: !(order as { isPriority?: boolean }).isPriority },
      });
      refreshLists();
    } catch {
      Alert.alert("Failed", "Could not update priority.");
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen && !mounted) return null;

  type BillItem = { id: number; menuItemName: string; quantity: number; totalPrice?: string; unitPrice?: string; notes?: string | null };
  const items = (order?.items ?? []) as BillItem[];
  const isPaid = (order as { paymentStatus?: string } | null)?.paymentStatus === "paid";
  const next = order ? STATUS_FLOW[order.status] : null;
  const canAdvance = order && order.status !== "completed" && order.status !== "cancelled" && next;
  const sc = order ? STATUS_COLORS[order.status] ?? STATUS_COLORS.pending : STATUS_COLORS.pending;
  const isPriority = (order as { isPriority?: boolean } | null)?.isPriority;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={isOpen ? "auto" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)", opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.drawer,
          {
            width: drawerW,
            backgroundColor: colors.background,
            borderLeftColor: colors.border,
            transform: [{ translateX: slide }],
          },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "ios" ? 50 : 20 }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {order ? `#${order.orderNumber}` : "Order"}
          </Text>
          {isPriority && <Ionicons name="flag" size={16} color="#f97316" style={{ marginLeft: 6 }} />}
        </View>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError || !order ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={36} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", marginTop: 8 }}>
              {isError ? "Couldn't load this order" : "Order not found"}
            </Text>
            {isError && (
              <Pressable
                onPress={() => refetch()}
                style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>Retry</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.body}>
              <View style={styles.metaRow}>
                <View style={[styles.badge, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.badgeText, { color: sc.text }]}>{order.status.replace("_", " ")}</Text>
                </View>
                <Text style={[styles.metaText, { color: isPaid ? "#15803d" : "#c2410c" }]}>
                  {isPaid ? "Paid" : "Unpaid"}
                </Text>
              </View>
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {order.tableId ? `Table ${order.tableId}` : (order.orderType ?? "").replace("_", " ")}
                {order.createdAt ? ` · ${new Date(order.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
              </Text>
              {order.customerName ? (
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>Customer: {order.customerName}</Text>
              ) : null}

              <View style={[styles.section, { borderTopColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Items</Text>
                {items.map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemName, { color: colors.foreground }]}>
                        {item.menuItemName} <Text style={{ color: colors.mutedForeground }}>×{item.quantity}</Text>
                      </Text>
                      {item.notes ? (
                        <Text style={[styles.itemNote, { color: colors.mutedForeground }]}>{item.notes}</Text>
                      ) : null}
                    </View>
                    <Text style={[styles.itemPrice, { color: colors.foreground }]}>
                      ₹{Number(item.totalPrice ?? item.unitPrice ?? 0).toLocaleString()}
                    </Text>
                  </View>
                ))}
                {items.length === 0 && (
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>No items</Text>
                )}
              </View>

              <View style={[styles.section, { borderTopColor: colors.border }]}>
                {order.subtotal ? (
                  <View style={styles.totalRow}>
                    <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Subtotal</Text>
                    <Text style={[styles.totalValue, { color: colors.foreground }]}>₹{Number(order.subtotal).toLocaleString()}</Text>
                  </View>
                ) : null}
                {Number((order as { taxAmount?: string }).taxAmount ?? 0) > 0 && (
                  <View style={styles.totalRow}>
                    <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Tax</Text>
                    <Text style={[styles.totalValue, { color: colors.foreground }]}>
                      ₹{Number((order as { taxAmount?: string }).taxAmount).toFixed(2)}
                    </Text>
                  </View>
                )}
                <View style={[styles.totalRow, styles.grandTotalRow, { borderTopColor: colors.border }]}>
                  <Text style={[styles.grandLabel, { color: colors.foreground }]}>Total</Text>
                  <Text style={[styles.grandValue, { color: colors.primary }]}>
                    ₹{Number(order.totalAmount).toLocaleString()}
                  </Text>
                </View>
              </View>

              {!isPaid && order.status !== "cancelled" && (
                <View style={[styles.section, { borderTopColor: colors.border }]}>
                  <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Payment Method</Text>
                  <View style={styles.methods}>
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
                          size={18}
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

                  {/* Action buttons live directly below the payment options
                      so they're never hidden behind the device tab/gesture
                      bar. Previously they were in a fixed footer that was
                      covered by the bottom navigation. */}
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { backgroundColor: colors.primary, opacity: pressed || busy ? 0.7 : 1, marginTop: 4 },
                    ]}
                    onPress={handlePay}
                    disabled={busy}
                  >
                    <Ionicons name="card-outline" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Take Payment</Text>
                  </Pressable>
                </View>
              )}

              <View style={[styles.section, { borderTopColor: colors.border, gap: 8 }]}>
                {canAdvance && (
                  <Pressable
                    style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed || busy ? 0.7 : 1 }]}
                    onPress={handleAdvance}
                    disabled={busy}
                  >
                    <Ionicons name="arrow-forward" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Mark {next}</Text>
                  </Pressable>
                )}
                <View style={styles.footerRow}>
                  <Pressable style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={handlePriority} disabled={busy}>
                    <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                      {isPriority ? "Unmark" : "Priority"}
                    </Text>
                  </Pressable>
                  {order.status !== "cancelled" && order.status !== "completed" && (
                    <Pressable style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={handleCancel} disabled={busy}>
                      <Text style={[styles.secondaryBtnText, { color: "#b91c1c" }]}>Cancel</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </ScrollView>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    borderLeftWidth: 1,
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  closeBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 12, paddingBottom: 120 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metaText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  section: { borderTopWidth: 1, paddingTop: 12, marginTop: 4, gap: 8 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 4 },
  itemName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  itemNote: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  itemPrice: { fontSize: 14, fontFamily: "Inter_500Medium" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  totalValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  grandTotalRow: { borderTopWidth: 1, paddingTop: 8, marginTop: 4 },
  grandLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  grandValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  methods: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  methodBtn: {
    flex: 1, minWidth: 90, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderWidth: 2, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8,
  },
  methodLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  footer: { borderTopWidth: 1, padding: 12, gap: 8 },
  footerRow: { flexDirection: "row", gap: 8 },
  primaryBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, borderRadius: 10,
  },
  primaryBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: {
    flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 10,
    borderRadius: 10, borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
