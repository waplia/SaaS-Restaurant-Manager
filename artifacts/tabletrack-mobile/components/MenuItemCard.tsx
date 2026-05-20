import React from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { resolveImageUrl } from "@/lib/resolveImageUrl";

interface MenuItemCardProps {
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  quantity: number;
  isAvailable: boolean;
  onAdd: () => void;
  onRemove: () => void;
}

export function MenuItemCard({ name, description, price, imageUrl, quantity, isAvailable, onAdd, onRemove }: MenuItemCardProps) {
  const colors = useColors();
  const resolvedImageUrl = resolveImageUrl(imageUrl);

  const handleAdd = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onAdd();
  };

  const handleRemove = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRemove();
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: isAvailable ? 1 : 0.5 }]}>
      {resolvedImageUrl ? (
        <Image source={{ uri: resolvedImageUrl }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.imagePlaceholder, { backgroundColor: colors.accent }]}>
          <Ionicons name="fast-food-outline" size={28} color={colors.primary} />
        </View>
      )}
      <View style={styles.content}>
        <View style={styles.info}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
          {description ? (
            <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>{description}</Text>
          ) : null}
          <Text style={[styles.price, { color: colors.primary }]}>₹{Number(price).toLocaleString()}</Text>
        </View>
        {isAvailable ? (
          <View style={styles.controls}>
            {quantity > 0 ? (
              <>
                <Pressable onPress={handleRemove} style={[styles.btn, { backgroundColor: colors.muted }]}>
                  <Ionicons name="remove" size={16} color={colors.foreground} />
                </Pressable>
                <Text style={[styles.qty, { color: colors.foreground }]}>{quantity}</Text>
              </>
            ) : null}
            <Pressable onPress={handleAdd} style={[styles.btn, { backgroundColor: colors.primary }]}>
              <Ionicons name="add" size={16} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <Text style={[styles.unavail, { color: colors.mutedForeground }]}>Unavailable</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    flexDirection: "row",
    overflow: "hidden",
  },
  image: { width: 80, height: 80 },
  imagePlaceholder: { width: 80, height: 80, alignItems: "center", justifyContent: "center" },
  content: { flex: 1, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 12, fontFamily: "Inter_400Regular" },
  price: { fontSize: 14, fontFamily: "Inter_700Bold", marginTop: 4 },
  controls: { flexDirection: "row", alignItems: "center", gap: 6 },
  btn: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  qty: { fontSize: 15, fontFamily: "Inter_700Bold", minWidth: 20, textAlign: "center" },
  unavail: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
