import React from "react";
import { View, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      {Array.from({ length: rows }).map((_, i) => (
        <View
          key={i}
          style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.circle, { backgroundColor: colors.muted }]} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={[styles.line, { backgroundColor: colors.muted, width: "60%" }]} />
            <View style={[styles.line, { backgroundColor: colors.muted, width: "40%", height: 8 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 10 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
  },
  circle: { width: 36, height: 36, borderRadius: 18 },
  line: { height: 10, borderRadius: 4 },
});
