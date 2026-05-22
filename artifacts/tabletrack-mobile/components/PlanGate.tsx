import React, { type ComponentType } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { usePlanCapability } from "@/hooks/usePlanCapability";

interface PlanGateProps {
  feature: string;
  children: React.ReactNode;
}

/**
 * Renders `children` only when the tenant's plan has `feature` enabled.
 * Otherwise renders a friendly "Feature locked" card that links to the
 * billing/upgrade screen — mirrors the web `<PlanProtectedRoute>` card.
 *
 * Use either as a wrapper:
 *   <PlanGate feature="kitchen_display"><KitchenInner /></PlanGate>
 * Or via the `withPlanGate(Component, feature)` HOC at the bottom of a
 * screen file, which is the pattern adopted across (owner)/* screens.
 */
export function PlanGate({ feature, children }: PlanGateProps) {
  const colors = useColors();
  const cap = usePlanCapability(feature);

  // Mirror the web `PlanProtectedRoute` policy: only spin while the
  // subscription query is *actively* loading. If the request fails
  // (offline, transient 5xx, or 403 for a role the endpoint doesn't
  // permit) we fail-OPEN and render the children — gating is enforced
  // server-side on every business endpoint anyway, so the worst case is
  // the screen renders and individual API calls return 402/403. Better
  // than locking a paying tenant out of features they paid for.
  if (cap.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (cap.enabled || !cap.isResolved) return <>{children}</>;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + "1A" }]}>
          <Ionicons name="lock-closed" size={26} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>{cap.featureLabel}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {cap.planName
            ? `${cap.featureLabel} is not included on your ${cap.planName} plan.`
            : `${cap.featureLabel} requires a paid plan.`}{" "}
          Upgrade to unlock this feature for your team.
        </Text>
        <Pressable
          onPress={() => router.push("/(owner)/billing" as never)}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.ctaText}>See plans</Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * HOC convenience for screens that want to gate their entire default
 * export. Rename the component to a non-default function and append:
 *   export default withPlanGate(MyScreen, "feature_key");
 */
export function withPlanGate<P extends object>(Component: ComponentType<P>, feature: string) {
  const Wrapped = (props: P) => (
    <PlanGate feature={feature}>
      <Component {...props} />
    </PlanGate>
  );
  Wrapped.displayName = `withPlanGate(${Component.displayName || Component.name || "Component"})`;
  return Wrapped;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: 20, padding: 28, alignItems: "center" },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 6, textAlign: "center" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, marginBottom: 20 },
  cta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 },
  ctaText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
