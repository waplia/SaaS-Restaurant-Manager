import React, { useState } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, Alert, Platform,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useCreatePublicOrder } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useCart } from "@/context/CartContext";
import { EmptyState } from "@/components/EmptyState";

export default function CartScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { cart, updateQuantity, clearCart, total, itemCount } = useCart();
  const [placing, setPlacing] = useState(false);
  const isWeb = Platform.OS === "web";

  const createPublicOrder = useCreatePublicOrder();

  const handlePlaceOrder = async () => {
    if (cart.items.length === 0) return;
    setPlacing(true);
    try {
      const result = await createPublicOrder.mutateAsync({
        data: {
          restaurantId: cart.restaurantId ?? 1,
          tableId: cart.tableId ?? 1,
          items: cart.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      clearCart();
      router.replace(`/(customer)/track?orderId=${result.orderId}&orderNumber=${result.orderNumber}` as `/${string}`);
    } catch {
      Alert.alert("Order Failed", "Could not place your order. Please try again.");
    } finally {
      setPlacing(false);
    }
  };

  if (cart.items.length === 0) {
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

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
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
            <Text style={[styles.subTotal, { color: colors.foreground }]}>₹{(item.price * item.quantity).toLocaleString()}</Text>
          </View>
        )}
      />

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: isWeb ? 34 : insets.bottom }]}>
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>{itemCount} items</Text>
          <Text style={[styles.totalAmount, { color: colors.foreground }]}>₹{total.toLocaleString()}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.placeBtn, { backgroundColor: colors.primary, opacity: pressed || placing ? 0.8 : 1 }]}
          onPress={handlePlaceOrder}
          disabled={placing}
        >
          {placing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.placeBtnText}>Place Order</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  placeBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
