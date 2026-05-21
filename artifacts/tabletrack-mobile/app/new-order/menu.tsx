import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, FlatList, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Alert, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  listMenuCategories, getListMenuCategoriesQueryKey,
  listMenuItems, getListMenuItemsQueryKey,
  useCreateOrder,
  getListOrdersQueryKey,
  getRestaurant, getGetRestaurantQueryKey,
} from "@workspace/api-client-react";
import type { MenuCategory, MenuItem } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCart, type CartModifier } from "@/context/CartContext";
import { ItemCard } from "@/components/ItemCard";
import { ModifierBottomSheet } from "@/components/ModifierBottomSheet";
import { MobileCartBar } from "@/components/MobileCartBar";
import { CartSummarySheet } from "@/components/CartSummarySheet";
import { EmptyState } from "@/components/EmptyState";
import { VoiceOrderModal, type VoiceOrderResult } from "@/components/VoiceOrderModal";

type Filter = "all" | "veg" | "nonveg" | "bestseller";

interface ExtendedMenuItem extends MenuItem {
  isVeg?: boolean;
  isBestseller?: boolean;
  hasModifiers?: boolean;
  modifierGroupCount?: number;
  tags?: string[];
  sku?: string | null;
  stockQty?: number | null;
}

export default function NewOrderMenuScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const qc = useQueryClient();
  const { restaurantId } = useAuth();
  const { cart, addLine, itemCount, total, clearCart, updateQuantity, removeLine } = useCart();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [cartOpen, setCartOpen] = useState(false);
  const [modifierItem, setModifierItem] = useState<ExtendedMenuItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const catsQ = useQuery({
    queryKey: getListMenuCategoriesQueryKey(restaurantId),
    queryFn: () => listMenuCategories(restaurantId),
    staleTime: 5 * 60 * 1000,
  });
  const categories = (Array.isArray(catsQ.data) ? catsQ.data : []) as MenuCategory[];

  // Pull all items once — keeps fast local filtering for search + filters.
  const itemsQ = useQuery({
    queryKey: getListMenuItemsQueryKey(restaurantId, {}),
    queryFn: () => listMenuItems(restaurantId, {}),
    staleTime: 60_000,
  });
  const allItems = (Array.isArray(itemsQ.data) ? itemsQ.data : []) as ExtendedMenuItem[];

  // Restaurant settings for tax / service charge applied to cart totals.
  const settingsQ = useQuery({
    queryKey: getGetRestaurantQueryKey(restaurantId),
    queryFn: () => getRestaurant(restaurantId),
    staleTime: 5 * 60 * 1000,
  });
  const settings = (settingsQ.data ?? {}) as Record<string, unknown>;
  const voiceOrderingEnabled = !!(settings as { enableVoiceOrdering?: boolean }).enableVoiceOrdering;
  const taxRate = Number(settings.taxRate ?? 0) / (Number(settings.taxRate ?? 0) > 1 ? 100 : 1);
  const serviceCharge = Number(settings.serviceCharge ?? 0) / (Number(settings.serviceCharge ?? 0) > 1 ? 100 : 1);

  const visibleItems = useMemo(() => {
    let list = allItems.filter((it) => it.isAvailable !== false);
    if (categoryId != null) list = list.filter((it) => (it as { categoryId?: number }).categoryId === categoryId);
    if (filter === "veg") list = list.filter((it) => it.isVeg === true);
    if (filter === "nonveg") list = list.filter((it) => it.isVeg === false);
    if (filter === "bestseller") list = list.filter((it) => it.isBestseller);
    if (debounced) {
      const q = debounced.toLowerCase();
      list = list.filter((it) =>
        (it.name ?? "").toLowerCase().includes(q)
        || (it.description ?? "").toLowerCase().includes(q)
        || (it.sku ?? "").toLowerCase().includes(q)
        || (it.tags ?? []).some((t) => String(t).toLowerCase().includes(q))
      );
    }
    return list;
  }, [allItems, categoryId, filter, debounced]);

  const lineQtyForItem = (id: number) =>
    cart.items.filter((l) => l.menuItemId === id).reduce((s, l) => s + l.quantity, 0);

  const onAdd = (item: ExtendedMenuItem) => {
    addLine({
      menuItemId: item.id,
      name: item.name,
      price: Number(item.price),
      imageUrl: item.imageUrl ?? null,
      modifiers: [],
      note: null,
    });
  };
  const onRemove = (item: ExtendedMenuItem) => {
    const lines = cart.items.filter((l) => l.menuItemId === item.id);
    if (lines.length === 0) return;
    const last = lines[lines.length - 1];
    if (last.quantity > 1) updateQuantity(last.lineId, -1);
    else removeLine(last.lineId);
  };

  // Send order to kitchen using existing endpoints.
  const createOrder = useCreateOrder();
  const addItemMutation = useMutation({
    // Server expects `modifiers: [{ modifierId, quantity }]` — sending
    // `modifierIds: number[]` was silently dropped, leading to 400s when an
    // item had a required modifier group (e.g. spice_level).
    mutationFn: ({ rid, id, data }: { rid: number; id: number; data: { menuItemId: number; quantity: number; modifiers?: Array<{ modifierId: number; quantity: number }>; notes?: string } }) =>
      customFetch(`/api/restaurants/${rid}/orders/${id}/items`, { method: "POST", body: JSON.stringify(data) }),
  });

  const handleSend = async () => {
    if (cart.items.length === 0) {
      Alert.alert("Empty Cart", "Add items first.");
      return;
    }
    if (cart.orderType === "dine_in" && !cart.tableId) {
      Alert.alert("Pick a table", "Dine-in orders need a table.");
      return;
    }
    setBusy(true);
    try {
      const orderTypeForApi =
        cart.orderType === "qr" ? "dine_in"
        : cart.orderType === "curbside" ? "takeaway"
        : cart.orderType === "pre_order" ? "takeaway"
        : (cart.orderType ?? "dine_in");

      const body: Record<string, unknown> = { orderType: orderTypeForApi, items: [] };
      if (cart.tableId) body.tableId = cart.tableId;
      if (cart.customer?.name) body.customerName = cart.customer.name;
      if (cart.customer?.phone) body.customerPhone = cart.customer.phone;
      if (cart.customer?.address) body.deliveryAddress = cart.customer.address;

      const created = await createOrder.mutateAsync({ restaurantId, data: body as never });
      const orderId = created.id;
      for (const line of cart.items) {
        const mods = (line.modifiers ?? []).map((m) => ({ modifierId: m.modifierId, quantity: 1 }));
        await addItemMutation.mutateAsync({
          rid: restaurantId, id: orderId,
          data: {
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            modifiers: mods.length ? mods : undefined,
            notes: line.note ?? undefined,
          },
        });
      }
      qc.invalidateQueries({ queryKey: getListOrdersQueryKey(restaurantId) });
      clearCart();
      setCartOpen(false);
      router.replace("/(owner)/orders" as never);
    } catch (e) {
      Alert.alert("Couldn't send", "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Sticky search bar */}
      <View style={[styles.searchWrap, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={styles.searchRow}>
          <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
            <Ionicons name="search" size={18} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search items, categories, add-ons…"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground }]}
              returnKeyType="search"
            />
            {search ? (
              <Pressable onPress={() => setSearch("")}>
                <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
          {voiceOrderingEnabled ? (
            <Pressable
              onPress={() => setVoiceOpen(true)}
              accessibilityLabel="Voice order (AI)"
              style={({ pressed }) => [
                styles.voiceBtn,
                {
                  backgroundColor: colors.primary + "15",
                  borderColor: colors.primary + "40",
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="mic" size={18} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Chip active={filter === "all"} onPress={() => setFilter("all")} colors={colors} label="All" />
          <Chip active={filter === "veg"} onPress={() => setFilter("veg")} colors={colors} label="Veg" dotColor="#16a34a" />
          <Chip active={filter === "nonveg"} onPress={() => setFilter("nonveg")} colors={colors} label="Non-veg" dotColor="#dc2626" />
          <Chip active={filter === "bestseller"} onPress={() => setFilter("bestseller")} colors={colors} label="Bestseller" icon="star" />
        </ScrollView>

        {/* Category chips */}
        {categories.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            <Chip active={categoryId == null} onPress={() => setCategoryId(null)} colors={colors} label="All categories" />
            {categories.map((c) => (
              <Chip key={c.id} active={categoryId === c.id} onPress={() => setCategoryId(c.id)} colors={colors} label={c.name} />
            ))}
          </ScrollView>
        ) : null}

        {cart.tableLabel ? (
          <View style={[styles.contextRow, { borderColor: colors.border, backgroundColor: colors.accent }]}>
            <Ionicons name="restaurant" size={12} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 11, fontFamily: "Inter_600SemiBold" }}>
              {cart.orderType === "qr" ? "QR Assist · " : "Table "}{cart.tableLabel}
            </Text>
          </View>
        ) : cart.orderType === "takeaway" || cart.orderType === "delivery" ? (
          <View style={[styles.contextRow, { borderColor: colors.border, backgroundColor: colors.accent }]}>
            <Ionicons name={cart.orderType === "delivery" ? "bicycle" : "bag-handle"} size={12} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 11, fontFamily: "Inter_600SemiBold" }}>
              {cart.orderType === "delivery" ? "Delivery" : "Takeaway"}{cart.customer?.name ? ` · ${cart.customer.name}` : ""}
            </Text>
          </View>
        ) : null}
      </View>

      {itemsQ.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={search ? "search-outline" : "fast-food-outline"}
          title={search ? "No matches" : "No items"}
          message={search ? "Try a different word or clear filters." : "Add items from the menu module."}
        />
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={[styles.list, { paddingBottom: itemCount > 0 ? 110 : (isWeb ? 24 : insets.bottom + 24) }]}
          renderItem={({ item }) => {
            const cat = categories.find((c) => c.id === (item as { categoryId?: number }).categoryId)?.name ?? null;
            const hasMods = (item.modifierGroupCount ?? 0) > 0 || item.hasModifiers === true;
            return (
              <ItemCard
                name={item.name}
                description={item.description ?? undefined}
                price={Number(item.price)}
                imageUrl={item.imageUrl}
                isVeg={item.isVeg}
                isBestseller={item.isBestseller}
                category={cat}
                isAvailable={item.isAvailable !== false}
                outOfStock={item.stockQty != null ? Number(item.stockQty) <= 0 : false}
                hasModifiers={hasMods}
                quantity={lineQtyForItem(item.id)}
                onAdd={() => onAdd(item)}
                onRemove={() => onRemove(item)}
                onCustomize={() => setModifierItem(item)}
              />
            );
          }}
        />
      )}

      <MobileCartBar itemCount={itemCount} total={total} onPress={() => setCartOpen(true)} />

      {voiceOrderingEnabled ? (
        <VoiceOrderModal
          visible={voiceOpen}
          restaurantId={restaurantId}
          tableId={cart.tableId ?? 0}
          menuItems={allItems
            .filter((m) => m.isAvailable !== false && !(m.stockQty != null && Number(m.stockQty) <= 0))
            .map((m) => ({ id: m.id, name: m.name, price: m.price }))}
          onClose={() => setVoiceOpen(false)}
          onConfirm={async (result: VoiceOrderResult) => {
            for (const it of result.items) {
              const mi = allItems.find((m) => m.id === it.menuItemId);
              addLine({
                menuItemId: it.menuItemId,
                name: mi?.name ?? `Item #${it.menuItemId}`,
                price: mi ? Number(mi.price) : 0,
                imageUrl: mi?.imageUrl ?? null,
                modifiers: [],
                note: it.notes ?? null,
                quantity: it.quantity,
              });
            }
            setVoiceOpen(false);
            setCartOpen(true);
          }}
        />
      ) : null}

      {modifierItem ? (
        <ModifierBottomSheet
          visible={!!modifierItem}
          onClose={() => setModifierItem(null)}
          itemId={modifierItem.id}
          itemName={modifierItem.name}
          basePrice={Number(modifierItem.price)}
          imageUrl={modifierItem.imageUrl ?? null}
          onConfirm={({ modifiers, note, quantity }: { modifiers: CartModifier[]; note: string; quantity: number }) => {
            addLine({
              menuItemId: modifierItem.id,
              name: modifierItem.name,
              price: Number(modifierItem.price),
              imageUrl: modifierItem.imageUrl ?? null,
              modifiers,
              note: note || null,
              quantity,
            });
            setModifierItem(null);
          }}
        />
      ) : null}

      <CartSummarySheet
        visible={cartOpen}
        onClose={() => setCartOpen(false)}
        onSend={handleSend}
        taxRate={taxRate}
        serviceCharge={serviceCharge}
        busy={busy}
        primaryLabel={cart.orderType === "delivery" ? "Save Delivery Order" : cart.orderType === "takeaway" ? "Save Takeaway" : "Send to Kitchen"}
      />
    </View>
  );
}

function Chip({ active, onPress, label, colors, dotColor, icon }: {
  active: boolean; onPress: () => void; label: string;
  colors: ReturnType<typeof useColors>;
  dotColor?: string; icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.card }]}>
      {dotColor ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} /> : null}
      {icon ? <Ionicons name={icon} size={11} color={active ? "#fff" : colors.mutedForeground} /> : null}
      <Text style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, gap: 8, borderBottomWidth: 1 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1 },
  voiceBtn: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  chipsRow: { gap: 8, paddingVertical: 2, paddingRight: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  contextRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  list: { padding: 12 },
});
