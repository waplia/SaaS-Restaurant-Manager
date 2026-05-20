import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, Modal, Pressable, ScrollView, StyleSheet, Image, TextInput, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { resolveImageUrl } from "@/lib/resolveImageUrl";
import type { CartModifier } from "@/context/CartContext";

interface ModifierOption {
  id: number;
  name: string;
  // API returns `price` (Modifier.price string). Keep legacy `priceDelta` as a
  // fallback so older callers that already shape the data still work.
  price?: string | number | null;
  priceDelta?: string | number | null;
  isAvailable?: boolean;
}
interface ModifierGroup {
  id: number;
  name: string;
  displayName?: string | null;
  isRequired?: boolean;
  // API returns `minSelections` / `maxSelections` (Drizzle camelCase). Keep
  // legacy `minSelect` / `maxSelect` aliases for any older shapes.
  minSelections?: number | null;
  maxSelections?: number | null;
  minSelect?: number | null;
  maxSelect?: number | null;
  modifiers?: ModifierOption[];
}

function groupMin(g: ModifierGroup): number {
  const v = g.minSelections ?? g.minSelect;
  if (v != null) return Number(v);
  return g.isRequired ? 1 : 0;
}
function groupMax(g: ModifierGroup): number {
  const v = g.maxSelections ?? g.maxSelect;
  if (v != null) return Number(v);
  return g.isRequired ? 1 : 0;
}
function optionDelta(o: ModifierOption): number {
  const v = o.price ?? o.priceDelta ?? 0;
  return Number(v) || 0;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  itemId: number;
  itemName: string;
  basePrice: number;
  imageUrl?: string | null;
  onConfirm: (payload: { modifiers: CartModifier[]; note: string; quantity: number }) => void;
}

