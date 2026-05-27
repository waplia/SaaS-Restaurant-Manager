import React from "react";
import { View, FlatList, RefreshControl } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import {
  AppText, AppCard, AppButton, AppEmptyState, AppModal, AppInput, AppDropdown, StatusChip,
} from "@/components/ui";
import type { StatusChipTone } from "@/components/ui/StatusChip";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/theme";

interface VendorBill {
  id: number;
  billNo: string;
  vendorName: string;
  billDate: string;
  dueDate: string;
  totalAmount: string;
  status: string;
  scheduledPayDate?: string | null;
}

const STATUS_TONE: Record<string, StatusChipTone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "info",
  scheduled: "info",
  paid: "success",
  void: "neutral",
};
const PAY_METHODS = [
  { label: "Bank transfer", value: "bank_transfer" },
  { label: "UPI", value: "upi" },
  { label: "Cash", value: "cash" },
  { label: "Cheque", value: "cheque" },
  { label: "Card", value: "card" },
];

export default function AccountantVendorPaymentsScreen() {
  const t = useTheme();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const [payFor, setPayFor] = React.useState<VendorBill | null>(null);
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState("bank_transfer");
  const [reference, setReference] = React.useState("");

  const billsQ = useQuery({
    queryKey: ["acct-vendor-bills", restaurantId],
    queryFn: () => customFetch<VendorBill[]>(`/api/restaurants/${restaurantId}/accounting-books/vendor-bills`).catch(() => []),
    enabled: !!restaurantId,
  });
  const dueBills = (billsQ.data ?? []).filter(b =>
    b.status === "approved" || b.status === "scheduled" || b.status === "pending_approval",
  );

  const pay = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      customFetch(`/api/restaurants/${restaurantId}/accounting-books/vendor-bills/${id}/pay`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setPayFor(null);
      setAmount("");
      setReference("");
      qc.invalidateQueries({ queryKey: ["acct-vendor-bills"] });
      qc.invalidateQueries({ queryKey: ["acct-vendor-bills-due"] });
    },
    onError: (e: unknown) => Alert.alert("Payment failed", e instanceof Error ? e.message : "Try again"),
  });

  function openPay(b: VendorBill) {
    setPayFor(b);
    setAmount(Number(b.totalAmount).toFixed(2));
    setMethod("bank_transfer");
    setReference("");
  }

  function submitPay() {
    if (!payFor) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert("Invalid amount", "Enter a positive payment amount.");
      return;
    }
    pay.mutate({
      id: payFor.id,
      body: {
        paymentDate: new Date().toISOString().slice(0, 10),
        amount: amt,
        paymentMethod: method,
        reference: reference.trim() || undefined,
      },
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="Vendor payments" subtitle={`${dueBills.length} bills due`} />
      <FlatList
        data={dueBills}
        keyExtractor={(b) => String(b.id)}
        refreshControl={<RefreshControl refreshing={billsQ.isFetching} onRefresh={() => billsQ.refetch()} tintColor={t.colors.primary} />}
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md, paddingBottom: 40 }}
        ListEmptyComponent={
          !billsQ.isLoading ? (
            <AppEmptyState
              icon="business-outline"
              title="No vendor dues"
              description="Approved or scheduled vendor bills awaiting payment will show up here."
            />
          ) : null
        }
        renderItem={({ item }) => (
          <AppCard>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="h3" numberOfLines={1}>{item.vendorName}</AppText>
                <AppText variant="small" color="mutedForeground" numberOfLines={1} style={{ marginTop: 2 }}>
                  Bill {item.billNo} · due {new Date(item.dueDate).toLocaleDateString()}
                </AppText>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <StatusChip label={item.status.replace("_", " ")} tone={STATUS_TONE[item.status] ?? "neutral"} size="xs" />
                  {item.scheduledPayDate ? (
                    <StatusChip label={`Pay ${new Date(item.scheduledPayDate).toLocaleDateString()}`} tone="info" size="xs" />
                  ) : null}
                </View>
              </View>
              <AppText variant="h3">₹{Number(item.totalAmount).toFixed(0)}</AppText>
            </View>
            <AppButton
              label="Record payment"
              leftIcon="cash-outline"
              size="sm"
              style={{ marginTop: 12 }}
              onPress={() => openPay(item)}
              disabled={item.status === "pending_approval"}
            />
          </AppCard>
        )}
      />

      <AppModal
        visible={!!payFor}
        onClose={() => setPayFor(null)}
        title={payFor ? `Pay ${payFor.vendorName}` : "Record payment"}
      >
        <View style={{ gap: 12 }}>
          <AppInput
            label="Amount (₹)"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <AppDropdown
            label="Method"
            value={method}
            options={PAY_METHODS}
            onChange={setMethod}
          />
          <AppInput
            label="Reference / UTR (optional)"
            placeholder="UTR, cheque no., etc."
            value={reference}
            onChangeText={setReference}
            autoCapitalize="characters"
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <AppButton label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setPayFor(null)} />
            <AppButton
              label="Record payment"
              style={{ flex: 1 }}
              loading={pay.isPending}
              onPress={submitPay}
            />
          </View>
        </View>
      </AppModal>
    </View>
  );
}
