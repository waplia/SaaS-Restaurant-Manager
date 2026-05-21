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
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";

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
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

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

  const onboardingQ = useQuery({
    queryKey: ["onboarding-state", restaurantId],
    queryFn: () => customFetch<{ defaultMenuId: number | null }>("/api/onboarding/state"),
    staleTime: 60_000,
  });
  const defaultMenuId = onboardingQ.data?.defaultMenuId ?? null;

  const errToast = (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not save");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["menu-items-mobile", restaurantId] });

  const toggle = useMutation({
    mutationFn: ({ id, isAvailable }: { id: number; isAvailable: boolean }) =>
      customFetch(`/api/restaurants/${restaurantId}/items/${id}`, {
        method: "PATCH", body: JSON.stringify({ isAvailable }),
      }),
    onError: errToast,
    onSettled: invalidate,
  });

  const create = useMutation({
    mutationFn: (body: Partial<MenuItem>) =>
      customFetch(`/api/restaurants/${restaurantId}/items`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setCreating(false); invalidate(); },
    onError: errToast,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<MenuItem> }) =>
      customFetch(`/api/restaurants/${restaurantId}/items/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });
  const deleteM = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/items/${id}`, { method: "DELETE" }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });

  const createCategory = useMutation({
    mutationFn: (name: string) => {
      if (!defaultMenuId) throw new Error("No menu set up yet. Finish onboarding first.");
      return customFetch<Category>(`/api/restaurants/${restaurantId}/categories`, {
        method: "POST", body: JSON.stringify({ name, menuId: defaultMenuId }),
      });
    },
    onSuccess: () => {
      setAddingCategory(false);
      setNewCategoryName("");
      qc.invalidateQueries({ queryKey: ["menu-categories-mobile", restaurantId] });
    },
    onError: errToast,
  });

  function promptAddCategory() {
    if (!defaultMenuId) {
      Alert.alert("Set up your menu first", "Finish onboarding to create your first menu, then categories can be added here.");
      return;
    }
    if (Platform.OS === "ios") {
      Alert.prompt(
        "New category",
        "Name this menu category (e.g. Starters, Main Course).",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Add", onPress: (val) => { const n = (val ?? "").trim(); if (n) createCategory.mutate(n); } },
        ],
        "plain-text",
      );
    } else {
      setNewCategoryName("");
      setAddingCategory(true);
    }
  }

  const addButton = (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <Pressable
        onPress={promptAddCategory}
        hitSlop={10}
        accessibilityLabel="Add category"
        style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
      >
        <Ionicons name="folder-open-outline" size={16} color={colors.foreground} />
        <Text style={[styles.addBtnText, { color: colors.foreground }]}>Category</Text>
      </Pressable>
      <Pressable
        onPress={() => setCreating(true)}
        hitSlop={10}
        style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
      >
        <Ionicons name="add" size={18} color="#fff" />
        <Text style={styles.addBtnText}>Add</Text>
      </Pressable>
    </View>
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
            <Pressable
              key={item.id}
              onPress={() => setEditing(item)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: colors.card, borderColor: colors.border,
                  opacity: pressed ? 0.85 : (item.isAvailable ? 1 : 0.6),
                },
              ]}
            >
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
            </Pressable>
          ))}
        </ScrollView>
      )}

      <MenuItemForm
        visible={creating}
        onClose={() => setCreating(false)}
        title="New menu item"
        submitLabel="Create item"
        submitting={create.isPending}
        categories={categories}
        onSubmit={(v) => create.mutate(v)}
        onAddCategory={promptAddCategory}
      />
      <MenuItemForm
        visible={!!editing}
        onClose={() => setEditing(null)}
        title="Edit menu item"
        submitLabel="Save changes"
        submitting={update.isPending}
        categories={categories}
        initial={editing ?? undefined}
        onSubmit={(v) => editing && update.mutate({ id: editing.id, body: v })}
        onDelete={() => editing && deleteM.mutate(editing.id)}
        deleting={deleteM.isPending}
        onAddCategory={promptAddCategory}
      />

      <Modal
        visible={addingCategory}
        animationType="fade"
        transparent
        onRequestClose={() => setAddingCategory(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>New category</Text>
            <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
              Name this menu category (e.g. Starters, Main Course).
            </Text>
            <TextInput
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              placeholder="Category name"
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              style={[styles.modalInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
            />
            <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
              <Pressable
                onPress={() => setAddingCategory(false)}
                style={({ pressed }) => [styles.modalBtn, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const n = newCategoryName.trim();
                  if (n) createCategory.mutate(n);
                }}
                disabled={createCategory.isPending || newCategoryName.trim().length === 0}
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: colors.primary, opacity: (pressed || createCategory.isPending || newCategoryName.trim().length === 0) ? 0.6 : 1 },
                ]}
              >
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  {createCategory.isPending ? "Adding…" : "Add"}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function MenuItemForm({
  visible, onClose, title, submitLabel, submitting, categories, initial, onSubmit, onDelete, deleting, onAddCategory,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  submitting: boolean;
  categories: Category[];
  initial?: Partial<MenuItem>;
  onSubmit: (v: { name: string; price: string; categoryId: number | null }) => void;
  onDelete?: () => void;
  deleting?: boolean;
  onAddCategory?: () => void;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);

  React.useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setPrice(initial?.price != null ? String(initial.price) : "");
      setCategoryId(initial?.categoryId ?? categories[0]?.id ?? null);
    }
  }, [visible, initial, categories]);

  const canSubmit = name.trim().length > 0 && price.trim().length > 0 && categoryId != null && !submitting;

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose} title={title}
      submitting={submitting} canSubmit={canSubmit}
      onSubmit={() => onSubmit({ name: name.trim(), price: price.trim(), categoryId })}
      submitLabel={submitLabel}
      onDelete={onDelete} deleting={deleting}
      deleteConfirmMessage="Remove this item from the menu? Customers will no longer see it."
    >
      <FormField label="Name">
        <TextInput value={name} onChangeText={setName} placeholder="e.g. Paneer Tikka"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <FormField label="Price (₹)">
        <TextInput value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <FormField label="Category">
        {categories.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {categories.map(c => (
              <Pressable
                key={c.id}
                onPress={() => setCategoryId(c.id)}
                style={[styles.chip, { borderColor: colors.border, backgroundColor: categoryId === c.id ? colors.primary : colors.background }]}
              >
                <Text style={{ color: categoryId === c.id ? "#fff" : colors.foreground, fontSize: 12, fontFamily: "Inter_500Medium" }}>{c.name}</Text>
              </Pressable>
            ))}
            {onAddCategory ? (
              <Pressable
                onPress={onAddCategory}
                style={[styles.chip, { borderColor: colors.primary, borderStyle: "dashed", backgroundColor: colors.background, flexDirection: "row", alignItems: "center", gap: 4 }]}
              >
                <Ionicons name="add" size={14} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>New</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        ) : (
          <View style={{ gap: 8, paddingVertical: 4 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}>
              No categories yet. Add your first one to start building the menu.
            </Text>
            {onAddCategory ? (
              <Pressable
                onPress={onAddCategory}
                style={[styles.chip, { alignSelf: "flex-start", borderColor: colors.primary, borderStyle: "dashed", flexDirection: "row", alignItems: "center", gap: 4 }]}
              >
                <Ionicons name="add" size={14} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>Add category</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </FormField>
    </EntityFormSheet>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 380, borderRadius: 14, borderWidth: 1, padding: 18, gap: 12 },
  modalTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  modalSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  modalInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Inter_400Regular", fontSize: 14 },
  modalBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
});