export function ModifierBottomSheet({ visible, onClose, itemId, itemName, basePrice, imageUrl, onConfirm }: Props) {
  const colors = useColors();
  const resolvedImageUrl = resolveImageUrl(imageUrl);
  const [selected, setSelected] = useState<Record<number, Set<number>>>({});
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);

  // Fetch modifier groups for this item on open. Endpoint: GET /api/items/:itemId/modifier-groups
  const q = useQuery({
    queryKey: ["item-modifier-groups", itemId],
    queryFn: () => customFetch<ModifierGroup[]>(`/api/items/${itemId}/modifier-groups`).catch(() => [] as ModifierGroup[]),
    enabled: visible,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!visible) {
      setSelected({}); setNote(""); setQty(1);
    }
  }, [visible]);

  const groups = (Array.isArray(q.data) ? q.data : []) as ModifierGroup[];

  const toggle = (g: ModifierGroup, optId: number) => {
    setSelected((prev) => {
      const cur = new Set(prev[g.id] ?? []);
      const max = groupMax(g);
      const isSingle = max === 1;
      if (cur.has(optId)) {
        cur.delete(optId);
      } else {
        if (isSingle) cur.clear();
        if (max > 0 && cur.size >= max) {
          // bump out one to allow new pick when at cap
          const first = cur.values().next().value;
          if (first != null) cur.delete(first);
        }
        cur.add(optId);
      }
      return { ...prev, [g.id]: cur };
    });
  };

  const valid = useMemo(() => {
    return groups.every((g) => {
      const cur = selected[g.id] ?? new Set();
      return cur.size >= groupMin(g);
    });
  }, [groups, selected]);

  const liveTotal = useMemo(() => {
    let extras = 0;
    for (const g of groups) {
      const cur = selected[g.id] ?? new Set();
      for (const opt of g.modifiers ?? []) if (cur.has(opt.id)) extras += optionDelta(opt);
    }
    return (basePrice + extras) * qty;
  }, [groups, selected, basePrice, qty]);

  const handleAdd = () => {
    const out: CartModifier[] = [];
    for (const g of groups) {
      const cur = selected[g.id] ?? new Set();
      for (const opt of g.modifiers ?? []) if (cur.has(opt.id)) {
        out.push({ modifierId: opt.id, groupId: g.id, name: opt.name, priceDelta: optionDelta(opt) });
      }
    }
    onConfirm({ modifiers: out, note: note.trim(), quantity: qty });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 14 }}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {resolvedImageUrl ? (
              <Image source={{ uri: resolvedImageUrl }} style={styles.img} />
            ) : (
              <View style={[styles.img, { backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }]}>
                <Ionicons name="fast-food-outline" size={24} color={colors.primary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, { color: colors.foreground }]}>{itemName}</Text>
              <Text style={[styles.basePrice, { color: colors.mutedForeground }]}>Base ₹{basePrice.toLocaleString("en-IN")}</Text>
            </View>
          </View>

          {q.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : groups.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No customizations available — add to cart.</Text>
          ) : groups.map((g) => {
            const cur = selected[g.id] ?? new Set();
            const max = groupMax(g);
            const min = groupMin(g);
            const rule = max === 1 ? "Choose 1" : max > 0 ? `Choose up to ${max}` : "Optional";
            const label = g.displayName ?? g.name;
            return (
              <View key={g.id} style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                  <Text style={[styles.groupName, { color: colors.foreground }]}>{label}</Text>
                  {g.isRequired ? <Text style={[styles.req, { color: colors.destructive }]}>Required · min {min}</Text> : null}
                  <Text style={[styles.rule, { color: colors.mutedForeground }]}>{rule}</Text>
                </View>
                <View style={[styles.optBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {(g.modifiers ?? []).map((opt, i) => {
                    const sel = cur.has(opt.id);
                    const delta = optionDelta(opt);
                    return (
                      <Pressable
                        key={opt.id}
                        onPress={() => toggle(g, opt.id)}
                        style={[styles.opt, { borderBottomColor: colors.border, borderBottomWidth: i === (g.modifiers ?? []).length - 1 ? 0 : StyleSheet.hairlineWidth }]}
                      >
                        <View style={[styles.checkbox, { borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : "transparent" }]}>
                          {sel ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                        </View>
                        <Text style={[styles.optName, { color: colors.foreground }]} numberOfLines={1}>{opt.name}</Text>
                        {delta !== 0 ? (
                          <Text style={[styles.optDelta, { color: colors.mutedForeground }]}>{delta > 0 ? `+₹${delta}` : `₹${delta}`}</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}

          <View style={{ gap: 6 }}>
            <Text style={[styles.groupName, { color: colors.foreground }]}>Note for kitchen</Text>
            <TextInput
              value={note} onChangeText={setNote}
              placeholder="e.g. less spicy, no onion"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />
          </View>
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <View style={styles.stepper}>
            <Pressable onPress={() => setQty((q) => Math.max(1, q - 1))} style={[styles.stepBtn, { backgroundColor: colors.muted }]}>
              <Ionicons name="remove" size={18} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.qty, { color: colors.foreground }]}>{qty}</Text>
            <Pressable onPress={() => setQty((q) => q + 1)} style={[styles.stepBtn, { backgroundColor: colors.muted }]}>
              <Ionicons name="add" size={18} color={colors.foreground} />
            </Pressable>
          </View>
          <Pressable
            disabled={!valid}
            onPress={handleAdd}
            style={[styles.cta, { backgroundColor: valid ? colors.primary : colors.muted }]}
          >
            <Text style={[styles.ctaText, { color: valid ? "#fff" : colors.mutedForeground }]}>
              Add · ₹{liveTotal.toLocaleString("en-IN")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "85%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 0 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8 },
  img: { width: 72, height: 72, borderRadius: 14 },
  itemName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  basePrice: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  groupName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  req: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  rule: { fontSize: 11, fontFamily: "Inter_500Medium", marginLeft: "auto" as const },
  optBox: { borderRadius: 14, borderWidth: 1 },
  opt: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 12 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  optName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  optDelta: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, fontFamily: "Inter_400Regular" },
  footer: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  qty: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 18, textAlign: "center" },
  cta: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  ctaText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
