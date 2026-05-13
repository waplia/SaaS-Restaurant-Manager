import React, { useState, useEffect } from "react";
import {
  View, Text, FlatList, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import {
  listMenuCategories, getListMenuCategoriesQueryKey,
  listMenuItems, getListMenuItemsQueryKey,
} from "@workspace/api-client-react";
import type { MenuCategory, MenuItem } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { MenuItemCard } from "@/components/MenuItemCard";
import { EmptyState } from "@/components/EmptyState";
import { useCart } from "@/context/CartContext";

export default function CustomerMenuScreen() {
  const { restaurantId: rIdParam } = useLocalSearchParams<{ restaurantId: string; tableId: string; token: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { cart, addItem, updateQuantity, itemCount } = useCart();
  const isWeb = Platform.OS === "web";

  const restaurantId = Number(rIdParam) || 1;
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const { data: categories } = useQuery({
    queryKey: getListMenuCategoriesQueryKey(restaurantId),
    queryFn: () => listMenuCategories(restaurantId),
  });

  const menuParams = selectedCategoryId ? { categoryId: selectedCategoryId } : {};
  const { data: menuItems, isLoading } = useQuery({
    queryKey: getListMenuItemsQueryKey(restaurantId, menuParams),
    queryFn: () => listMenuItems(restaurantId, menuParams),
    enabled: selectedCategoryId !== null,
  });

  const categoryList = (Array.isArray(categories) ? categories : []) as MenuCategory[];
  const itemList = (Array.isArray(menuItems) ? menuItems : []) as MenuItem[];

  useEffect(() => {
    if (categoryList.length > 0 && selectedCategoryId === null) {
      setSelectedCategoryId(categoryList[0].id);
    }
  }, [categoryList.length]);

  const getQty = (menuItemId: number) => cart.items.find((i) => i.menuItemId === menuItemId)?.quantity ?? 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
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

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : itemList.length === 0 ? (
        <EmptyState icon="fast-food-outline" title="No items" message="No menu items in this category." />
      ) : (
        <FlatList
          data={itemList}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            styles.itemList,
            { paddingBottom: isWeb ? 34 + (itemCount > 0 ? 90 : 20) : insets.bottom + (itemCount > 0 ? 90 : 20) },
          ]}
          renderItem={({ item }) => (
            <MenuItemCard
              name={item.name}
              description={item.description}
              price={Number(item.price)}
              imageUrl={item.imageUrl}
              quantity={getQty(item.id)}
              isAvailable={item.isAvailable !== false}
              onAdd={() => addItem({ menuItemId: item.id, name: item.name, price: Number(item.price), imageUrl: item.imageUrl })}
              onRemove={() => updateQuantity(item.id, -1)}
            />
          )}
        />
      )}

      {itemCount > 0 ? (
        <View style={[styles.cartBar, { backgroundColor: colors.primary, paddingBottom: isWeb ? 34 : insets.bottom }]}>
          <Pressable
            style={({ pressed }) => [styles.cartBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => router.push("/(customer)/cart")}
          >
            <View style={styles.cartCount}>
              <Text style={styles.cartCountText}>{itemCount}</Text>
            </View>
            <Text style={styles.cartBtnText}>View Order</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  categoryBar: { flexGrow: 0, borderBottomWidth: 1 },
  categories: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  catPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  catText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  itemList: { padding: 12 },
  cartBar: { paddingHorizontal: 16, paddingTop: 12 },
  cartBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, marginBottom: 8 },
  cartCount: { width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
  cartCountText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  cartBtnText: { flex: 1, color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
