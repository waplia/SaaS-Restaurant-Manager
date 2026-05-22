import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, Pressable, StyleSheet, Dimensions, Platform,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, {
  FadeIn, FadeOut, SlideInRight, SlideOutLeft,
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence,
  withDelay, withSpring, Easing, interpolate,
} from "react-native-reanimated";
import { useAuth } from "@/context/AuthContext";

/* -------------------------------------------------------------------------- */
/* Persistence — show this intro exactly once per user.                       */
/* -------------------------------------------------------------------------- */

function introKey(userId: number | string | null | undefined) {
  return `kl:intro:seen:${userId ?? "anon"}`;
}
export async function markIntroSeen(userId: number | string | null | undefined) {
  try { await AsyncStorage.setItem(introKey(userId), "1"); } catch { /* ignore */ }
}
export async function hasSeenIntro(userId: number | string | null | undefined) {
  try { return (await AsyncStorage.getItem(introKey(userId))) === "1"; } catch { return false; }
}

/* -------------------------------------------------------------------------- */
/* Phone-frame mock used inside every slide                                   */
/* -------------------------------------------------------------------------- */

const PHONE_W = 220;
const PHONE_H = 420;

function PhoneFrame({ children, tint = "#0f172a" }: { children: React.ReactNode; tint?: string }) {
  return (
    <View style={[styles.phoneOuter, { backgroundColor: tint }]}>
      <View style={styles.phoneNotch} />
      <View style={styles.phoneScreen}>{children}</View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Slide 1 — Hello                                                            */
/* -------------------------------------------------------------------------- */

function SlideHello({ name }: { name?: string }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1800 }), -1, true);
  }, [pulse]);
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.18]) }],
    opacity: interpolate(pulse.value, [0, 1], [0.55, 0]),
  }));

  return (
    <View style={styles.slideBody}>
      <PhoneFrame>
        <LinearGradient
          colors={["#FFF7ED", "#FFEDD5", "#FED7AA"]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.helloInner}>
          <View style={{ alignItems: "center", justifyContent: "center" }}>
            <Animated.View style={[styles.helloRing, ring]} />
            <Animated.View
              entering={FadeIn.delay(100).springify()}
              style={styles.helloLogo}
            >
              <Text style={{ fontSize: 44 }}>🍽️</Text>
            </Animated.View>
          </View>
          <Animated.Text entering={FadeIn.delay(280)} style={styles.helloHi}>
            Hello{name ? `, ${name.split(" ")[0]}` : ""} 👋
          </Animated.Text>
          <Animated.Text entering={FadeIn.delay(440)} style={styles.helloSub}>
            Welcome to KhanaLagao
          </Animated.Text>
        </View>
      </PhoneFrame>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Slide 2 — Snap the menu (camera + flash)                                   */
/* -------------------------------------------------------------------------- */

function SlideSnap() {
  const flash = useSharedValue(0);
  const lift = useSharedValue(0);
  useEffect(() => {
    flash.value = withRepeat(
      withSequence(
        withDelay(900, withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) })),
        withTiming(0, { duration: 240 }),
        withDelay(1200, withTiming(0, { duration: 1 })),
      ),
      -1, false,
    );
    lift.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
      ),
      -1, false,
    );
  }, [flash, lift]);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.85 }));
  const phoneStyle = useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }] }));

  return (
    <View style={styles.slideBody}>
      <Animated.View style={phoneStyle}>
        <PhoneFrame>
          {/* simulated menu page */}
          <LinearGradient colors={["#FAFAF9", "#F5F5F4"]} style={StyleSheet.absoluteFill} />
          <View style={styles.menuPaper}>
            <Text style={styles.menuHead}>SPICE GARDEN</Text>
            <View style={styles.menuDiv} />
            {["Paneer Tikka", "Butter Chicken", "Veg Biryani", "Garlic Naan", "Gulab Jamun"].map((n, i) => (
              <View key={n} style={styles.menuRow}>
                <Text style={styles.menuName}>{n}</Text>
                <Text style={styles.menuPrice}>₹{180 + i * 30}</Text>
              </View>
            ))}
          </View>
          {/* viewfinder overlay */}
          <View style={styles.vf}>
            {[
              { top: 10, left: 10, borderTopWidth: 3, borderLeftWidth: 3 },
              { top: 10, right: 10, borderTopWidth: 3, borderRightWidth: 3 },
              { bottom: 10, left: 10, borderBottomWidth: 3, borderLeftWidth: 3 },
              { bottom: 10, right: 10, borderBottomWidth: 3, borderRightWidth: 3 },
            ].map((s, i) => (
              <View key={i} style={[styles.vfCorner, s]} />
            ))}
          </View>
          <View style={styles.shutter}>
            <View style={styles.shutterDot} />
          </View>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#fff" }, flashStyle]} />
        </PhoneFrame>
      </Animated.View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Slide 3 — AI extracting items                                              */
/* -------------------------------------------------------------------------- */

function SlideAI() {
  const items = ["Paneer Tikka", "Butter Chicken", "Veg Biryani", "Garlic Naan", "Gulab Jamun"];
  const wand = useSharedValue(0);
  useEffect(() => {
    wand.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ), -1, false);
  }, [wand]);
  const wandStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(wand.value, [0, 1], [-12, 12])}deg` }],
  }));

  return (
    <View style={styles.slideBody}>
      <PhoneFrame>
        <LinearGradient colors={["#EFF6FF", "#DBEAFE"]} style={StyleSheet.absoluteFill} />
        <View style={{ flex: 1, padding: 14 }}>
          <View style={styles.aiHead}>
            <Animated.View style={wandStyle}>
              <Ionicons name="sparkles" size={20} color="#7C3AED" />
            </Animated.View>
            <Text style={styles.aiHeadTxt}>Khana AI is reading your menu…</Text>
          </View>
          <View style={{ gap: 8, marginTop: 14 }}>
            {items.map((it, i) => (
              <Animated.View
                key={it}
                entering={FadeIn.delay(220 * i).duration(380)}
                style={styles.aiRow}
              >
                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                <Text style={styles.aiName}>{it}</Text>
                <Text style={styles.aiPrice}>₹{180 + i * 30}</Text>
              </Animated.View>
            ))}
          </View>
          <Animated.View entering={FadeIn.delay(1300)} style={styles.aiPill}>
            <Text style={styles.aiPillTxt}>+ 18 more items</Text>
          </Animated.View>
        </View>
      </PhoneFrame>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Slide 4 — Review & confirm checklist                                       */
/* -------------------------------------------------------------------------- */

function SlideReview() {
  const checks = [
    "Menu imported (23 items)",
    "Categories auto-grouped",
    "Tables set up (12)",
    "Kitchen ready",
  ];
  return (
    <View style={styles.slideBody}>
      <PhoneFrame>
        <LinearGradient colors={["#ECFDF5", "#D1FAE5"]} style={StyleSheet.absoluteFill} />
        <View style={{ flex: 1, padding: 16, gap: 12 }}>
          <Text style={styles.reviewTitle}>You're all set ✨</Text>
          {checks.map((c, i) => (
            <Animated.View
              key={c}
              entering={SlideInRight.delay(180 * i).springify().damping(14)}
              style={styles.reviewRow}
            >
              <View style={styles.reviewCheck}>
                <Ionicons name="checkmark" size={14} color="#fff" />
              </View>
              <Text style={styles.reviewTxt}>{c}</Text>
            </Animated.View>
          ))}
        </View>
      </PhoneFrame>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Slide 5 — Launch (order grid)                                              */
/* -------------------------------------------------------------------------- */

function SlideLaunch() {
  const tiles = useMemo(() => [
    { label: "New order", icon: "add-circle", color: "#F97316" },
    { label: "Tables", icon: "grid", color: "#0EA5E9" },
    { label: "Kitchen", icon: "flame", color: "#EF4444" },
    { label: "Menu", icon: "restaurant", color: "#10B981" },
    { label: "Reports", icon: "bar-chart", color: "#7C3AED" },
    { label: "Customers", icon: "people", color: "#EAB308" },
  ], []);
  return (
    <View style={styles.slideBody}>
      <PhoneFrame>
        <LinearGradient colors={["#FFF1F2", "#FFE4E6"]} style={StyleSheet.absoluteFill} />
        <View style={{ flex: 1, padding: 14 }}>
          <Text style={styles.launchHead}>Good evening, Chef 👨‍🍳</Text>
          <Text style={styles.launchSub}>Start taking orders in 10 seconds</Text>
          <View style={styles.tileGrid}>
            {tiles.map((t, i) => (
              <Animated.View
                key={t.label}
                entering={FadeIn.delay(120 * i).springify()}
                style={styles.tile}
              >
                <View style={[styles.tileIcon, { backgroundColor: t.color + "1A" }]}>
                  <Ionicons name={t.icon as keyof typeof Ionicons.glyphMap} size={22} color={t.color} />
                </View>
                <Text style={styles.tileLabel}>{t.label}</Text>
              </Animated.View>
            ))}
          </View>
        </View>
      </PhoneFrame>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Slide list                                                                 */
/* -------------------------------------------------------------------------- */

const SLIDE_MS = 3800;

const SLIDES = [
  { id: "hello",  eyebrow: "Welcome",   title: "Let's get you set up",       sub: "It only takes a couple of minutes.",                       Visual: SlideHello },
  { id: "snap",   eyebrow: "Step 1",    title: "Snap a photo of your menu",  sub: "Old menu card, printout, PDF — anything works.",            Visual: SlideSnap },
  { id: "ai",     eyebrow: "Step 2",    title: "AI extracts every item",     sub: "Names, prices, categories — done in seconds.",              Visual: SlideAI },
  { id: "review", eyebrow: "Step 3",    title: "Review & confirm",           sub: "Tap to tweak. Generate dish images in bulk.",               Visual: SlideReview },
  { id: "launch", eyebrow: "You're live", title: "Start orders in 10 seconds", sub: "Your menu, tables and kitchen — ready to bill in one tap.", Visual: SlideLaunch },
];

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export default function IntroScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  const last = idx === SLIDES.length - 1;

  useEffect(() => {
    if (paused || last) return;
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, SLIDES.length - 1)), SLIDE_MS);
    return () => clearTimeout(t);
  }, [idx, paused, last]);

  async function finish() {
    await markIntroSeen(user?.id);
    router.replace("/onboarding");
  }

  const slide = SLIDES[idx];
  const Visual = slide.Visual;

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFBEB" }}>
      <LinearGradient
        colors={["#FFF7ED", "#FFFBEB", "#FEF2F2"]}
        style={StyleSheet.absoluteFill}
      />
      {/* top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.brand}>
          <View style={styles.brandDot}>
            <Text style={{ fontSize: 14 }}>🍽️</Text>
          </View>
          <Text style={styles.brandName}>KhanaLagao</Text>
        </View>
        <Pressable onPress={finish} hitSlop={12} style={styles.skipBtn}>
          <Text style={styles.skipTxt}>Skip</Text>
          <Ionicons name="close" size={14} color="#737373" />
        </Pressable>
      </View>

      {/* slide */}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Animated.View
          key={slide.id}
          entering={FadeIn.duration(400)}
          exiting={FadeOut.duration(200)}
          style={{ alignItems: "center" }}
          onTouchStart={() => setPaused(true)}
          onTouchEnd={() => setPaused(false)}
        >
          <Visual name={user?.name} />
          <Animated.View
            key={`${slide.id}-copy`}
            entering={SlideInRight.duration(360)}
            exiting={SlideOutLeft.duration(220)}
            style={styles.copyBlock}
          >
            <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.sub}>{slide.sub}</Text>
          </Animated.View>
        </Animated.View>
      </View>

      {/* dots + CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => {
            const active = i === idx;
            return (
              <Pressable
                key={s.id}
                onPress={() => setIdx(i)}
                hitSlop={8}
                style={[styles.dot, active && styles.dotActive]}
              />
            );
          })}
        </View>
        {last ? (
          <Pressable onPress={finish} style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.9 : 1 }]}>
            <Text style={styles.ctaTxt}>Get Started</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setIdx((i) => Math.min(i + 1, SLIDES.length - 1))}
            style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.9 : 1 }]}
          >
            <Text style={styles.ctaTxt}>Next</Text>
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 10,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandDot: {
    width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: "#F97316",
    ...Platform.select({ ios: { shadowColor: "#F97316", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 4 } }),
  },
  brandName: { fontFamily: "Inter_700Bold", color: "#171717", fontSize: 15 },
  skipBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.7)" },
  skipTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: "#737373" },

  slideBody: { alignItems: "center", justifyContent: "center" },

  phoneOuter: {
    width: PHONE_W, height: PHONE_H, borderRadius: 36, padding: 8,
    ...Platform.select({ ios: { shadowColor: "#0f172a", shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 20 } }, android: { elevation: 12 } }),
  },
  phoneNotch: {
    position: "absolute", top: 4, left: PHONE_W / 2 - 36, width: 72, height: 18,
    backgroundColor: "#0f172a", borderBottomLeftRadius: 12, borderBottomRightRadius: 12, zIndex: 5,
  },
  phoneScreen: { flex: 1, borderRadius: 28, overflow: "hidden", backgroundColor: "#fff" },

  /* slide 1 */
  helloInner: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 14 },
  helloRing: { position: "absolute", width: 110, height: 110, borderRadius: 28, backgroundColor: "#F97316" },
  helloLogo: {
    width: 96, height: 96, borderRadius: 24, alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff", borderWidth: 2, borderColor: "#FED7AA",
  },
  helloHi: { fontFamily: "Inter_700Bold", fontSize: 22, color: "#0f172a" },
  helloSub: { fontFamily: "Inter_500Medium", fontSize: 13, color: "#78716C" },

  /* slide 2 */
  menuPaper: { flex: 1, padding: 14, gap: 8 },
  menuHead: { fontFamily: "Inter_700Bold", fontSize: 14, textAlign: "center", color: "#0f172a", letterSpacing: 1.2 },
  menuDiv: { height: 1, backgroundColor: "#E7E5E4", marginVertical: 4 },
  menuRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  menuName: { fontFamily: "Inter_500Medium", fontSize: 12, color: "#1c1917" },
  menuPrice: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#78716C" },
  vf: { ...StyleSheet.absoluteFillObject, margin: 18 },
  vfCorner: { position: "absolute", width: 26, height: 26, borderColor: "#F97316", borderRadius: 4 },
  shutter: {
    position: "absolute", bottom: 16, alignSelf: "center",
    width: 54, height: 54, borderRadius: 27, borderWidth: 3, borderColor: "#fff",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.35)",
  },
  shutterDot: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff" },

  /* slide 3 */
  aiHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  aiHeadTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#1e3a8a" },
  aiRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.85)", padding: 10, borderRadius: 10,
  },
  aiName: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 12, color: "#0f172a" },
  aiPrice: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#475569" },
  aiPill: {
    alignSelf: "flex-start", marginTop: 10, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, backgroundColor: "rgba(124,58,237,0.12)",
  },
  aiPillTxt: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#7C3AED" },

  /* slide 4 */
  reviewTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#065F46", marginBottom: 4 },
  reviewRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fff", padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: "#A7F3D0",
  },
  reviewCheck: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#10B981", alignItems: "center", justifyContent: "center" },
  reviewTxt: { fontFamily: "Inter_500Medium", fontSize: 12, color: "#064E3B" },

  /* slide 5 */
  launchHead: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#0f172a" },
  launchSub: { fontFamily: "Inter_500Medium", fontSize: 11, color: "#78716C", marginTop: 2, marginBottom: 10 },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  tile: { width: "31%", aspectRatio: 1, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", gap: 4 },
  tileIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tileLabel: { fontFamily: "Inter_500Medium", fontSize: 10, color: "#1c1917" },

  /* copy + footer */
  copyBlock: { alignItems: "center", paddingHorizontal: 28, marginTop: 22, gap: 6 },
  eyebrow: { fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 1.5, color: "#F97316" },
  title: { fontFamily: "Inter_700Bold", fontSize: 22, color: "#0f172a", textAlign: "center" },
  sub: { fontFamily: "Inter_400Regular", fontSize: 14, color: "#525252", textAlign: "center", lineHeight: 20, maxWidth: 320 },

  footer: { paddingHorizontal: 24, gap: 16 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#E7E5E4" },
  dotActive: { width: 22, backgroundColor: "#F97316" },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#F97316", paddingVertical: 14, borderRadius: 14,
    ...Platform.select({ ios: { shadowColor: "#F97316", shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 6 } }),
  },
  ctaTxt: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: "#fff" },
});

// Silence unused-import warning for Dimensions in case styles drift; keeps
// the import handy for future responsive tweaks without re-adding it.
void Dimensions;
