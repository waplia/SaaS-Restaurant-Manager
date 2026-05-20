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
  getRestaurant, getGetRestaurantQueryKey,
} from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { MenuCategory, MenuItem, Order } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { MenuItemCard } from "@/components/MenuItemCard";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { useNetworkStatus, useOfflineCache } from "@/hooks/useOfflineCache";
import { VoiceOrderModal, type VoiceOrderResult } from "@/components/VoiceOrderModal";
import { ModifierBottomSheet } from "@/components/ModifierBottomSheet";
import type { CartModifier } from "@/context/CartContext";

interface CartLineModifier {
  modifierId: number;
  name: string;
  priceDelta: number;
}

interface CartItem {
  /** Stable per-line id so a single menu item with different mods is two lines. */
  lineId?: string;
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  modifiers?: CartLineModifier[];
  note?: string | null;
}

interface QueuedOrder {
  tableId: number;
  items: CartItem[];
  queuedAt: number;
  /**
   * Stable idempotency key generated when the order is first queued.
   * Sent as `X-Idempotency-Key` on every replay so the server can dedupe
   * if a prior attempt actually reached the DB but the response was lost.
   */
  idempotencyKey?: string;
  /** Per-line keys so individual /items writes can be deduped on retry. */
  itemKeys?: string[];
}

