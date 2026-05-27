import React from "react";
import { View, FlatList, RefreshControl } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import {
  AppText, AppCard, AppButton, AppEmptyState, AppModal, AppInput, StatusChip,
} from "@/components/ui";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/theme";

interface ExpenseRow {
  id: number;
  amount: string;
  payee?: string | null;
  description?: string | null;
  expenseDate: string;
  status?: string;
  categoryId?: number | null;
  paymentMethod?: string | null;
}
type ExpensesResp = { data?: ExpenseRow[] } | ExpenseRow[];

export default function AccountantExpensesScreen() {
  const t = useTheme();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const [rejectFor, setRejectFor] = React.useState<ExpenseRow | null>(null);
  const [reason, setReason] = React.useState("");

  const expensesQ = useQuery({
    queryKey: ["acct-pending-expenses", restaurantId],
    queryFn: () => customFetch<ExpensesResp>(`/api/restaurants/${restaurantId}/expenses?status=pending&limit=100`).catch(() => ({ data: [] })),
    enabled: !!restaurantId,
  });
  const rows = Array.isArray(expensesQ.data) ? expensesQ.data : (expensesQ.data?.data ?? []);

  const approve = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/expenses/${id}/approve`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acct-pending-expenses"] }),
    onError: (e: unknown) => Alert.alert("Approve failed", e instanceof Error ? e.message : "Try again"),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      customFetch(`/api/restaurants/${restaurantId}/expenses/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      setRejectFor(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["acct-pending-expenses"] });
    },
    onError: (e: unknown) => Alert.alert("Reject failed", e instanceof Error ? e.message : "Try again"),
  });

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="Expenses" subtitle="Pending approvals" />
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        refreshControl={<RefreshControl refreshing={expensesQ.isFetching} onRefresh={() => expensesQ.refetch()} tintColor={t.colors.primary} />}
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md, paddingBottom: 40 }}
        ListEmptyComponent={
          !expensesQ.isLoading ? (
            <AppEmptyState
              icon="checkmark-done-outline"
              title="All caught up"
              description="No expense submissions are awaiting your approval."
            />
          ) : null
        }
        renderItem={({ item }) => (
          <AppCard>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="h3" numberOfLines={1}>{item.payee ?? "Expense"}</AppText>
                {item.description ? (
                  <AppText variant="small" color="mutedForeground" numberOfLines={2} style={{ marginTop: 2 }}>
                    {item.description}
                  </AppText>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <StatusChip label={new Date(item.expenseDate).toLocaleDateString()} tone="neutral" size="xs" />
                  {item.paymentMethod ? <StatusChip label={item.paymentMethod} tone="info" size="xs" /> : null}
                </View>
              </View>
              <AppText variant="h3">₹{Number(item.amount).toFixed(0)}</AppText>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <AppButton
                label="Reject"
                variant="outline"
                size="sm"
                style={{ flex: 1 }}
                onPress={() => { setReason(""); setRejectFor(item); }}
              />
              <AppButton
                label="Approve"
                size="sm"
                style={{ flex: 1 }}
                loading={approve.isPending && approve.variables === item.id}
                onPress={() => approve.mutate(item.id)}
              />
            </View>
          </AppCard>
        )}
      />

      <AppModal
        visible={!!rejectFor}
        onClose={() => setRejectFor(null)}
        title={rejectFor ? `Reject expense — ₹${Number(rejectFor.amount).toFixed(0)}` : "Reject expense"}
      >
        <View style={{ gap: 12 }}>
          <AppInput
            label="Reason"
            placeholder="Why is this being rejected?"
            multiline
            numberOfLines={3}
            value={reason}
            onChangeText={setReason}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <AppButton label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setRejectFor(null)} />
            <AppButton
              label="Reject"
              variant="destructive"
              style={{ flex: 1 }}
              disabled={reason.trim().length < 3}
              loading={reject.isPending}
              onPress={() => rejectFor && reject.mutate({ id: rejectFor.id, reason: reason.trim() })}
            />
          </View>
        </View>
      </AppModal>
    </View>
  );
}
