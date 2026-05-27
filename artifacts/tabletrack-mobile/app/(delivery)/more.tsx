import React from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { MyShiftPanel } from "@/components/MyShiftPanel";
import { useAuth } from "@/context/AuthContext";

interface Item {
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  href?: string;
  onPress?: () => void;
  tint?: string;
  danger?: boolean;
}

export default function MoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const isWeb = Platform.OS === "web";

  async function doLogout() {
    await logout();
    router.replace("/login");
  }

  const items: Item[] = [
    { label: "Tiffin route", desc: "Today's subscription tiffin stops", icon: "restaurant-outline", href: "/(delivery)/tiffin-route" },
    { label: "Notifications", desc: "Delivery alerts & messages", icon: "notifications-outline", href: "/notifications" },
    { label: "Profile", desc: "Your details & phone", icon: "person-circle-outline", href: "/profile" },
    { label: "Settings", desc: "Language, theme, notifications", icon: "settings-outline", href: "/settings" },
    { label: "Support", desc: "Help & feedback", icon: "help-buoy-outline", href: "/support" },
    { label: "Sign out", desc: "End your shift session", icon: "log-out-outline", onPress: doLogout, danger: true },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: isWeb ? 16 : insets.top + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>More</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {user?.name ?? "Rider"} · {user?.role === "delivery_executive" ? "Delivery executive" : (user?.role ?? "")}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}>
        <View style={{ marginHorizontal: -16 }}>
          <MyShiftPanel />
        </View>
        {items.map((it) => (
          <Pressable
            key={it.label}
            onPress={() => (it.onPress ? it.onPress() : it.href && router.push(it.href as never))}
            style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: it.danger ? "#fee2e2" : colors.background }]}>
              <Ionicons name={it.icon} size={20} color={it.danger ? "#dc2626" : colors.foreground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: it.danger ? "#dc2626" : colors.foreground }]}>{it.label}</Text>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{it.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  iconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