function mobileUid(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
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
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [checkingMods, setCheckingMods] = useState(false);

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

  const { data: restaurantInfo } = useQuery({
    queryKey: getGetRestaurantQueryKey(restaurantId),
    queryFn: () => getRestaurant(restaurantId),
    enabled: isOnline,
    staleTime: 5 * 60 * 1000,
  });
  const voiceOrderingEnabled = !!(restaurantInfo as { enableVoiceOrdering?: boolean } | undefined)?.enableVoiceOrdering;

  const { data: allMenuItemsData } = useQuery({
    queryKey: getListMenuItemsQueryKey(restaurantId, {}),
    queryFn: () => listMenuItems(restaurantId, {}),
    enabled: isOnline && voiceOrderingEnabled,
    staleTime: 5 * 60 * 1000,
  });
  const allMenuItems = (Array.isArray(allMenuItemsData) ? allMenuItemsData : []) as MenuItem[];

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
    // Use the shared customFetch wrapper so the request automatically picks up
    // the base URL, current auth token, and global 401 handling — matching
    // the rest of the app and avoiding silent stale-token failures.
    // Accepts an optional idempotency key so queued retries can dedupe
    // safely on the server when a previous attempt succeeded mid-flight.
    // Server expects `modifiers: [{ modifierId, quantity }]` (see
    // /restaurants/:rid/orders/:id/items in api-server) — `modifierIds` is
    // silently ignored, which is what was causing required-modifier validation
    // to fail with HTTP 400 on Send to Kitchen.
    mutationFn: ({ rid, id, data, idempotencyKey }: {
      rid: number; id: number;
      data: {
        menuItemId: number;
        quantity: number;
        modifiers?: Array<{ modifierId: number; quantity: number }>;
        notes?: string;
      };
      idempotencyKey?: string;
    }) =>
      customFetch(`/api/restaurants/${rid}/orders/${id}/items`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : undefined,
      }),
  });

  const categoryList = (isOnline
    ? (Array.isArray(categories) ? categories : [])
    : offlineCategories) as MenuCategory[];
  const itemList = (isOnline
    ? (Array.isArray(menuItems) ? menuItems : [])
    : offlineItems) as MenuItem[];
  // API returns `OrderList = { data: Order[], total }`; keep legacy shape
  // fallbacks so the active-order banner doesn't disappear if the contract
  // drifts.
  const activeOrders = (
    (ordersData as { data?: Order[]; orders?: Order[] } | null)?.data
    ?? (ordersData as { orders?: Order[] } | null)?.orders
    ?? (Array.isArray(ordersData) ? (ordersData as Order[]) : [])
  ) as Order[];
  const activeOrder = activeOrders[0] ?? null;

  useEffect(() => {
    if (categoryList.length > 0 && selectedCategoryId === null) {
      setSelectedCategoryId(categoryList[0].id);
    }
  }, [categoryList.length]);

  useEffect(() => {
    navigation.setOptions({ title: `Table ${tableId}` });
  }, [tableId]);

  const getQty = (menuItemId: number) =>
    cart.filter((i) => i.menuItemId === menuItemId).reduce((s, i) => s + i.quantity, 0);

  const addPlainLine = (item: MenuItem) => {
    setCart((prev) => {
      // Coalesce only into an existing line WITHOUT modifiers for the same item
      // — modifier-distinct lines must remain separate so kitchen sees the
      // correct customizations.
      const idx = prev.findIndex((i) => i.menuItemId === item.id && (i.modifiers?.length ?? 0) === 0);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [...prev, { lineId: mobileUid(), menuItemId: item.id, name: item.name, price: Number(item.price), quantity: 1 }];
    });
  };

  const addCustomizedLine = (item: MenuItem, mods: CartModifier[], note: string, qty: number) => {
    const lineMods: CartLineModifier[] = mods.map((m) => ({
      modifierId: m.modifierId,
      name: m.name,
      priceDelta: Number(m.priceDelta) || 0,
    }));
    const modsTotal = lineMods.reduce((s, m) => s + m.priceDelta, 0);
    setCart((prev) => [
      ...prev,
      {
        lineId: mobileUid(),
        menuItemId: item.id,
        name: item.name,
        price: Number(item.price) + modsTotal,
        quantity: Math.max(1, qty),
        modifiers: lineMods,
        note: note || undefined,
      },
    ]);
  };

  /**
   * On tap we don't know whether the item requires modifiers (the menu item
   * list response doesn't include that flag). Fetch the item's modifier groups
   * just-in-time — react-query caches the result so subsequent taps on the
   * same item are instant. If any group exists we open the picker; the server
   * enforces `is_required` minimums, which is what was causing Send to
   * Kitchen to fail with HTTP 400 when waiters bypassed customization.
   */
  const handleAdd = async (item: MenuItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isOnline) {
      addPlainLine(item);
      return;
    }
    setCheckingMods(true);
    try {
      const groups = await qc.fetchQuery({
        queryKey: ["item-modifier-groups", item.id],
        queryFn: () => customFetch<Array<{ id: number; modifiers?: unknown[] }>>(`/api/items/${item.id}/modifier-groups`).catch(() => []),
        staleTime: 5 * 60 * 1000,
      });
      if (Array.isArray(groups) && groups.length > 0) {
        setModifierItem(item);
        return;
      }
      addPlainLine(item);
    } catch {
      // If the lookup fails for any reason, still let the waiter add the item;
      // server will return a clear error on send if a required modifier is
      // missing.
      addPlainLine(item);
    } finally {
      setCheckingMods(false);
    }
  };

  const handleRemove = (item: MenuItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCart((prev) => {
      // Decrement the most-recently-added line for this item.
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].menuItemId === item.id) {
          const newQty = prev[i].quantity - 1;
          if (newQty <= 0) return prev.filter((_, idx) => idx !== i);
          return prev.map((l, idx) => (idx === i ? { ...l, quantity: newQty } : l));
        }
      }
      return prev;
    });
  };

  const submitOrderItems = async (
    cartItems: CartItem[],
    targetTableId: number,
    existingOrderId?: number,
    itemKeys?: string[],
    orderIdempotencyKey?: string,
  ): Promise<void> => {
    let orderId = existingOrderId;
    if (!orderId) {
      // When replaying a queued order we go through customFetch directly so
      // we can attach X-Idempotency-Key for the parent order create —
      // generated mutations from api-client-react don't expose header
      // overrides. The server can then dedupe if a previous attempt had
      // actually reached the DB but its response was lost mid-flight.
      if (orderIdempotencyKey) {
        const created = await customFetch<{ id: number }>(`/api/restaurants/${restaurantId}/orders`, {
          method: "POST",
          body: JSON.stringify({ tableId: targetTableId, orderType: "dine_in", items: [] }),
          headers: { "X-Idempotency-Key": orderIdempotencyKey },
        });
        orderId = created.id;
      } else {
        const newOrder = await createOrder.mutateAsync({
          restaurantId,
          data: { tableId: targetTableId, orderType: "dine_in", items: [] },
        });
        orderId = newOrder.id;
      }
    }
    for (let i = 0; i < cartItems.length; i++) {
      const item = cartItems[i];
      const mods = (item.modifiers ?? []).map((m) => ({ modifierId: m.modifierId, quantity: 1 }));
      await addItemMutation.mutateAsync({
        rid: restaurantId,
        id: orderId!,
        data: {
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          modifiers: mods.length ? mods : undefined,
          notes: item.note ?? undefined,
        },
        idempotencyKey: itemKeys?.[i],
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
        await submitOrderItems(entry.items, entry.tableId, undefined, entry.itemKeys, entry.idempotencyKey);
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
        // Stamp the queued order with stable idempotency keys so the
        // flush replay is safe even if individual /items writes already
        // hit the server on a previous (lost) attempt.
        const itemKeys = cart.map(() => mobileUid());
        await writeQueueCache([
          ...existing,
          { tableId: numTableId, items: [...cart], queuedAt: Date.now(), idempotencyKey: mobileUid(), itemKeys },
        ]);
        setCart([]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("Saved Offline", "You're offline. The order will be sent to the kitchen automatically when you reconnect.");
        return;
      }
      await submitOrderItems(cart, numTableId, activeOrder?.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCart([]);
      Alert.alert("Sent!", "Items sent to kitchen.");
    } catch (err) {
      // Surface the server's actual error (e.g. "Spice Level is required")
      // instead of a generic toast. customFetch throws ApiError where the
      // parsed JSON body is on `.data` and `.message` is already formatted
      // as "HTTP 400 Bad Request: <error>".
      const e = err as { data?: { error?: string } | null; message?: string; status?: number };
      const serverMsg = (e?.data && typeof e.data === "object" && typeof e.data.error === "string")
        ? e.data.error
        : null;
      Alert.alert(
        "Couldn't send order",
        serverMsg
          ? `${serverMsg}\n\nTip: tap the item again to customize it (e.g. pick a spice level) before sending.`
          : "Something went wrong sending to the kitchen. Please try again.",
      );
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

      {voiceOrderingEnabled && (
        <Pressable
          onPress={() => {
            if (!isOnline) {
              Alert.alert("Voice order needs internet", "Connect to the internet to use AI voice ordering.");
              return;
            }
            setShowVoiceModal(true);
          }}
          style={({ pressed }) => [{
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
            paddingVertical: 9, marginHorizontal: 12, marginTop: 10, borderRadius: 10,
            backgroundColor: colors.primary + "15", borderWidth: 1, borderColor: colors.primary + "40",
            opacity: pressed || !isOnline ? 0.5 : 1,
          }]}
        >
          <Ionicons name="mic" size={16} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
            Voice order (AI)
          </Text>
        </Pressable>
      )}

      {voiceOrderingEnabled && (
        <VoiceOrderModal
          visible={showVoiceModal}
          restaurantId={restaurantId}
          tableId={numTableId}
          menuItems={allMenuItems}
          onClose={() => setShowVoiceModal(false)}
          onConfirm={async (result: VoiceOrderResult) => {
            if (!isOnline) {
              Alert.alert("Offline", "Voice order requires an internet connection. Please reconnect and try again.");
              return;
            }
            const cartItems: CartItem[] = result.items.map((it) => {
              const menuItem = allMenuItems.find((m) => m.id === it.menuItemId)
                ?? itemList.find((m) => m.id === it.menuItemId);
              return {
                menuItemId: it.menuItemId,
                name: menuItem?.name ?? `Item #${it.menuItemId}`,
                price: menuItem ? Number(menuItem.price) : 0,
                quantity: it.quantity,
              };
            });
            await submitOrderItems(cartItems, numTableId, activeOrder?.id);
            Alert.alert("Sent!", `${cartItems.length} item${cartItems.length === 1 ? "" : "s"} sent to kitchen.`);
          }}
        />
      )}

      {activeOrder ? (
        <Pressable
          style={[styles.activeOrderBanner, { backgroundColor: colors.accent, borderColor: colors.primary + "40" }]}
          onPress={() => router.push({ pathname: "/(waiter)/bill/[orderId]", params: { orderId: String(activeOrder.id) } })}
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
              onAdd={() => { void handleAdd(item); }}
              onRemove={() => handleRemove(item)}
            />
          )}
        />
      )}

      {modifierItem ? (
        <ModifierBottomSheet
          visible={!!modifierItem}
          onClose={() => setModifierItem(null)}
          itemId={modifierItem.id}
          itemName={modifierItem.name}
          basePrice={Number(modifierItem.price)}
          imageUrl={modifierItem.imageUrl ?? null}
          onConfirm={({ modifiers, note, quantity }) => {
            addCustomizedLine(modifierItem, modifiers, note, quantity);
            setModifierItem(null);
          }}
        />
      ) : null}

      {checkingMods ? (
        <View style={styles.checkingOverlay} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}

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
  checkingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.15)" },
});
