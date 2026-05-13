import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator,
  ScrollView, Alert, Platform,
} from "react-native";
import { useLocalSearchParams, useNavigation, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { useNetworkStatus, useOfflineCache } from "@/hooks/useOfflineCache";

interface CartItem {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
}

interface QueuedOrder {
  tableId: number;
  items: CartItem[];
  queuedAt: number;
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
  const isOnline = useNetworkStatus();
  const wasOnlineRef = useRef(isOnline);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sendingToKitchen, setSendingToKitchen] = useState(false);
  const [offlineCategories, setOfflineCategories] = useState<MenuCategory[]>([]);
  const [offlineItems, setOfflineItems] = useState<MenuItem[]>([]);

  const catCacheKey = `menu_cats_${restaurantId}`;
  const itemsCacheKey = (catId: number) => `menu_items_${restaurantId}_${catId}`;
  const queueCacheKey = `offline_order_queue_${restaurantId}`;
  const { readCache: readCatCache, writeCache: writeCatCache } = useOfflineCache<MenuCategory[]>(catCacheKey);
  const { readCache: readQueueCache, writeCache: writeQueueCache, clearCache: clearQueueCache } = useOfflineCache<QueuedOrder[]>(queueCacheKey);

  const { data: categories, isSuccess: catsLoaded } = useQuery({
    queryKey: getListMenuCategoriesQueryKey(restaurantId),
    queryFn: () => listMenuCategories(restaurantId),
    enabled: isOnline,
    staleTime: 5 * 60 * 1000,
  });

  const menuParams = selectedCategoryId ? { categoryId: selectedCategoryId } : {};
  const { data: menuItems, isSuccess: itemsLoaded } = useQuery({
    queryKey: getListMenuItemsQueryKey(restaurantId, menuParams),
    queryFn: () => listMenuItems(restaurantId, menuParams),
    enabled: isOnline && selectedCategoryId !== null,
    staleTime: 5 * 60 * 1000,
  });

  const ordersParams = { tableId: numTableId, status: "pending,in_progress", limit: 1 };
  const { data: ordersData } = useQuery({
    queryKey: getListOrdersQueryKey(restaurantId, ordersParams),
    queryFn: () => listOrders(restaurantId, ordersParams),
    enabled: isOnline,
  });

  useEffect(() => {
    if (catsLoaded && categories) {
      const catList = (Array.isArray(categories) ? categories : []) as MenuCategory[];
      writeCatCache(catList);
    }
  }, [catsLoaded, categories]);

  useEffect(() => {
    if (itemsLoaded && menuItems && selectedCategoryId !== null) {
      const items = (Array.isArray(menuItems) ? menuItems : []) as MenuItem[];
      AsyncStorage.setItem(itemsCacheKey(selectedCategoryId), JSON.stringify({ ts: Date.now(), data: items })).catch(() => {});
    }
  }, [itemsLoaded, menuItems, selectedCategoryId]);

  useEffect(() => {
    if (!isOnline) {
      readCatCache().then((cats) => {
        if (cats && cats.length > 0) {
          setOfflineCategories(cats);
          if (selectedCategoryId === null) {
            setSelectedCategoryId(cats[0].id);
          }
        }
      });
    }
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline && selectedCategoryId !== null) {
      AsyncStorage.getItem(itemsCacheKey(selectedCategoryId)).then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as { ts: number; data: MenuItem[] };
          setOfflineItems(parsed.data ?? []);
        } catch {}
      });
    }
  }, [isOnline, selectedCategoryId]);

  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      flushOfflineQueue();
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline]);

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

  const categoryList = (isOnline
    ? (Array.isArray(categories) ? categories : [])
    : offlineCategories) as MenuCategory[];
  const itemList = (isOnline
    ? (Array.isArray(menuItems) ? menuItems : [])
    : offlineItems) as MenuItem[];
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

  const submitOrderItems = async (cartItems: CartItem[]): Promise<void> => {
    let orderId = activeOrder?.id;
    if (!orderId) {
      const newOrder = await createOrder.mutateAsync({
        restaurantId,
        data: { tableId: numTableId, orderType: "dine_in", items: [] },
      });
      orderId = newOrder.id;
    }
    for (const item of cartItems) {
      await addItemMutation.mutateAsync({
        rid: restaurantId,
        id: orderId!,
        data: { menuItemId: item.menuItemId, quantity: item.quantity },
      });
    }
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey(restaurantId) });
  };

  const flushOfflineQueue = async () => {
    const queue = await readQueueCache();
    if (!queue || queue.length === 0) return;
    let successCount = 0;
    const failed: QueuedOrder[] = [];
    for (const entry of queue) {
      try {
        await submitOrderItems(entry.items);
        successCount++;
      } catch {
        failed.push(entry);
      }
    }
    if (failed.length > 0) {
      await writeQueueCache(failed);
    } else {
      await clearQueueCache();
    }
    if (successCount > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Back Online", `${successCount} queued order${successCount > 1 ? "s" : ""} sent to kitchen.`);
    }
  };

  const handleSendToKitchen = async () => {
    if (cart.length === 0) {
      Alert.alert("Empty Cart", "Add items before sending to kitchen.");
      return;
    }
    setSendingToKitchen(true);
    try {
      if (!isOnline) {
        const existing = (await readQueueCache()) ?? [];
        await writeQueueCache([...existing, { tableId: numTableId, items: [...cart], queuedAt: Date.now() }]);
        setCart([]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("Saved Offline", "You're offline. The order will be sent to the kitchen automatically when you reconnect.");
        return;
      }
      await submitOrderItems(cart);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCart([]);
      Alert.alert("Sent!", "Items sent to kitchen.");
    } catch {
      Alert.alert("Error", "Failed to send order to kitchen.");
    } finally {
      setSendingToKitchen(false);
    }
  };

  const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
  const totalAmount = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {!isOnline && (
        <View style={[styles.offlineBanner, { backgroundColor: "#f59e0b" }]}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineBannerText}>Offline — showing cached menu. Orders will queue.</Text>
        </View>
      )}

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
        <EmptyState icon="fast-food-outline" title="No items" message={isOnline ? "No menu items in this category." : "No cached items. Connect to load menu."} />
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
            style={({ pressed }) => [styles.sendBtn, { backgroundColor: isOnline ? colors.primary : "#f59e0b", opacity: pressed || sendingToKitchen ? 0.8 : 1 }]}
            onPress={handleSendToKitchen}
            disabled={sendingToKitchen}
          >
            {sendingToKitchen ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name={isOnline ? "flame-outline" : "cloud-offline-outline"} size={18} color="#fff" />
                <Text style={styles.sendBtnText}>{isOnline ? "Send to Kitchen" : "Queue Order (Offline)"}</Text>
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
  offlineBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 6 },
  offlineBannerText: { fontSize: 11, color: "#fff", fontFamily: "Inter_500Medium", flex: 1 },
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
