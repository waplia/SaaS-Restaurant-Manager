import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { RoleHomeCard, QuickActionButton, AppText, AppCard } from "@/components/ui";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/theme";

interface PaymentSummary {
  totalRevenue?: number;
  cash?: number;
  card?: number;
  upi?: number;
  online?: number;
  refunds?: number;
}
type ExpenseRow = { id: number; status?: string };
type RefundRow = { id: number; status?: string };
type VendorBill = { id: number; totalAmount: string; status: string };
type AggregatorDash = {
  totals?: { variancePaise?: number; disputedCount?: number; unmatchedCount?: number };
  perAggregator?: Array<{ aggregator: string; variancePaise: number }>;
};
type ARInvoice = { id: number; status: string };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function AccountantHome() {
  const t = useTheme();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const summaryQ = useQuery({
    queryKey: ["acct-pay-summary", restaurantId, today],
    queryFn: () => customFetch<PaymentSummary>(`/api/restaurants/${restaurantId}/payments/summary?date=${today}`).catch(() => ({} as PaymentSummary)),
    enabled: !!restaurantId,
  });
  const expensesQ = useQuery({
    queryKey: ["acct-pending-expenses", restaurantId],
    queryFn: () => customFetch<{ data?: ExpenseRow[] } | ExpenseRow[]>(`/api/restaurants/${restaurantId}/expenses?status=pending&limit=100`).catch(() => ({ data: [] })),
    enabled: !!restaurantId,
  });
  const refundsQ = useQuery({
    queryKey: ["acct-refunds", restaurantId],
    queryFn: () => customFetch<RefundRow[]>(`/api/restaurants/${restaurantId}/refunds`).catch(() => []),
    enabled: !!restaurantId,
  });
  const vendorBillsQ = useQuery({
    queryKey: ["acct-vendor-bills-due", restaurantId],
    queryFn: () => customFetch<VendorBill[]>(`/api/restaurants/${restaurantId}/accounting-books/vendor-bills`).catch(() => []),
    enabled: !!restaurantId,
  });
  const aggDashQ = useQuery({
    queryKey: ["acct-agg-dashboard", restaurantId],
    queryFn: () => customFetch<AggregatorDash>(`/api/restaurants/${restaurantId}/aggregator-payouts/dashboard`).catch(() => ({} as AggregatorDash)),
    enabled: !!restaurantId,
  });
  const invoicesQ = useQuery({
    queryKey: ["acct-ar-invoices", restaurantId],
    queryFn: () => customFetch<ARInvoice[]>(`/api/restaurants/${restaurantId}/accounting-books/ar-invoices`).catch(() => []),
    enabled: !!restaurantId,
  });

  const expensesPending = (Array.isArray(expensesQ.data) ? expensesQ.data : (expensesQ.data?.data ?? []))
    .filter(e => (e.status ?? "pending") === "pending");
  const refundsPending = (refundsQ.data ?? []).filter(r => r.status === "pending" || r.status === "processing");
  const vendorDue = (vendorBillsQ.data ?? []).filter(b => b.status === "approved" || b.status === "scheduled");
  const vendorDueAmount = vendorDue.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
  const openInvoices = (invoicesQ.data ?? []).filter(i => i.status === "open" || i.status === "partial");
  const variancePaise = aggDashQ.data?.totals?.variancePaise ?? 0;
  const unmatched = (aggDashQ.data?.totals?.unmatchedCount ?? 0) + (aggDashQ.data?.totals?.disputedCount ?? 0);

  const sum = summaryQ.data ?? {};

  const onRefresh = React.useCallback(async () => {
    await qc.invalidateQueries();
  }, [qc]);

  return (
    <RoleShellScreen
      title="Accounts"
      subtitle="Books & money flows"
      onRefresh={onRefresh}
      refreshing={summaryQ.isFetching || expensesQ.isFetching || vendorBillsQ.isFetching}
    >
      {/* Today's collections hero */}
      <AppCard style={{ backgroundColor: t.colors.primary }} bordered={false}>
        <AppText variant="micro" style={{ color: "rgba(255,255,255,0.85)", letterSpacing: 0.5 }}>
          TODAY'S COLLECTIONS
        </AppText>
        <AppText variant="hero" style={{ color: "#fff", marginTop: 4 }}>
          {inr(sum.totalRevenue ?? 0)}
        </AppText>
        <AppText variant="small" style={{ color: "rgba(255,255,255,0.85)", marginTop: 4 }}>
          Refunds {inr(sum.refunds ?? 0)} · Cash {inr(sum.cash ?? 0)} · UPI {inr(sum.upi ?? 0)} · Card {inr(sum.card ?? 0)}
        </AppText>
      </AppCard>

      <AppText variant="h3" style={{ marginTop: 8 }}>Action needed</AppText>

      <RoleHomeCard
        icon="receipt-outline"
        title="Expenses pending"
        subtitle={expensesPending.length === 0 ? "Nothing to approve right now." : `${expensesPending.length} awaiting approval`}
        badge={expensesPending.length > 0 ? { label: String(expensesPending.length), tone: "warning" } : undefined}
        onPress={() => router.push("/(accountant)/expenses" as never)}
      />
      <RoleHomeCard
        icon="return-down-back-outline"
        title="Refund requests"
        subtitle={refundsPending.length === 0 ? "No refunds to review." : `${refundsPending.length} pending or processing`}
        badge={refundsPending.length > 0 ? { label: String(refundsPending.length), tone: "warning" } : undefined}
        onPress={() => router.push("/(accountant)/refunds" as never)}
      />
      <RoleHomeCard
        icon="business-outline"
        title="Vendor dues"
        value={vendorDue.length === 0 ? undefined : inr(vendorDueAmount)}
        subtitle={vendorDue.length === 0 ? "No bills awaiting payment." : `${vendorDue.length} bills approved or scheduled`}
        onPress={() => router.push("/(accountant)/vendor-payments" as never)}
      />
      <RoleHomeCard
        icon="git-compare-outline"
        title="Settlement reconciliation"
        value={variancePaise === 0 ? undefined : inr(variancePaise / 100)}
        subtitle={
          variancePaise === 0 && unmatched === 0
            ? "All aggregator payouts reconciled."
            : `${unmatched} unresolved · variance ${inr(Math.abs(variancePaise) / 100)}`
        }
        badge={unmatched > 0 ? { label: String(unmatched), tone: "danger" } : undefined}
        onPress={() => router.push("/(accountant)/settlements" as never)}
      />
      <RoleHomeCard
        icon="document-text-outline"
        title="Open invoices"
        subtitle={openInvoices.length === 0 ? "No invoices awaiting payment." : `${openInvoices.length} unpaid`}
        onPress={() => router.push("/(accountant)/invoices" as never)}
      />

      <AppText variant="h3" style={{ marginTop: 8 }}>Quick reports</AppText>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <QuickActionButton icon="pie-chart-outline" label="P&L" onPress={() => router.push("/(accountant)/pnl" as never)} />
        <QuickActionButton icon="cash-outline" label="Payments" onPress={() => router.push("/(accountant)/payment-reports" as never)} />
        <QuickActionButton icon="bar-chart-outline" label="Reports" onPress={() => router.push("/(accountant)/reports" as never)} />
      </View>
    </RoleShellScreen>
  );
}
