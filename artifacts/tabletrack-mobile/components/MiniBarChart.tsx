import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

export interface BarPoint { label: string; value: number }

export function MiniBarChart({ data, height = 110 }: { data: BarPoint[]; height?: number }) {
  const colors = useColors();
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <View style={[styles.wrap, { height }]}>
      <View style={styles.barsRow}>
        {data.map((d, i) => {
          const h = Math.max(2, (d.value / max) * (height - 22));
          const isLast = i === data.length - 1;
          return (
            <View key={`${d.label}-${i}`} style={styles.barCol}>
              <View
                style={[
                  styles.bar,
                  {
                    height: h,
                    backgroundColor: isLast ? colors.primary : colors.primary + "55",
                  },
                ]}
              />
              <Text style={[styles.label, { color: colors.mutedForeground }]} numberOfLines={1}>
                {d.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  barsRow: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 6 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  bar: { width: "85%", borderRadius: 4 },
  label: { fontSize: 10, fontFamily: "Inter_500Medium" },
});
