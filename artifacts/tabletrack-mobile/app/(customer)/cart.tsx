import React, { useState } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, Alert, Linking, Platform,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useCreatePublicOrder } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useCart } from "@/context/CartContext";
import { useNetworkStatus } from "@/hooks/useOfflineCache";
import { EmptyState } from "@/components/EmptyState";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

interface PublicOrderFull {
  orderId: number;
  orderNumber: string;
  status: string;
  totalAmount: string;
  guestToken: string;
}

export default function CartScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { cart, updateQuantity, clearCart, total, itemCount } = useCart();
  const [placing, setPlacing] = useState(false);
  const [paymentStep, setPaymentStep] = useState<"cart" | "pay">("cart");
  const [orderResult, setOrderResult] = useState<PublicOrderFull | null>(null);
  const [payingStripe, setPayingStripe] = useState(false);
  const isWeb = Platform.OS === "web";
  const isOnline = useNetworkStatus();

  const createPublicOrder = useCreatePublicOrder();

  const restaurantId = cart.restaurantId;
  const tableId = cart.tableId;

  if (!restaurantId || !tableId) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="alert-circle-outline"
          title="No table selected"
          message="Please scan a table QR code before ordering."
          actionLabel="Scan QR Code"
          onAction={() => router.replace({ pathname: "/(customer)" })}
        />
      </View>
    );
  }

  const handlePlaceOrder = async () => {
    if (cart.items.length === 0) return;
    if (!isOnline) {
      Alert.alert("No Connection", "You appear to be offline. Please check your internet connection and try again.");
      return;
    }
    setPlacing(true);
    try {
      const result = (await createPublicOrder.mutateAsync({
        data: {
          restaurantId,
          tableId,
          items: cart.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
        },
      })) as PublicOrderFull;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOrderResult(result);
      setPaymentStep("pay");
    } catch {
      Alert.alert("Order Failed", "Could not place your order. Please try again.");
    } finally {
      setPlacing(false);
    }
  };

  const handleGetPaymentIntent = async () => {
    if (!orderResult) return;
    setPayingStripe(true);
    try {
      const baseUrl = `${getApiBaseUrl()}`;
      const resp = await fetch(
        `${baseUrl}/api/public/orders/${orderResult.orderId}/payment-intent?token=${orderResult.guestToken}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const data = (await resp.json()) as { mode: string; checkoutUrl?: string | null; totalAmount: string; clientSecret?: string | null; intentId?: string };

      if (data.mode === "live" && data.checkoutUrl) {
        clearCart();
        await Linking.openURL(data.checkoutUrl);
        router.replace({
          pathname: "/(customer)/track",
          params: { orderId: String(orderResult.orderId), orderNumber: orderResult.orderNumber, guestToken: orderResult.guestToken, restaurantId: String(restaurantId), tableId: String(tableId) },
        });
      } else {
        const demoResp = await fetch(
          `${baseUrl}/api/public/orders/${orderResult.orderId}/pay?token=${orderResult.guestToken}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intentId: data.intentId ?? `demo_pi_${orderResult.orderId}_${Date.now()}`, paymentMethod: "cash" }),
          }
        );
        if (demoResp.ok) {
          clearCart();
          router.replace({
            pathname: "/(customer)/track",
            params: { orderId: String(orderResult.orderId), orderNumber: orderResult.orderNumber, guestToken: orderResult.guestToken, restaurantId: String(restaurantId), tableId: String(tableId) },
          });
        } else {
          Alert.alert("Payment Failed", "Could not process payment. Please try again.");
        }
      }
    } catch {
      Alert.alert("Error", "Payment failed. Please try again.");
    } finally {
      setPayingStripe(false);
    }
  };

  const handleCashPayment = () => {
    if (!orderResult) return;
    clearCart();
    router.replace({
      pathname: "/(customer)/track",
      params: { orderId: String(orderResult.orderId), orderNumber: orderResult.orderNumber, guestToken: orderResult.guestToken, restaurantId: String(restaurantId), tableId: String(tableId) },
    });
  };

  if (cart.items.length === 0 && paymentStep === "cart") {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="cart-outline"
          title="Your cart is empty"
          message="Go back to the menu to add items."
          actionLabel="Browse Menu"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  if (paymentStep === "pay" && orderResult) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.payHeader, { paddingTop: isWeb ? 67 + 16 : insets.top + 16, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={[styles.successIcon, { backgroundColor: "#22c55e20" }]}>
            <Ionicons name="checkmark-circle" size={32} color="#22c55e" />
          </View>
          <Text style={[styles.payTitle, { color: colors.foreground }]}>Order Placed!</Text>
          <Text style={[styles.paySubtitle, { color: colors.mutedForeground }]}>
            #{orderResult.orderNumber} · ₹{Number(orderResult.totalAmount).toLocaleString()}
          </Text>
        </View>

        <View style={[styles.payOptions, { paddingBottom: isWeb ? 34 : insets.bottom }]}>
          <Text style={[styles.payLabel, { color: colors.mutedForeground }]}>Choose how to pay</Text>

          <Pressable
            style={({ pressed }) => [styles.payBtn, { backgroundColor: colors.primary, opacity: pressed || payingStripe ? 0.8 : 1 }]}
            onPress={handleGetPaymentIntent}
            disabled={payingStripe}
          >
            {payingStripe ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="card-outline" size={20} color="#fff" />
                <Text style={styles.payBtnText}>Pay Online (Card / UPI)</Text>
              </>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.payBtnSecondary, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}
            onPress={handleCashPayment}
          >
            <Ionicons name="cash-outline" size={20} color={colors.foreground} />
            <Text style={[styles.payBtnSecondaryText, { color: colors.foreground }]}>Pay by Cash at Counter</Text>
          </Pressable>

          <Text style={[styles.payNote, { color: colors.mutedForeground }]}>
            Your order has been sent to the kitchen. Track its progress on the next screen.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {!isOnline && (
        <View style={[styles.offlineBanner, { backgroundColor: "#f59e0b" }]}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>You're offline — ordering is unavailable</Text>
        </View>
      )}
      <FlatList
        data={cart.items}
        keyExtractor={(item) => String(item.menuItemId)}
        contentContainerStyle={[styles.list, { paddingBottom: 120 }]}
        renderItem={({ item }) => (
          <View style={[styles.cartRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cartInfo}>
              <Text style={[styles.cartName, { color: colors.foreground }]}>{item.name}</Text>
              <Text style={[styles.cartPrice, { color: colors.primary }]}>₹{item.price.toLocaleString()}</Text>
            </View>
            <View style={styles.qtyControls}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  updateQuantity(item.menuItemId, -1);
                }}
                style={[styles.qtyBtn, { backgroundColor: colors.muted }]}
              >
                <Ionicons name={item.quantity === 1 ? "trash-outline" : "remove"} size={14} color={colors.foreground} />
              </Pressable>
              <Text style={[styles.qtyText, { color: colors.foreground }]}>{item.quantity}</Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  updateQuantity(item.menuItemId, 1);
                }}
                style={[styles.qtyBtn, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="add" size={14} color="#fff" />
              </Pressable>
            </View>
            <Text style={[styles.subTotal, { color: colors.foreground }]}>
              ₹{(item.price * item.quantity).toLocaleString()}
            </Text>
          </View>
        )}
      />

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: isWeb ? 34 : insets.bottom }]}>
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>{itemCount} items</Text>
          <Text style={[styles.totalAmount, { color: colors.foreground }]}>₹{total.toLocaleString()}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.placeBtn,
            { backgroundColor: isOnline ? colors.primary : colors.muted, opacity: pressed || placing ? 0.8 : 1 },
          ]}
          onPress={handlePlaceOrder}
          disabled={placing || !isOnline}
        >
          {placing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.placeBtnText, { color: isOnline ? "#fff" : colors.mutedForeground }]}>
              {isOnline ? "Place Order" : "Offline"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  offlineBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
  offlineText: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium" },
  list: { padding: 16, gap: 8 },
  cartRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  cartInfo: { flex: 1, gap: 2 },
  cartName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cartPrice: { fontSize: 12, fontFamily: "Inter_500Medium" },
  qtyControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  qtyText: { fontSize: 15, fontFamily: "Inter_700Bold", minWidth: 20, textAlign: "center" },
  subTotal: { fontSize: 14, fontFamily: "Inter_700Bold", minWidth: 56, textAlign: "right" },
  footer: { borderTopWidth: 1, padding: 16, paddingTop: 12, gap: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  totalAmount: { fontSize: 20, fontFamily: "Inter_700Bold" },
  placeBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  placeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  payHeader: { alignItems: "center", gap: 8, paddingHorizontal: 20, paddingBottom: 20, borderBottomWidth: 1 },
  successIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  payTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  paySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular" },
  payOptions: { flex: 1, padding: 20, gap: 12, justifyContent: "center" },
  payLabel: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center", marginBottom: 4 },
  payBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 12, paddingVertical: 16 },
  payBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  payBtnSecondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 12, paddingVertical: 14, borderWidth: 1 },
  payBtnSecondaryText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  payNote: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18, marginTop: 8 },
});
