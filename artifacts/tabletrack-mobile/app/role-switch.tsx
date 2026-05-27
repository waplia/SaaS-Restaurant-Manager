import React from "react";
import { Pressable, View, ScrollView, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { AppText, AppIcon, AppScreen, AppHeader } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { roleHomePath, ROLE_LABEL } from "@/lib/roles";

const ROLE_ICONS: Record<string, { icon: React.ComponentProps<typeof AppIcon>["name"]; tint?: string }> = {
  owner: { icon: "briefcase-outline" },
  manager: { icon: "people-outline" },
  cashier: { icon: "cash-outline" },
  waiter: { icon: "restaurant-outline" },
  captain: { icon: "restaurant-outline" },
  kitchen: { icon: "flame-outline" },
  chef: { icon: "flame-outline" },
  inventory_manager: { icon: "cube-outline" },
  hr: { icon: "person-add-outline" },
  payroll: { icon: "wallet-outline" },
  marketing: { icon: "megaphone-outline" },
  accountant: { icon: "calculator-outline" },
  delivery_executive: { icon: "bicycle-outline" },
  customer: { icon: "person-outline" },
  super_admin: { icon: "shield-checkmark-outline" },
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Full access to every module and outlet.",
  manager: "Day-to-day operations, approvals and reports.",
  cashier: "Bill, take payments, run shift.",
  waiter: "Take orders, manage tables and KOTs.",
  captain: "Lead waiter — orders, splits, discounts.",
  kitchen: "KDS — bump KOTs as they're ready.",
  chef: "Kitchen + 86 items + recipe controls.",
  inventory_manager: "Stock, vendors, transfers, POs.",
  hr: "Staff, attendance and leave.",
  payroll: "Payroll runs, attendance, reports.",
  marketing: "Campaigns, coupons, reviews.",
  accountant: "Expenses, settlements, reports.",
  delivery_executive: "Pickup and drop-off runs.",
  customer: "Order, track, redeem rewards.",
  super_admin: "Platform-wide admin access.",
};

/**
 * "Continue as…" picker shown to users with more than one assigned role.
 * Also reachable from the More menu so an owner can hop into a staff view
 * to debug what a cashier or chef would see. Persists the selection via
 * `setActiveRole` so cold-starts land in the same place.
 */
export default function RoleSwitchScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user, roles, activeRole, setActiveRole } = useAuth();

  if (!user) {
    return (
      <AppScreen>
        <AppHeader title="Continue as" showBack />
      </AppScreen>
    );
  }

  // For owners and super-admins we expose the full role catalogue so
  // they can preview the staff app without re-logging in. For everyone
  // else only the roles actually assigned to them are selectable.
  const wildcard = user.role === "owner" || user.isSuperAdmin === true;
  const candidates: string[] = wildcard
    ? ["owner", "manager", "cashier", "waiter", "captain", "chef", "inventory_manager", "marketing", "accountant", "hr"]
    : (roles.length > 0 ? roles : [user.role]);

  const pick = async (role: string) => {
    await setActiveRole(role);
    try { router.replace(roleHomePath(role) as never); } catch { /* nav not ready */ }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, paddingTop: isWeb ? 16 : insets.top }}>
      <AppHeader title="Continue as" subtitle="Pick a role for this session" showBack />
      <ScrollView contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.sm, paddingBottom: insets.bottom + 24 }}>
        {candidates.map((role) => {
          const isActive = (activeRole ?? user.role) === role;
          const meta = ROLE_ICONS[role] ?? { icon: "person-outline" };
          return (
            <Pressable
              key={role}
              onPress={() => pick(role)}
              accessibilityRole="button"
              accessibilityLabel={`Continue as ${ROLE_LABEL[role] ?? role}`}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                padding: 16,
                borderRadius: t.radius.lg,
                borderWidth: 1,
                borderColor: isActive ? t.colors.primary : t.colors.border,
                backgroundColor: isActive ? t.colors.primary + "10" : t.colors.card,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View style={{
                width: 48, height: 48, borderRadius: 14,
                alignItems: "center", justifyContent: "center",
                backgroundColor: t.colors.primary + "1A",
              }}>
                <AppIcon name={meta.icon} size={22} color={t.colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="bodyMd" weight="semibold">{ROLE_LABEL[role] ?? role}</AppText>
                <AppText variant="small" color="mutedForeground" numberOfLines={2}>
                  {ROLE_DESCRIPTIONS[role] ?? ""}
                </AppText>
              </View>
              {isActive ? (
                <AppIcon name="checkmark-circle" size={22} color={t.colors.primary} />
              ) : (
                <AppIcon name="chevron-forward" size={20} color="mutedForeground" />
              )}
            </Pressable>
          );
        })}
        {!wildcard && candidates.length === 1 ? (
          <AppText variant="small" color="mutedForeground" align="center" style={{ marginTop: 16 }}>
            You only have one role assigned. Ask an owner to add more roles in Staff settings.
          </AppText>
        ) : null}
      </ScrollView>
    </View>
  );
}
