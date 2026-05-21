import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Switch, TextInput,
  Platform, Alert, Pressable, Modal, KeyboardAvoidingView,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";

type MenuItem = {
  id: number;
  name: string;
  price?: string | number;
  imageUrl?: string | null;
  isAvailable?: boolean;
  categoryId?: number | null;
  categoryName?: string;
};

type Category = { id: number; name: string };

export default function MenuScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // The API exposes menu items at `/restaurants/:id/items` — the previous
  // `/menu/items` path doesn't exist and always returned 404, which is why
  // this screen looked empty.
  // Surface server errors rather than silently returning [] — a blank
  // screen on a failed request hides real problems (auth, plan gate, etc).
  const q = useQuery({
    queryKey: ["menu-items-mobile", restaurantId],
    queryFn: () => customFetch<MenuItem[]>(`/api/restaurants/${restaurantId}/items`),
  });
  const items: MenuItem[] = Array.isArray(q.data) ? q.data : [];
  const filtered = items.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()));

  const categoriesQ = useQuery({
    queryKey: ["menu-categories-mobile", restaurantId],
    queryFn: () => customFetch<Category[]>(`/api/restaurants/${restaurantId}/categories`),
  });
  const categories: Category[] = Array.isArray(categoriesQ.data) ? categoriesQ.data : [];

  const toggle = useMutation({
    mutationFn: ({ id, isAvailable }: { id: number; isAvailable: boolean }) =>
      customFetch(`/api/restaurants/${restaurantId}/items/${id}`, {
        method: "PATCH", body: JSON.stringify({ isAvailable }),
      }),
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not update item"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["menu-items-mobile", restaurantId] }),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; price: string; categoryId: number | null }) =>
      customFetch(`/api/restaurants/${restaurantId}/items`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["menu-items-mobile", restaurantId] });
    },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not create item"),
  });

  const addButton = (
    <Pressable
      onPress={() => setShowCreate(true)}
      hitSlop={10}
      style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
    >
      <Ionicons name="add" size={18} color="#fff" />
      <Text style={styles.addBtnText}>Add</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Menu" subtitle={`${items.length} items`} showBack right={addButton} />
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={[styles.search, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={16} color={colors.mutedForeground} />
          <TextInput
            placeholder="Search items"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}
          />
        </View>
      </View>
      {q.isError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't load menu"
          message={q.error instanceof Error ? q.error.message : "Please try again."}
        />
      ) : q.isLoading ? (
        <EmptyState icon="time-outline" title="Loading…" message="Fetching your menu." />
      ) : filtered.length === 0 ? (
        <EmptyState icon="restaurant-outline" title="No items" message="No menu items match your search." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: isWeb ? 100 : 100 }}
        >
          {filtered.map(item => (
            <View key={item.id} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, opacity: item.isAvailable ? 1 : 0.6 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  ₹{item.price ?? "0"}{item.categoryName ? ` · ${item.categoryName}` : ""}
                </Text>
              </View>
              <Switch
                value={item.isAvailable ?? true}
                onValueChange={v => toggle.mutate({ id: item.id, isAvailable: v })}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          ))}
        </ScrollView>
      )}

      <CreateItemModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={(v) => create.mutate(v)}
        submitting={create.isPending}
        categories={categories}
      />
    </View>
  );
}

function CreateItemModal({
  visible, onClose, onSubmit, submitting, categories,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (v: { name: string; price: string; categoryId: number | null }) => void;
  submitting: boolean;
  categories: Category[];
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);

  React.useEffect(() => {
    if (visible) { setName(""); setPrice(""); setCategoryId(categories[0]?.id ?? null); }
  }, [visible, categories]);

  // `menu_items.category_id` is NOT NULL on the server, so block submit when
  // no category is selected and surface a helpful message if none exist yet.
  const canSubmit = name.trim().length > 0 && price.trim().length > 0 && categoryId != null && !submitting;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={modalStyles.backdrop}>
        <View style={[modalStyles.sheet, { backgroundColor: colors.card }]}>
          <View style={modalStyles.headerRow}>
            <Text style={[modalStyles.title, { color: colors.foreground }]}>New menu item</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <Text style={[modalStyles.label, { color: colors.mutedForeground }]}>Name</Text>
          <TextInput
            value={name} onChangeText={setName} placeholder="e.g. Paneer Tikka"
            placeholderTextColor={colors.mutedForeground}
            style={[modalStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />

          <Text style={[modalStyles.label, { color: colors.mutedForeground }]}>Price (₹)</Text>
          <TextInput
            value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad"
            placeholderTextColor={colors.mutedForeground}
            style={[modalStyles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />

          <Text style={[modalStyles.label, { color: colors.mutedForeground }]}>Category</Text>
          {categories.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {categories.map(c => (
                <Pressable
                  key={c.id}
                  onPress={() => setCategoryId(c.id)}
                  style={[modalStyles.chip, { borderColor: colors.border, backgroundColor: categoryId === c.id ? colors.primary : colors.background }]}
                >
                  <Text style={{ color: categoryId === c.id ? "#fff" : colors.foreground, fontSize: 12, fontFamily: "Inter_500Medium" }}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", paddingVertical: 6 }}>
              No categories yet — add one from the web dashboard before creating items.
            </Text>
          )}

          <Pressable
            disabled={!canSubmit}
            onPress={() => onSubmit({ name: name.trim(), price: price.trim(), categoryId })}
            style={({ pressed }) => [modalStyles.submit, { backgroundColor: colors.primary, opacity: !canSubmit ? 0.4 : pressed ? 0.85 : 1 }]}
          >
            <Text style={modalStyles.submitText}>{submitting ? "Creating…" : "Create item"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

const modalStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Inter_400Regular", fontSize: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  submit: { marginTop: 16, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  submitText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
