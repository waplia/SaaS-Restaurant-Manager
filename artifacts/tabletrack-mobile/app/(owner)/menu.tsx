import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Switch, TextInput,
  Platform, Alert, Pressable,
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

  const addButton = (
    <Pressable
      onPress={() => setCreating(true)}
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
      />
    </View>
  );
}

function MenuItemForm({
  visible, onClose, title, submitLabel, submitting, categories, initial, onSubmit, onDelete, deleting,
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
          </ScrollView>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", paddingVertical: 6 }}>
            No categories yet — add one from the web dashboard before creating items.
          </Text>
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
});
