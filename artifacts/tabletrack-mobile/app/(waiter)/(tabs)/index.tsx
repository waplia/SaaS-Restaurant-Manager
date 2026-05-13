import React from "react";
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { listFloorTables, getListFloorTablesQueryKey } from "@workspace/api-client-react";
import type { FloorTable } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { TableCard } from "@/components/TableCard";
import { EmptyState } from "@/components/EmptyState";

const RESTAURANT_ID = 1;

export default function TablesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: getListFloorTablesQueryKey(RESTAURANT_ID),
    queryFn: () => listFloorTables(RESTAURANT_ID),
    refetchInterval: 20_000,
  });

  const tableList = (Array.isArray(data) ? data : []) as FloorTable[];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 67 : insets.top, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Tables</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {tableList.filter((t) => t.status === "occupied").length} occupied ·{" "}
          {tableList.filter((t) => t.status === "available").length} available
        </Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : tableList.length === 0 ? (
        <EmptyState icon="grid-outline" title="No tables" message="Tables will appear here once configured." />
      ) : (
        <FlatList
          data={tableList}
          keyExtractor={(t) => String(t.id)}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item: t }) => (
            <TableCard
              label={t.label ?? `T${t.id}`}
              capacity={t.capacity ?? 4}
              status={t.status ?? "available"}
              onPress={() => router.push(`/(waiter)/order/${t.id}` as `/${string}`)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 16 },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  list: { padding: 16, gap: 12 },
  row: { justifyContent: "space-between", gap: 12, marginBottom: 12 },
});
