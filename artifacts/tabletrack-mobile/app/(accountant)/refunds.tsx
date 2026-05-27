import React from "react";
import { View, FlatList, RefreshControl } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import {
  AppText, AppCard, AppButton, AppEmptyState, StatusChip,
} from "@/components/ui";
import type { StatusChipTone } from "@/components/ui/StatusChip";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/theme";

interface RefundRow {
  id: number;
  amount: number;
  refundType: string;
  destination: string;
  reason: string;
  status: string;
  createdAt: string;
  externalRefundId?: string | null;
}

const STATUS_TONE: Record<string, StatusChipTone> = {
  pending: "warning",
  processing: "info",
  succeeded: "success",
  failed: "danger",
};

export default function AccountantRefundsScreen() {
  const t = useTheme();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();

  const refundsQ = useQuery({
    queryKey: ["acct-refunds", restaurantId],
    queryFn: () => customFetch<RefundRow[]>(`/api/restaurants/${restaurantId}/refunds`).catch(() => []),
    enabled: !!restaurantId,
  });

  const approve = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/refunds/${id}/approve`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acct-refunds"] }),
    onError: (e: unknown) => Alert.alert("Approve failed", e instanceof Error ? e.message : "Try again"),
  });
  const markDone = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/refunds/${id}/mark-succeeded`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acct-refunds"] }),
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Try again"),
  });

  const rows = refundsQ.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="Refunds" subtitle={`${rows.filter(r => r.status !== "succeeded" && r.status !== "failed").length} active`} />
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        refreshControl={<RefreshControl refreshing={refundsQ.isFetching} onRefresh={() => refundsQ.refetch()} tintColor={t.colors.primary} />}
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md, paddingBottom: 40 }}
        ListEmptyComponent={
          !refundsQ.isLoading ? (
            <AppEmptyState
              icon="return-down-back-outline"
              title="No refunds"
              description="Refund requests submitted from the platform will appear here for review."
            />
          ) : null
        }
        renderItem={({ item }) => {
          const isPending = item.status === "pending";
          const isProcessing = item.status === "processing";
          return (
            <AppCard>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="h3">Refund #{item.id}</AppText>
                  <AppText variant="small" color="mutedForeground" numberOfLines={2} style={{ marginTop: 2 }}>
                    {item.reason}
                  </AppText>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <StatusChip label={item.status} tone={STATUS_TONE[item.status] ?? "neutral"} size="xs" />
                    <StatusChip label={item.refundType} tone="neutral" size="xs" />
                    <StatusChip label={`To ${item.destination}`} tone="info" size="xs" />
                  </View>
                </View>
                <AppText variant="h3">₹{(Number(item.amount) / 100).toFixed(0)}</AppText>
              </View>
              {(isPending || isProcessing) ? (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  {isPending ? (
                    <AppButton
                      label="Approve"
                      size="sm"
                      style={{ flex: 1 }}
                      loading={approve.isPending && approve.variables === item.id}
                      onPress={() => approve.mutate(item.id)}
                    />
                  ) : null}
                  {isProcessing ? (
                    <AppButton
                      label="Mark succeeded"
                      size="sm"
                      variant="outline"
                      style={{ flex: 1 }}
                      loading={markDone.isPending && markDone.variables === item.id}
                      onPress={() => markDone.mutate(item.id)}
                    />
                  ) : null}
                </View>
              ) : null}
            </AppCard>
          );
        }}
      />
    </View>
  );
}
