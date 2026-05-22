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
import { usePlanCapability } from "@/hooks/usePlanCapability";

interface ModuleDef {
  key: ModuleKey;
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
  group: "sell" | "operate" | "people" | "money" | "grow" | "system";
  /** Plan-boolean-feature key required for this module. Null = available on every plan. */
  feature?: string;
}

const MODULES: ModuleDef[] = [
  { key: "tables", label: "Tables", desc: "Floor map, status, transfers", icon: "grid-outline", href: "/(owner)/tables", group: "sell" },
  { key: "reservations", label: "Reservations", desc: "Today & upcoming bookings", icon: "calendar-outline", href: "/(owner)/reservations", group: "sell", feature: "reservations" },
  { key: "waiter_requests", label: "Waiter Requests", desc: "Calls from QR menus", icon: "hand-left-outline", href: "/(owner)/waiter-requests", group: "sell" },
  { key: "delivery", label: "Delivery", desc: "Riders & COD tracking", icon: "bicycle-outline", href: "/(owner)/delivery", group: "sell", feature: "delivery_module" },
  { key: "menu", label: "Menu", desc: "Toggle availability, edit", icon: "restaurant-outline", href: "/(owner)/menu", group: "operate" },
  { key: "inventory", label: "Inventory", desc: "Stock, POs, waste, vendors", icon: "cube-outline", href: "/(owner)/inventory", group: "operate", feature: "inventory_management" },
  { key: "approvals", label: "Approvals", desc: "Pending requests", icon: "checkmark-done-outline", href: "/(owner)/approvals", group: "operate" },
  { key: "staff", label: "Staff", desc: "Team roster & roles", icon: "people-outline", href: "/(owner)/staff", group: "people" },
  { key: "attendance", label: "Attendance", desc: "Clock-in & shifts", icon: "time-outline", href: "/(owner)/attendance", group: "people" },
  { key: "customers", label: "Customers", desc: "CRM, loyalty, history", icon: "person-circle-outline", href: "/(owner)/customers", group: "people" },
  { key: "feedback", label: "Feedback & Reviews", desc: "Review Booster & complaints", icon: "star-outline", href: "/(owner)/feedback", group: "people" },
  { key: "finance", label: "Finance", desc: "Payments & settlements", icon: "card-outline", href: "/(owner)/finance", group: "money" },
  { key: "expenses", label: "Expenses", desc: "Add & approve expenses", icon: "wallet-outline", href: "/(owner)/expenses", group: "money", feature: "expense_tracking" },
  { key: "reports", label: "Reports", desc: "Sales, P&L, staff, AI", icon: "bar-chart-outline", href: "/(owner)/reports", group: "money", feature: "advanced_reports" },
  { key: "billing", label: "Plans & Billing", desc: "Plan, usage, invoices, upgrade", icon: "pricetags-outline", href: "/(owner)/billing", group: "system" },
  { key: "growth", label: "Growth Engine", desc: "Campaigns, coupons, referrals", icon: "rocket-outline", href: "/(owner)/growth", group: "grow", feature: "discounts_promotions" },
  { key: "coupons", label: "Coupons", desc: "Create, edit & delete discount codes", icon: "pricetag-outline", href: "/(owner)/coupons", group: "grow", feature: "discounts_promotions" },
  { key: "khana_ai", label: "Khana AI", desc: "AI tools & chat", icon: "sparkles-outline", href: "/(owner)/khana-ai", group: "grow", feature: "khana_ai_enabled" },
  { key: "outlets", label: "Outlets", desc: "Switch branch / compare", icon: "business-outline", href: "/(owner)/outlets", group: "system" },
  { key: "notifications", label: "Notifications", desc: "All alerts in one place", icon: "notifications-outline", href: "/(owner)/notifications", group: "system" },
  { key: "support", label: "Support", desc: "Help & tickets", icon: "help-buoy-outline", href: "/(owner)/support", group: "system" },
  { key: "settings", label: "Settings", desc: "Profile, security, language", icon: "settings-outline", href: "/(owner)/settings", group: "system" },
];

/**
 * Resolve plan-gating status for every distinct feature key referenced
 * by MODULES. Rules-of-Hooks compliant: the set of keys is static across
 * renders, so we call `usePlanCapability` in a fixed order per key.
 */
function usePlanModuleMap(): Record<string, { enabled: boolean; isResolved: boolean }> {
  const reservations = usePlanCapability("reservations");
  const delivery = usePlanCapability("delivery_module");
  const inventory = usePlanCapability("inventory_management");
  const expense = usePlanCapability("expense_tracking");
  const reports = usePlanCapability("advanced_reports");
  const promos = usePlanCapability("discounts_promotions");
  const khanaAi = usePlanCapability("khana_ai_enabled");
  return {
    reservations,
    delivery_module: delivery,
    inventory_management: inventory,
    expense_tracking: expense,
    advanced_reports: reports,
    discounts_promotions: promos,
    khana_ai_enabled: khanaAi,
  };
}

const GROUP_LABEL: Record<ModuleDef["group"], string> = {
  sell: "Sell", operate: "Operate", people: "People", money: "Money", grow: "Grow", system: "Account",
};

export default function MoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user } = useAuth();

  const allowed = useMemo(() => new Set(allowedModules(user?.role)), [user?.role]);
  const planMap = usePlanModuleMap();

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

  // Resolve "locked by plan" — only a hard lock once the subscription
  // query has actually returned (isResolved). Until then we treat the
  // module as available to avoid flashing locks on first paint.
  const isLocked = (m: ModuleDef): boolean => {
    if (!m.feature) return false;
    const c = planMap[m.feature];
    if (!c || !c.isResolved) return false;
    return !c.enabled;
  };

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

        {(user?.role === "owner" || user?.role === "super_admin" || user?.role === "manager") && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.section, { color: colors.mutedForeground }]}>Profile</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Pressable
                onPress={() => router.push("/(owner)/profile" as never)}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomWidth: 0, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <CircleIcon name="storefront-outline" size={18} diameter={34} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.label, { color: colors.foreground }]}>Restaurant Profile</Text>
                  <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={1}>
                    Name, address, phone, GSTIN, UPI on bills
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>
        )}

        {Object.entries(grouped).map(([group, items]) => (
          <View key={group} style={{ gap: 8 }}>
            <Text style={[styles.section, { color: colors.mutedForeground }]}>{GROUP_LABEL[group as ModuleDef["group"]]}</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {items.map((m, i) => {
                const locked = isLocked(m);
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => router.push((locked ? "/(owner)/billing" : m.href) as never)}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        borderBottomColor: colors.border,
                        borderBottomWidth: i === items.length - 1 ? 0 : StyleSheet.hairlineWidth,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={{ opacity: locked ? 0.55 : 1 }}>
                      <CircleIcon name={m.icon} size={18} diameter={34} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[styles.label, { color: locked ? colors.mutedForeground : colors.foreground }]}>{m.label}</Text>
                        {locked && (
                          <View style={[styles.lockBadge, { backgroundColor: colors.primary + "1A" }]}>
                            <Ionicons name="lock-closed" size={10} color={colors.primary} />
                            <Text style={[styles.lockBadgeText, { color: colors.primary }]}>Upgrade</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={1}>{m.desc}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                  </Pressable>
                );
              })}
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
  lockBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  lockBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.2 },
});
