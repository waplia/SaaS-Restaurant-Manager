import { useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { roleHomePath } from "@/lib/roles";
import { hasSeenIntro } from "./intro";
import { OUTLET_SELECTION_VERSION_KEY } from "@/lib/outletGate";
import * as SecureStorage from "@/lib/secureStorage";

export default function IndexScreen() {
  const { user, isLoading, activeRole, outlets, outletScopeId } = useAuth();
  const colors = useColors();
  const [outletGateChecked, setOutletGateChecked] = useState(false);
  const [needsOutletPick, setNeedsOutletPick] = useState(false);

  // Async lookup of the intro-seen flag for the current user. While we wait
  // we render the splash so we never flash the dashboard before the intro
  // gate has had a chance to redirect. We reset the decision on every
  // identity change so logout/login or account switch can't reuse a stale
  // `needsIntro` value from the previous session.
  const [introChecked, setIntroChecked] = useState(false);
  const [needsIntro, setNeedsIntro] = useState(false);

  const userId = user?.id ?? null;
  const role = activeRole ?? user?.role ?? null;

  useEffect(() => {
    if (isLoading) return;
    // Reset for every new identity so a late promise from a previous
    // session can never apply its result to the current one.
    setIntroChecked(false);
    setNeedsIntro(false);

    if (!user) { setIntroChecked(true); return; }
    const isOwner = role === "owner" || role === "manager";
    if (!isOwner) { setIntroChecked(true); return; }

    // Capture the id we're checking; ignore the result if it changed.
    const checkingId = userId;
    let cancelled = false;
    void hasSeenIntro(checkingId).then((seen) => {
      if (cancelled || checkingId !== userId) return;
      setNeedsIntro(!seen);
      setIntroChecked(true);
    });
    return () => { cancelled = true; };
  }, [user, userId, role, isLoading]);

  // First-launch outlet picker gate: any user with more than one outlet
  // must pick one before they can land on a role home. We remember the
  // pick by stamping `OUTLET_SELECTION_VERSION_KEY:<userId>` once an
  // outlet is chosen (either here or via the header switcher).
  useEffect(() => {
    if (isLoading || !user) { setOutletGateChecked(true); return; }
    if (outlets.length <= 1) { setOutletGateChecked(true); setNeedsOutletPick(false); return; }
    if (outletScopeId != null) { setOutletGateChecked(true); setNeedsOutletPick(false); return; }
    let cancelled = false;
    void SecureStorage.getItem(`${OUTLET_SELECTION_VERSION_KEY}:${user.id}`).then((stamp) => {
      if (cancelled) return;
      setNeedsOutletPick(!stamp);
      setOutletGateChecked(true);
    });
    return () => { cancelled = true; };
  }, [isLoading, user, outlets.length, outletScopeId]);

  if (isLoading || !introChecked || !outletGateChecked) {
    return (
      <View style={[styles.root, { backgroundColor: "#ffffff" }]}>
        <Image
          source={require("../assets/images/brand-logo.png")}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="KhanaLagao logo"
        />
        <Text style={[styles.brand, { color: colors.foreground }]}>KhanaLagao</Text>
        <ActivityIndicator color={colors.primary} size="small" style={{ marginTop: 24 }} />
      </View>
    );
  }

  // Signed-out users land directly on the login screen. The login screen
  // exposes a "New to KhanaLagao? Create account" CTA that takes new users
  // into the /register flow, which then routes owners into /intro on
  // first sign-in. Returning signed-in users go to their role dashboard,
  // unless they've never seen the welcome intro — then we play it once.
  if (!user) {
    return <Redirect href="/login" />;
  }

  if (needsIntro) {
    return <Redirect href="/intro" />;
  }

  if (needsOutletPick) {
    return <Redirect href="/outlet-select" />;
  }

  return <Redirect href={roleHomePath(role) as never} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  logo: { width: 160, height: 160 },
  brand: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 12, letterSpacing: -0.5 },
});
