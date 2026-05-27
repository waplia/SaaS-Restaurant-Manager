import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useChefColors } from "@/hooks/useChefColors";
import { useAuth } from "@/context/AuthContext";
import { useKitchensList } from "@/hooks/useKdsTickets";
import { MyShiftPanel } from "@/components/MyShiftPanel";

interface Row {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  hint?: string;
  onPress: () => void;
  destructive?: boolean;
}

/**
 * Chef "More" tab — profile, station, role switch, sign out. We
 * intentionally keep this small: the chef shouldn't be navigating to
 * billing or marketing screens from a hot-line tablet. Anything that
 * isn't part of the kitchen workflow lives behind an extra tap.
 */
export default function ChefMoreScreen() {
  const colors = useChefColors();
  const insets = useSafeAreaInsets();
  const { user, logout, restaurantId, roles, activeOutlet } = useAuth();
  const kitchensQ = useKitchensList(restaurantId);
  const myStation = user?.kitchenId != null
    ? kitchensQ.data?.find((k) => k.id === user.kitchenId)?.name ?? null
    : null;

  const rows: Row[] = [
    { icon: "person-circle-outline", label: "Profile", onPress: () => router.push("/profile" as never) },
    ...(roles && roles.length > 1
      ? [{ icon: "swap-horizontal" as const, label: "Switch role", onPress: () => router.push("/role-switch" as never) }]
      : []),
    { icon: "notifications-outline", label: "Notification settings", onPress: () => router.push("/notification-settings" as never) },
    { icon: "help-circle-outline", label: "Help & support", onPress: () => router.push("/support" as never) },
    {
      icon: "log-out-outline", label: "Sign out", destructive: true,
      onPress: () => { void logout(); },
    },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 96, paddingHorizontal: 16, gap: 12 }}
    >
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: colors.primary + "33", borderColor: colors.primary }]}>
          <Ionicons name="restaurant" size={28} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
            {user?.name ?? "Chef"}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {user?.role === "chef" ? "Chef" : "Kitchen staff"}
            {activeOutlet?.name ? ` · ${activeOutlet.name}` : ""}
          </Text>
          {myStation ? (
            <View style={[styles.stationPill, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Ionicons name="flame" size={12} color={colors.primary} />
              <Text style={[styles.stationText, { color: colors.foreground }]}>{myStation}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ marginHorizontal: -16 }}>
        <MyShiftPanel />
      </View>

      <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {rows.map((r, idx) => (
          <Pressable
            key={r.label}
            onPress={r.onPress}
            style={({ pressed }) => [
              styles.row,
              { borderTopColor: colors.border, borderTopWidth: idx === 0 ? 0 : 1, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Ionicons name={r.icon} size={20} color={r.destructive ? "#f87171" : colors.foreground} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: r.destructive ? "#fca5a5" : colors.foreground }]}>{r.label}</Text>
              {r.hint ? <Text style={[styles.rowHint, { color: colors.mutedForeground }]}>{r.hint}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 14, borderWidth: 1 },
  avatar: { width: 56, height: 56, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 18, fontFamily: "Inter_700Bold" },
  meta: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 2 },
  stationPill: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  stationText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  list: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
