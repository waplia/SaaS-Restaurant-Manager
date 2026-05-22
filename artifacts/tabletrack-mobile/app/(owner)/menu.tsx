import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Switch, TextInput,
  Platform, Alert, Pressable, Modal, KeyboardAvoidingView, Image, ActivityIndicator,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";
import { resolveImageUrl } from "@/lib/resolveImageUrl";

interface StockFoodImage {
  id: number;
  name: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  isVeg: boolean;
  cuisine: string | null;
}

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
  // Dedicated mutation for auto-persisting just the photo while the owner
  // is still editing — must NOT close the edit sheet (unlike `update`).
  const persistPhoto = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<MenuItem> }) =>
      customFetch(`/api/restaurants/${restaurantId}/items/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (_data, vars) => {
      // Reflect the saved photo on the open editor + the list behind it.
      setEditing(prev => prev && prev.id === vars.id ? { ...prev, ...vars.body } : prev);
      invalidate();
    },
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
        restaurantId={restaurantId}
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
        restaurantId={restaurantId}
        initial={editing ?? undefined}
        editingItemId={editing?.id ?? null}
        onPersistImage={(body) => {
          if (!editing) return;
          // Persist immediately so the photo shows up on the diner QR menu
          // even if the owner closes the form without tapping Save. Uses
          // the dedicated `persistPhoto` mutation so it doesn't dismiss
          // the edit sheet (the regular `update` would).
          persistPhoto.mutate({ id: editing.id, body });
        }}
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
  visible, onClose, title, submitLabel, submitting, categories, initial, onSubmit, onDelete, deleting,
  onAddCategory, restaurantId, editingItemId, onPersistImage,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  submitting: boolean;
  categories: Category[];
  initial?: Partial<MenuItem>;
  onSubmit: (v: {
    name: string;
    price: string;
    categoryId: number | null;
    imageUrl?: string | null;
    libraryImageId?: number | null;
    imageSource?: string;
  }) => void;
  onDelete?: () => void;
  deleting?: boolean;
  onAddCategory?: () => void;
  restaurantId: number | null | undefined;
  editingItemId?: number | null;
  onPersistImage?: (body: { imageUrl: string; libraryImageId?: number | null; imageSource?: string }) => void;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [libraryImageId, setLibraryImageId] = useState<number | null>(null);
  const [imageSource, setImageSource] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySuggestions, setLibrarySuggestions] = useState<StockFoodImage[]>([]);

  React.useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setPrice(initial?.price != null ? String(initial.price) : "");
      setCategoryId(initial?.categoryId ?? categories[0]?.id ?? null);
      setImageUrl(initial?.imageUrl ?? "");
      setLibraryImageId(null);
      setImageSource("");
      setLibraryOpen(false);
      setLibrarySuggestions([]);
    }
  }, [visible, initial, categories]);

  const canSubmit = name.trim().length > 0 && price.trim().length > 0 && categoryId != null && !submitting;

  /**
   * Apply a photo locally and, if we're editing an existing item, push
   * it to the server right away so the new photo is visible to diners
   * even if the owner backs out of the form without tapping Save.
   */
  function applyPhoto(url: string, opts: { libraryImageId?: number | null; source: string }) {
    setImageUrl(url);
    setLibraryImageId(opts.libraryImageId ?? null);
    setImageSource(opts.source);
    if (editingItemId && onPersistImage) {
      onPersistImage({ imageUrl: url, libraryImageId: opts.libraryImageId ?? null, imageSource: opts.source });
    }
  }

  async function pickAndUpload() {
    if (!restaurantId) {
      Alert.alert("Not ready", "Restaurant context isn't loaded yet. Please try again in a moment.");
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo access to upload a menu photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const fileName = asset.fileName ?? `menu-photo-${Date.now()}.jpg`;
      const contentType = asset.mimeType ?? "image/jpeg";
      const blob = await (await fetch(asset.uri)).blob();
      const presign = await customFetch<{ uploadURL: string; objectPath: string }>(
        `/api/restaurants/${restaurantId}/storage/uploads/request-url`,
        { method: "POST", body: JSON.stringify({ name: fileName, size: blob.size, contentType }) },
      );
      const put = await fetch(presign.uploadURL, {
        method: "PUT", headers: { "Content-Type": contentType }, body: blob,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      // Use the PUBLIC finalize so diners can fetch the photo without auth.
      // The endpoint returns the canonical `/objects/...` path; the
      // diner-facing URL is `/api/public/storage` + that path (same as
      // ImageUploadField on the web app).
      const finalized = await customFetch<{ ok: boolean; objectPath: string }>(
        `/api/restaurants/${restaurantId}/storage/uploads/finalize-public`,
        { method: "POST", body: JSON.stringify({ objectPath: presign.objectPath }) },
      );
      const publicUrl = `/api/public/storage${finalized.objectPath}`;
      applyPhoto(publicUrl, { source: "upload" });
    } catch (e: unknown) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  }

  async function generateAiPhoto() {
    if (!restaurantId) {
      Alert.alert("Not ready", "Restaurant context isn't loaded yet. Please try again in a moment.");
      return;
    }
    if (!editingItemId) {
      Alert.alert("Save the item first", "Create the menu item before generating an AI photo.");
      return;
    }
    setGenerating(true);
    try {
      const res = await customFetch<{ payload: { imageUrl: string } }>(
        `/api/restaurants/${restaurantId}/items/${editingItemId}/ai-photo`,
        { method: "POST", body: JSON.stringify({}) },
      );
      applyPhoto(res.payload.imageUrl, { source: "ai_generated" });
    } catch (e: unknown) {
      Alert.alert("Photo generation failed", e instanceof Error ? e.message : "Could not generate photo.");
    } finally {
      setGenerating(false);
    }
  }

  async function openLibrary() {
    setLibraryOpen(true);
    setLibraryLoading(true);
    try {
      const query = name.trim();
      let list: StockFoodImage[] = [];
      if (query.length > 0) {
        // /suggest returns { suggestions: [{row, score, matchedOn}, ...] }
        const res = await customFetch<{ suggestions?: Array<{ row: StockFoodImage }> }>(
          `/api/stock-food-images/suggest?name=${encodeURIComponent(query)}&limit=12`,
        );
        list = (res.suggestions ?? []).map((s) => s.row).filter(Boolean);
      }
      if (list.length === 0) {
        // Fall back to popular images when there's no name yet or no matches.
        const res = await customFetch<{ rows?: StockFoodImage[] }>(`/api/stock-food-images/popular?limit=12`);
        list = res.rows ?? [];
      }
      setLibrarySuggestions(list);
    } catch (e: unknown) {
      Alert.alert("Couldn't load library", e instanceof Error ? e.message : "Please try again.");
      setLibrarySuggestions([]);
    } finally {
      setLibraryLoading(false);
    }
  }

  function chooseLibraryImage(img: StockFoodImage) {
    applyPhoto(img.imageUrl, { libraryImageId: img.id, source: "library" });
    setLibraryOpen(false);
  }

  const previewUrl = resolveImageUrl(imageUrl);

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose} title={title}
      submitting={submitting} canSubmit={canSubmit}
      onSubmit={() => onSubmit({
        name: name.trim(),
        price: price.trim(),
        categoryId,
        imageUrl: imageUrl || null,
        libraryImageId: libraryImageId ?? undefined,
        imageSource: imageSource || undefined,
      })}
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
      <FormField label="Photo">
        <View style={{ gap: 8 }}>
          {previewUrl ? (
            <View style={{ position: "relative" }}>
              <Image
                source={{ uri: previewUrl }}
                style={{ width: "100%", height: 160, borderRadius: 10, backgroundColor: colors.muted }}
                resizeMode="cover"
              />
              <Pressable
                onPress={() => applyPhoto("", { source: "" })}
                style={{ position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 16, padding: 6 }}
                hitSlop={8}
                accessibilityLabel="Remove photo"
              >
                <Ionicons name="close" size={14} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <View style={{
              width: "100%", height: 120, borderRadius: 10, borderWidth: 1, borderStyle: "dashed",
              borderColor: colors.border, alignItems: "center", justifyContent: "center", gap: 4,
              backgroundColor: colors.muted,
            }}>
              <Ionicons name="image-outline" size={24} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}>
                No photo yet
              </Text>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pressable
              onPress={openLibrary}
              disabled={uploading || libraryLoading || generating}
              style={({ pressed }) => [
                styles.chip,
                {
                  flex: 1, borderColor: colors.primary, backgroundColor: colors.background,
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons name="images-outline" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                Pick from library
              </Text>
            </Pressable>
            <Pressable
              onPress={pickAndUpload}
              disabled={uploading || generating}
              style={({ pressed }) => [
                styles.chip,
                {
                  flex: 1, borderColor: colors.border, backgroundColor: colors.background,
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={colors.foreground} />
              ) : (
                <Ionicons name="cloud-upload-outline" size={16} color={colors.foreground} />
              )}
              <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                {uploading ? "Uploading…" : "Upload"}
              </Text>
            </Pressable>
          </View>
          {editingItemId ? (
            <Pressable
              onPress={generateAiPhoto}
              disabled={uploading || libraryLoading || generating}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: colors.primary, backgroundColor: colors.primary,
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                  opacity: pressed ? 0.85 : (generating ? 0.7 : 1),
                },
              ]}
            >
              {generating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="sparkles-outline" size={16} color="#fff" />
              )}
              <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                {generating ? "Generating…" : "Generate with AI"}
              </Text>
            </Pressable>
          ) : null}
          {editingItemId && imageSource ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_400Regular" }}>
              Photo saved — diners can see it on the QR menu now.
            </Text>
          ) : null}
        </View>
      </FormField>

      <Modal visible={libraryOpen} animationType="slide" transparent onRequestClose={() => setLibraryOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{
            backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16,
            padding: 16, maxHeight: "75%",
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 15 }}>
                Choose a photo
              </Text>
              <Pressable onPress={() => setLibraryOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={20} color={colors.foreground} />
              </Pressable>
            </View>
            {libraryLoading ? (
              <View style={{ paddingVertical: 32, alignItems: "center" }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : librarySuggestions.length === 0 ? (
              <View style={{ paddingVertical: 32, alignItems: "center", gap: 6 }}>
                <Ionicons name="images-outline" size={28} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular" }}>
                  No matches found. Try uploading your own photo.
                </Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 16 }}>
                {librarySuggestions.map((img) => (
                  <Pressable
                    key={img.id}
                    onPress={() => chooseLibraryImage(img)}
                    style={({ pressed }) => ({
                      width: "31%", aspectRatio: 1, borderRadius: 10, overflow: "hidden",
                      borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <Image
                      source={{ uri: img.thumbnailUrl || img.imageUrl }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
