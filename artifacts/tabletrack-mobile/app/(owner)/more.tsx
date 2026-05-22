import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { allowedModules, ROLE_LABEL, type ModuleKey } from "@/lib/roles";
import { OfflineBanner } from "@/components/OfflineBanner";
import { AICreditChip } from "@/components/AICreditChip";
import { CircleIcon } from "@/components/Icon";

interface ModuleDef {
  key: ModuleKey;
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
  group: "sell" | "operate" | "people" | "money" | "grow" | "system";
}

const MODULES: ModuleDef[] = [
  { key: "tables", label: "Tables", desc: "Floor map, status, transfers", icon: "grid-outline", href: "/(owner)/tables", group: "sell" },
  { key: "reservations", label: "Reservations", desc: "Today & upcoming bookings", icon: "calendar-outline", href: "/(owner)/reservations", group: "sell" },
  { key: "waiter_requests", label: "Waiter Requests", desc: "Calls from QR menus", icon: "hand-left-outline", href: "/(owner)/waiter-requests", group: "sell" },
  { key: "delivery", label: "Delivery", desc: "Riders & COD tracking", icon: "bicycle-outline", href: "/(owner)/delivery", group: "sell" },
  { key: "menu", label: "Menu", desc: "Toggle availability, edit", icon: "restaurant-outline", href: "/(owner)/menu", group: "operate" },
  { key: "inventory", label: "Inventory", desc: "Stock, POs, waste, vendors", icon: "cube-outline", href: "/(owner)/inventory", group: "operate" },
  { key: "approvals", label: "Approvals", desc: "Pending requests", icon: "checkmark-done-outline", href: "/(owner)/approvals", group: "operate" },
  { key: "staff", label: "Staff", desc: "Team roster & roles", icon: "people-outline", href: "/(owner)/staff", group: "people" },
  { key: "attendance", label: "Attendance", desc: "Clock-in & shifts", icon: "time-outline", href: "/(owner)/attendance", group: "people" },
  { key: "customers", label: "Customers", desc: "CRM, loyalty, history", icon: "person-circle-outline", href: "/(owner)/customers", group: "people" },
  { key: "feedback", label: "Feedback & Reviews", desc: "Review Booster & complaints", icon: "star-outline", href: "/(owner)/feedback", group: "people" },
  { key: "finance", label: "Finance", desc: "Payments & settlements", icon: "card-outline", href: "/(owner)/finance", group: "money" },
  { key: "expenses", label: "Expenses", desc: "Add & approve expenses", icon: "wallet-outline", href: "/(owner)/expenses", group: "money" },
  { key: "reports", label: "Reports", desc: "Sales, P&L, staff, AI", icon: "bar-chart-outline", href: "/(owner)/reports", group: "money" },
  { key: "billing", label: "Plans & Billing", desc: "Plan, usage, invoices, upgrade", icon: "pricetags-outline", href: "/(owner)/billing", group: "system" },
  { key: "growth", label: "Growth Engine", desc: "Campaigns, coupons, referrals", icon: "rocket-outline", href: "/(owner)/growth", group: "grow" },
  { key: "growth", label: "Coupons", desc: "Create, edit & delete discount codes", icon: "pricetag-outline", href: "/(owner)/coupons", group: "grow" },
  { key: "khana_ai", label: "Khana AI", desc: "AI tools & chat", icon: "sparkles-outline", href: "/(owner)/khana-ai", group: "grow" },
  { key: "outlets", label: "Outlets", desc: "Switch branch / compare", icon: "business-outline", href: "/(owner)/outlets", group: "system" },
  { key: "notifications", label: "Notifications", desc: "All alerts in one place", icon: "notifications-outline", href: "/(owner)/notifications", group: "system" },
  { key: "support", label: "Support", desc: "Help & tickets", icon: "help-buoy-outline", href: "/(owner)/support", group: "system" },
  { key: "settings", label: "Settings", desc: "Profile, security, language", icon: "settings-outline", href: "/(owner)/settings", group: "system" },
];

const GROUP_LABEL: Record<ModuleDef["group"], string> = {
  sell: "Sell", operate: "Operate", people: "People", money: "Money", grow: "Grow", system: "Account",
};

export default function MoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user } = useAuth();

  const allowed = useMemo(() => new Set(allowedModules(user?.role)), [user?.role]);
  const grouped = useMemo(() => {
    const order: ModuleDef["group"][] = ["sell", "operate", "people", "money", "grow", "system"];
    const out: Record<string, ModuleDef[]> = {};
    for (const g of order) out[g] = [];
    for (const m of MODULES) {
      if (!allowed.has(m.key)) continue;
      out[m.group].push(m);
    }
    for (const g of order) if (out[g].length === 0) delete out[g];
    return out;
  }, [allowed]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: isWeb ? 67 + 8 : insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: isWeb ? 34 + 100 : insets.bottom + 100,
          gap: 18,
        }}
      >
        <OfflineBanner />
        <View style={styles.header}>
          <Pressable
            onPress={() => router.push("/(owner)/settings" as never)}
            style={[styles.avatar, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.avatarText}>{(user?.name ?? "U")[0]?.toUpperCase()}</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{user?.name}</Text>
            <Text style={[styles.role, { color: colors.mutedForeground }]}>
              {ROLE_LABEL[user?.role ?? ""] ?? user?.role}
            </Text>
          </View>
          <AICreditChip />
        </View>

        {Object.entries(grouped).map(([group, items]) => (
          <View key={group} style={{ gap: 8 }}>
            <Text style={[styles.section, { color: colors.mutedForeground }]}>{GROUP_LABEL[group as ModuleDef["group"]]}</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {items.map((m, i) => (
                <Pressable
                  key={m.key}
                  onPress={() => router.push(m.href as never)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderBottomColor: colors.border,
                      borderBottomWidth: i === items.length - 1 ? 0 : StyleSheet.hairlineWidth,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <CircleIcon name={m.icon} size={18} diameter={34} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.label, { color: colors.foreground }]}>{m.label}</Text>
                    <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={1}>{m.desc}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 20, fontFamily: "Inter_700Bold" },
  name: { fontSize: 18, fontFamily: "Inter_700Bold" },
  role: { fontSize: 13, fontFamily: "Inter_500Medium" },
  section: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 4 },
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  label: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
