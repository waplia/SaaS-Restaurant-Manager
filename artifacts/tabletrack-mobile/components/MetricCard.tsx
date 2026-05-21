import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export interface MetricCardProps {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  value?: string | null;
  sub?: string | null;
  list?: Array<{ key: string; label: string; value?: string }>;
  emptyText?: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onPress?: () => void;
  actionLabel?: string;
  badge?: { text: string; tone?: "warn" | "danger" | "ok" | "info" };
}

const TONES: Record<string, { bg: string; text: string }> = {
  warn: { bg: "#fff7ed", text: "#c2410c" },
  danger: { bg: "#fef2f2", text: "#b91c1c" },
  ok: { bg: "#f0fdf4", text: "#15803d" },
  info: { bg: "#eff6ff", text: "#1d4ed8" },
};

export function MetricCard(props: MetricCardProps) {
  const colors = useColors();
  const {
    title, icon, value, sub, list, emptyText, isLoading, isError,
    onRetry, onPress, actionLabel, badge,
  } = props;

  const isEmpty = !isLoading && !isError && (value == null || value === "") && (!list || list.length === 0);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || isLoading || isError}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {icon ? <Ionicons name={icon} size={16} color={colors.mutedForeground} /> : null}
          <Text style={[styles.title, { color: colors.mutedForeground }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: TONES[badge.tone ?? "info"].bg }]}>
            <Text style={[styles.badgeText, { color: TONES[badge.tone ?? "info"].text }]}>{badge.text}</Text>
          </View>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.skeletonWrap}>
          <View style={[styles.skelBar, { backgroundColor: colors.muted, width: "55%", height: 22 }]} />
          <View style={[styles.skelBar, { backgroundColor: colors.muted, width: "75%" }]} />
          <View style={[styles.skelBar, { backgroundColor: colors.muted, width: "40%" }]} />
        </View>
      ) : isError ? (
        <View style={styles.errorWrap}>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>Couldn't load</Text>
          {onRetry ? (
            <Pressable
              onPress={onRetry}
              hitSlop={10}
              style={[styles.retryBtn, { borderColor: colors.border }]}
            >
              <Ionicons name="refresh" size={12} color={colors.foreground} />
              <Text style={[styles.retryText, { color: colors.foreground }]}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : isEmpty ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          {emptyText ?? "Nothing to show"}
        </Text>
      ) : (
        <>
          {value != null ? (
            <Text style={[styles.value, { color: colors.foreground }]}>{value}</Text>
          ) : null}
          {sub ? (
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>{sub}</Text>
          ) : null}
          {list && list.length > 0 ? (
            <View style={[styles.list, { borderTopColor: colors.border }]}>
              {list.map((it) => (
                <View key={it.key} style={styles.listRow}>
                  <Text style={[styles.listLabel, { color: colors.foreground }]} numberOfLines={1}>
                    {it.label}
                  </Text>
                  {it.value ? (
                    <Text style={[styles.listValue, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {it.value}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}

      {onPress && !isLoading && !isError ? (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Text style={[styles.footerText, { color: colors.primary }]}>
            {actionLabel ?? "View all"}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function PlaceholderCard({ title, icon, message }: { title: string; icon?: keyof typeof Ionicons.glyphMap; message?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {icon ? <Ionicons name={icon} size={16} color={colors.mutedForeground} /> : null}
          <Text style={[styles.title, { color: colors.mutedForeground }]}>{title}</Text>
        </View>
      </View>
      <Text style={[styles.empty, { color: colors.mutedForeground }]}>
        {message ?? "Not available yet"}
      </Text>
    </View>
  );
}

export function CardSpinner() {
  const colors = useColors();
  return <ActivityIndicator color={colors.primary} size="small" />;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
    minHeight: 110,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  title: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
  value: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 2 },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 6 },
  list: { borderTopWidth: 1, marginTop: 8, paddingTop: 8, gap: 6 },
  listRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  listLabel: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  listValue: { fontSize: 12, fontFamily: "Inter_500Medium" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  skeletonWrap: { gap: 8, paddingVertical: 4 },
  skelBar: { height: 12, borderRadius: 6 },
  errorWrap: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  retryText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  footer: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, paddingTop: 8, borderTopWidth: 1 },
  footerText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
