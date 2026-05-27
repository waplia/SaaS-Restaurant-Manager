import React from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { AppBottomSheet, AppText, AppIcon, AppEmptyState } from "@/components/ui";
import { useAuth, type AuthOutlet } from "@/context/AuthContext";
import { stampOutletSelection } from "@/lib/outletGate";

export interface OutletSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Bottom-sheet outlet picker shared across every role shell. Lists the
 * outlets the user can access (from `/auth/me`'s `outlets[]`) with the
 * currently active outlet highlighted. Selecting one updates the global
 * outlet scope and closes the sheet.
 *
 * For staff with a single outlet, the sheet shows an empty-state message
 * rather than a one-row list (the caller normally hides the trigger
 * altogether in that case).
 */
export function OutletSwitcherSheet({ visible, onClose }: OutletSwitcherSheetProps) {
  const t = useTheme();
  const { user, outlets, outletScopeId, restaurantId, setOutletScopeId } = useAuth();
  const activeId = outletScopeId ?? restaurantId;

  const select = (id: number | null) => {
    setOutletScopeId(id);
    // Satisfy the first-launch outlet gate so we don't bounce the user
    // back to /outlet-select on the next cold start.
    void stampOutletSelection(user?.id);
    onClose();
  };

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title="Switch outlet">
      {outlets.length === 0 ? (
        <AppEmptyState
          icon="business-outline"
          title="No outlets available"
          description="Your account isn't attached to any outlet yet."
        />
      ) : (
        <View style={{ gap: 6 }}>
          {outlets.length > 1 ? (
            <OutletRow
              label="All outlets"
              subtitle="Aggregate across every outlet"
              active={outletScopeId == null}
              onPress={() => select(null)}
              iconName="apps-outline"
              tint={t.colors.primary}
            />
          ) : null}
          {outlets.map((o: AuthOutlet) => (
            <OutletRow
              key={o.id}
              label={o.name}
              subtitle={o.city ?? undefined}
              active={activeId === o.id}
              onPress={() => select(o.id)}
              iconName="storefront-outline"
              tint={t.colors.primary}
              disabled={o.isActive === false}
            />
          ))}
        </View>
      )}
    </AppBottomSheet>
  );
}

function OutletRow({
  label, subtitle, active, onPress, iconName, tint, disabled,
}: {
  label: string;
  subtitle?: string;
  active: boolean;
  onPress: () => void;
  iconName: React.ComponentProps<typeof AppIcon>["name"];
  tint: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: active ? tint : t.colors.border,
        backgroundColor: active ? tint + "12" : t.colors.card,
        opacity: pressed ? 0.85 : disabled ? 0.5 : 1,
      })}
    >
      <View style={{
        width: 36, height: 36, borderRadius: 10,
        alignItems: "center", justifyContent: "center",
        backgroundColor: tint + "1A",
      }}>
        <AppIcon name={iconName} size={18} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyMd" weight="semibold">{label}</AppText>
        {subtitle ? (
          <AppText variant="small" color="mutedForeground">{subtitle}</AppText>
        ) : null}
      </View>
      {active ? <AppIcon name="checkmark-circle" size={20} color={tint} /> : null}
    </Pressable>
  );
}
