import React, { useState, useEffect } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator,
  ScrollView, Alert, Platform,
} from "react-native";
import { useLocalSearchParams, useNavigation, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  listMenuCategories, getListMenuCategoriesQueryKey,
  listMenuItems, getListMenuItemsQueryKey,
  listOrders, getListOrdersQueryKey,
  useCreateOrder,
} from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import type { MenuCategory, MenuItem, Order } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { MenuItemCard } from "@/components/MenuItemCard";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";

interface CartItem {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
}

export default function WaiterOrderScreen() {
  const { tableId } = useLocalSearchParams<{ tableId: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const { restaurantId } = useAuth();
  const numTableId = Number(tableId);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sendingToKitchen, setSendingToKitchen] = useState(false);

  const { data: categories } = useQuery({
    queryKey: getListMenuCategoriesQueryKey(restaurantId),
    queryFn: () => listMenuCategories(restaurantId),
  });

  const menuParams = selectedCategoryId ? { categoryId: selectedCategoryId } : {};
  const { data: menuItems } = useQuery({
    queryKey: getListMenuItemsQueryKey(restaurantId, menuParams),
    queryFn: () => listMenuItems(restaurantId, menuParams),
    enabled: selectedCategoryId !== null,
  });

  const ordersParams = { tableId: numTableId, status: "pending,in_progress", limit: 1 };
  const { data: ordersData } = useQuery({
    queryKey: getListOrdersQueryKey(restaurantId, ordersParams),
    queryFn: () => listOrders(restaurantId, ordersParams),
  });

  const createOrder = useCreateOrder();
  const addItemMutation = useMutation({
    mutationFn: async ({ rid, id, data }: { rid: number; id: number; data: { menuItemId: number; quantity: number } }) => {
      const baseUrl = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
      const token = await SecureStore.getItemAsync("accessToken");
      const resp = await fetch(`${baseUrl}/api/restaurants/${rid}/orders/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify(data),
      });
      if (!resp.ok) throw new Error("Failed to add item to order");
      return resp.json();
    },
  });

  const categoryList = (Array.isArray(categories) ? categories : []) as MenuCategory[];
  const itemList = (Array.isArray(menuItems) ? menuItems : []) as MenuItem[];
  const activeOrders = ((ordersData as { orders?: Order[] } | null)?.orders ?? (Array.isArray(ordersData) ? ordersData : [])) as Order[];
  const activeOrder = activeOrders[0] ?? null;

  useEffect(() => {
    if (categoryList.length > 0 && selectedCategoryId === null) {
      setSelectedCategoryId(categoryList[0].id);
    }
  }, [categoryList.length]);

  useEffect(() => {
    navigation.setOptions({ title: `Table ${tableId}` });
  }, [tableId]);

  const getQty = (menuItemId: number) => cart.find((i) => i.menuItemId === menuItemId)?.quantity ?? 0;

  const updateCart = (item: MenuItem, delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCart((prev) => {
      const existing = prev.find((i) => i.menuItemId === item.id);
      if (existing) {
        const newQty = existing.quantity + delta;
        if (newQty <= 0) return prev.filter((i) => i.menuItemId !== item.id);
        return prev.map((i) => (i.menuItemId === item.id ? { ...i, quantity: newQty } : i));
      }
      if (delta <= 0) return prev;
      return [...prev, { menuItemId: item.id, name: item.name, price: Number(item.price), quantity: 1 }];
    });
  };

  const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
  const totalAmount = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const handleSendToKitchen = async () => {
    if (cart.length === 0) {
      Alert.alert("Empty Cart", "Add items before sending to kitchen.");
      return;
    }
    setSendingToKitchen(true);
    try {
      let orderId = activeOrder?.id;
      if (!orderId) {
        const newOrder = await createOrder.mutateAsync({
          restaurantId,
          data: { tableId: numTableId, orderType: "dine_in", items: [] },
        });
        orderId = newOrder.id;
      }
      for (const item of cart) {
        await addItemMutation.mutateAsync({
          rid: restaurantId,
          id: orderId!,
          data: { menuItemId: item.menuItemId, quantity: item.quantity },
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: getListOrdersQueryKey(restaurantId) });
      setCart([]);
      Alert.alert("Sent!", "Items sent to kitchen.");
    } catch {
      Alert.alert("Error", "Failed to send order to kitchen.");
    } finally {
      setSendingToKitchen(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {activeOrder ? (
        <Pressable
          style={[styles.activeOrderBanner, { backgroundColor: colors.accent, borderColor: colors.primary + "40" }]}
          onPress={() => router.push(`/(waiter)/bill/${activeOrder.id}` as any)}
        >
          <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
          <Text style={[styles.activeOrderText, { color: colors.primary }]}>
            Active order #{(activeOrder as unknown as { orderNumber?: string }).orderNumber ?? activeOrder.id}
          </Text>
          <View style={styles.billChip}>
            <Ionicons name="receipt-outline" size={13} color={colors.primary} />
            <Text style={[styles.billChipText, { color: colors.primary }]}>View Bill</Text>
          </View>
        </Pressable>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categories}
        style={[styles.categoryBar, { borderBottomColor: colors.border }]}
      >
        {categoryList.map((cat) => (
          <Pressable
            key={cat.id}
            onPress={() => setSelectedCategoryId(cat.id)}
            style={[
              styles.catPill,
              {
                backgroundColor: selectedCategoryId === cat.id ? colors.primary : colors.muted,
                borderColor: selectedCategoryId === cat.id ? colors.primary : colors.border,
              },
            ]}
          >
            <Text style={[styles.catText, { color: selectedCategoryId === cat.id ? "#fff" : colors.mutedForeground }]}>
              {cat.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {itemList.length === 0 ? (
        <EmptyState icon="fast-food-outline" title="No items" message="No menu items in this category." />
      ) : (
        <FlatList
          data={itemList}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            styles.itemList,
            { paddingBottom: isWeb ? 34 + (totalItems > 0 ? 90 : 20) : insets.bottom + (totalItems > 0 ? 90 : 20) },
          ]}
          renderItem={({ item }) => (
            <MenuItemCard
              name={item.name}
              description={item.description}
              price={Number(item.price)}
              imageUrl={item.imageUrl}
              quantity={getQty(item.id)}
              isAvailable={item.isAvailable !== false}
              onAdd={() => updateCart(item, 1)}
              onRemove={() => updateCart(item, -1)}
            />
          )}
        />
      )}

      {totalItems > 0 ? (
        <View style={[styles.orderFooter, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: isWeb ? 34 : insets.bottom }]}>
          <View style={styles.orderSummary}>
            <Text style={[styles.orderSummaryLabel, { color: colors.mutedForeground }]}>{totalItems} items</Text>
            <Text style={[styles.orderSummaryTotal, { color: colors.foreground }]}>₹{totalAmount.toLocaleString()}</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.sendBtn, { backgroundColor: colors.primary, opacity: pressed || sendingToKitchen ? 0.8 : 1 }]}
            onPress={handleSendToKitchen}
            disabled={sendingToKitchen}
          >
            {sendingToKitchen ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="flame-outline" size={18} color="#fff" />
                <Text style={styles.sendBtnText}>Send to Kitchen</Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  activeOrderBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1 },
  activeOrderText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  categoryBar: { borderBottomWidth: 1, flexGrow: 0 },
  categories: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  catPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  catText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  itemList: { padding: 12 },
  orderFooter: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  orderSummary: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderSummaryLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  orderSummaryTotal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13, marginBottom: 4 },
  billChip: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: "auto" as const },
  billChipText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  sendBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
