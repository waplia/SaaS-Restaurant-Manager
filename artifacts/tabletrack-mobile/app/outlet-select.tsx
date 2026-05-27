import React from "react";
import { View, ScrollView, Pressable, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { AppText, AppIcon, AppHeader, AppEmptyState } from "@/components/ui";
import { useAuth, type AuthOutlet } from "@/context/AuthContext";
import { stampOutletSelection } from "@/lib/outletGate";
import { roleHomePath } from "@/lib/roles";

/**
 * First-launch outlet picker. Required for users attached to more than
 * one outlet — they must pick a default scope before the app routes
 * them into any role home. Owners can later switch via the header
 * outlet sheet; this screen just satisfies the initial gate.
 */
export default function OutletSelectScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user, outlets, activeRole, setOutletScopeId } = useAuth();

  const choose = async (o: AuthOutlet | null) => {
    setOutletScopeId(o ? o.id : null);
    await stampOutletSelection(user?.id);
    try {
      router.replace(roleHomePath(activeRole ?? user?.role) as never);
    } catch { /* nav not ready */ }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background, paddingTop: isWeb ? 16 : insets.top }}>
      <AppHeader title="Choose outlet" subtitle="Pick the outlet you'll be working from" />
      <ScrollView
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.sm, paddingBottom: insets.bottom + 24 }}
      >
        {outlets.length === 0 ? (
          <AppEmptyState
            icon="business-outline"
            title="No outlets available"
            description="Your account isn't attached to any outlet yet. Ask an owner to add you."
          />
        ) : (
          <>
            {(user?.role === "owner" || user?.isSuperAdmin) && outlets.length > 1 ? (
              <OutletRow
                label="All outlets"
                subtitle="Aggregate view across every outlet"
                iconName="apps-outline"
                onPress={() => { void choose(null); }}
              />
            ) : null}
            {outlets.map((o) => (
              <OutletRow
                key={o.id}
                label={o.name}
                subtitle={o.city ?? undefined}
                iconName="storefront-outline"
                disabled={o.isActive === false}
                onPress={() => { void choose(o); }}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function OutletRow({
  label, subtitle, iconName, onPress, disabled,
}: {
  label: string;
  subtitle?: string;
  iconName: React.ComponentProps<typeof AppIcon>["name"];
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Continue from ${label}`}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 14,
        padding: 16, borderRadius: t.radius.lg, borderWidth: 1,
        borderColor: t.colors.border, backgroundColor: t.colors.card,
        opacity: pressed ? 0.85 : disabled ? 0.5 : 1,
      })}
    >
      <View style={{
        width: 48, height: 48, borderRadius: 14,
        alignItems: "center", justifyContent: "center",
        backgroundColor: t.colors.primary + "1A",
      }}>
        <AppIcon name={iconName} size={22} color={t.colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="bodyMd" weight="semibold">{label}</AppText>
        {subtitle ? <AppText variant="small" color="mutedForeground">{subtitle}</AppText> : null}
      </View>
      <AppIcon name="chevron-forward" size={20} color="mutedForeground" />
    </Pressable>
  );
}
