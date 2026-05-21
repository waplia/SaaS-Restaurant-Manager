import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

type Step = {
  id: string;
  completed: boolean;
  skipped: boolean;
  skippable: boolean;
};

type OnboardingState = {
  isOnboarded: boolean;
  completedAt: string | null;
  skippedSteps: string[];
  steps: Step[];
};

const STEP_LABEL: Record<string, string> = {
  profile: "Restaurant profile",
  branch: "Add a branch",
  kitchen: "Set up your kitchen",
  menu_categories: "Add menu categories",
  menu_items: "Add menu items",
  tables: "Set up tables",
  staff: "Invite your team",
  payment: "Payment & tax settings",
  go_live: "Go live",
};

export function OnboardingChecklistCard() {
  const colors = useColors();
  const { restaurantId, user } = useAuth();
  const role = user?.role;
  const enabled = !!restaurantId && (role === "owner" || role === "manager" || role === "super_admin");

  const q = useQuery({
    queryKey: ["onboarding-state", restaurantId],
    enabled,
    queryFn: () => customFetch<OnboardingState>("/api/onboarding/state"),
    staleTime: 60_000,
  });

  if (!enabled || q.isLoading || q.isError || !q.data) return null;
  const state = q.data;
  if (state.isOnboarded) return null;

  const pending = state.steps.filter((s) => !s.completed);
  if (pending.length === 0) return null;

  const skippedPending = pending.filter((s) => s.skipped);
  const total = state.steps.length;
  const done = total - pending.length;

  return (
    <Pressable
      onPress={() => router.push("/onboarding" as never)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: "#fffbeb",
          borderColor: "#f59e0b",
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: "#fde68a" }]}>
          <Ionicons name="rocket-outline" size={20} color="#b45309" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Finish setting up your restaurant</Text>
          <Text style={styles.subtitle}>
            {done} of {total} steps done
            {skippedPending.length > 0 ? ` · ${skippedPending.length} skipped` : ""}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#92400e" />
      </View>

      <View style={[styles.progressTrack, { backgroundColor: "#fde68a" }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round((done / total) * 100)}%`, backgroundColor: "#d97706" },
          ]}
        />
      </View>

      <View style={styles.stepsList}>
        {pending.slice(0, 4).map((s) => (
          <View key={s.id} style={styles.stepRow}>
            <Ionicons
              name={s.skipped ? "arrow-undo-outline" : "ellipse-outline"}
              size={16}
              color={s.skipped ? "#d97706" : "#92400e"}
            />
            <Text style={styles.stepLabel}>{STEP_LABEL[s.id] ?? s.id}</Text>
            {s.skipped ? (
              <View style={styles.skippedBadge}>
                <Text style={styles.skippedBadgeText}>Skipped</Text>
              </View>
            ) : null}
          </View>
        ))}
        {pending.length > 4 ? (
          <Text style={styles.more}>+{pending.length - 4} more…</Text>
        ) : null}
      </View>

      <View style={[styles.cta, { backgroundColor: "#d97706" }]}>
        <Text style={styles.ctaText}>Resume onboarding</Text>
        <Ionicons name="arrow-forward" size={14} color="#fff" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#78350f" },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#92400e", marginTop: 2 },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%" },
  stepsList: { gap: 6 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#78350f" },
  skippedBadge: { backgroundColor: "#fef3c7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: "#fcd34d" },
  skippedBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#92400e", textTransform: "uppercase", letterSpacing: 0.5 },
  more: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#92400e", marginLeft: 24 },
  cta: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  ctaText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  loading: { borderRadius: 14, padding: 14, alignItems: "center" },
});

export default OnboardingChecklistCard;
