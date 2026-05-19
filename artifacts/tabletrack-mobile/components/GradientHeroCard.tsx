import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

interface MetricSlot {
  label: string;
  value: string;
  sub?: string;
}

interface Props {
  title: string;
  metrics: MetricSlot[];
  onPress?: () => void;
}

export function GradientHeroCard({ title, metrics, onPress }: Props) {
  const inner = (
    <LinearGradient
      colors={["#fb923c", "#f97316", "#c2410c"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        {onPress ? <Ionicons name="chevron-forward" size={18} color="#fff" /> : null}
      </View>
      <View style={styles.metricsRow}>
        {metrics.map((m, i) => (
          <View key={m.label} style={[styles.metric, i < metrics.length - 1 && styles.metricSep]}>
            <Text style={styles.metricLabel} numberOfLines={1}>{m.label}</Text>
            <Text style={styles.metricValue} numberOfLines={1}>{m.value}</Text>
            {m.sub ? <Text style={styles.metricSub} numberOfLines={1}>{m.sub}</Text> : null}
          </View>
        ))}
      </View>
    </LinearGradient>
  );
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>{inner}</Pressable>;
  }
  return inner;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: 18,
    gap: 14,
    shadowColor: "#f97316",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold", opacity: 0.9, letterSpacing: 0.3 },
  metricsRow: { flexDirection: "row" },
  metric: { flex: 1, paddingHorizontal: 4 },
  metricSep: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "rgba(255,255,255,0.3)" },
  metricLabel: { color: "#fff", opacity: 0.85, fontSize: 11, fontFamily: "Inter_500Medium" },
  metricValue: { color: "#fff", fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 2 },
  metricSub: { color: "#fff", opacity: 0.85, fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 2 },
});
