import React from "react";
import { View, Text, Pressable, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

interface Props {
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  isVeg?: boolean;
  isBestseller?: boolean;
  category?: string | null;
  isAvailable?: boolean;
  outOfStock?: boolean;
  hasModifiers?: boolean;
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
  onCustomize?: () => void;
}

/**
 * Image-forward menu item card used on the New Order screen.
 * Shows veg/non-veg dot, bestseller badge, stock state, and either
 * an Add stepper or a Customize button (when the item has modifiers).
 */
export function ItemCard({
  name, description, price, imageUrl, isVeg, isBestseller, category,
  isAvailable = true, outOfStock = false, hasModifiers = false,
  quantity, onAdd, onRemove, onCustomize,
}: Props) {
  const colors = useColors();
  const disabled = !isAvailable || outOfStock;
  const haptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: disabled ? 0.6 : 1 }]}>
      <View style={styles.imageWrap}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imagePh, { backgroundColor: colors.accent }]}>
            <Ionicons name="fast-food-outline" size={28} color={colors.primary} />
          </View>
        )}
        {isBestseller ? (
          <View style={styles.bestBadge}>
            <Ionicons name="star" size={9} color="#fff" />
            <Text style={styles.bestText}>Bestseller</Text>
          </View>
        ) : null}
        {outOfStock ? (
          <View style={styles.outChip}>
            <Text style={styles.outText}>Out of stock</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          {isVeg != null ? (
            <View style={[styles.vegBox, { borderColor: isVeg ? "#16a34a" : "#dc2626" }]}>
              <View style={[styles.vegDot, { backgroundColor: isVeg ? "#16a34a" : "#dc2626" }]} />
            </View>
          ) : null}
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
        </View>
        {category ? (
          <Text style={[styles.cat, { color: colors.mutedForeground }]} numberOfLines={1}>{category}</Text>
        ) : null}
        {description ? (
          <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>{description}</Text>
        ) : null}

        <View style={styles.footRow}>
          <Text style={[styles.price, { color: colors.foreground }]}>₹{Number(price).toLocaleString("en-IN")}</Text>
          {disabled ? (
            <Text style={[styles.unavail, { color: colors.mutedForeground }]}>Unavailable</Text>
          ) : hasModifiers && quantity === 0 ? (
            <Pressable
              onPress={() => { haptic(); onCustomize?.(); }}
              style={[styles.customBtn, { borderColor: colors.primary }]}
            >
              <Text style={[styles.customText, { color: colors.primary }]}>Customize</Text>
              <Ionicons name="chevron-down" size={12} color={colors.primary} />
            </Pressable>
          ) : quantity > 0 ? (
            <View style={styles.stepper}>
              <Pressable onPress={() => { haptic(); onRemove(); }} style={[styles.stepBtn, { backgroundColor: colors.muted }]}>
                <Ionicons name="remove" size={16} color={colors.foreground} />
              </Pressable>
              <Text style={[styles.qty, { color: colors.foreground }]}>{quantity}</Text>
              <Pressable onPress={() => { haptic(); hasModifiers ? onCustomize?.() : onAdd(); }} style={[styles.stepBtn, { backgroundColor: colors.primary }]}>
                <Ionicons name="add" size={16} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => { haptic(); onAdd(); }} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", borderRadius: 20, borderWidth: 1, padding: 10, gap: 12, marginBottom: 10 },
  imageWrap: { width: 88, height: 88, borderRadius: 14, overflow: "hidden", position: "relative" },
  image: { width: "100%", height: "100%" },
  imagePh: { alignItems: "center", justifyContent: "center" },
  bestBadge: { position: "absolute", top: 4, left: 4, flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "#f97316", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8 },
  bestText: { color: "#fff", fontSize: 9, fontFamily: "Inter_700Bold" },
  outChip: { position: "absolute", bottom: 4, left: 4, right: 4, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 6, paddingVertical: 2, alignItems: "center" },
  outText: { color: "#fff", fontSize: 9, fontFamily: "Inter_600SemiBold" },
  body: { flex: 1, gap: 2, justifyContent: "space-between" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  vegBox: { width: 12, height: 12, borderWidth: 1.5, borderRadius: 2, alignItems: "center", justifyContent: "center" },
  vegDot: { width: 6, height: 6, borderRadius: 3 },
  name: { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold" },
  cat: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  desc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  footRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  price: { fontSize: 16, fontFamily: "Inter_700Bold" },
  unavail: { fontSize: 12, fontFamily: "Inter_500Medium" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  addText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  customBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5 },
  customText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  qty: { fontSize: 15, fontFamily: "Inter_700Bold", minWidth: 16, textAlign: "center" },
});
