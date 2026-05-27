import React from "react";
import { View, FlatList, RefreshControl, Share } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  AppText, AppCard, AppButton, AppEmptyState, StatusChip,
} from "@/components/ui";
import type { StatusChipTone } from "@/components/ui/StatusChip";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/theme";

interface ARInvoice {
  id: number;
  invoiceNo: string;
  customerName: string;
  customerEmail?: string | null;
  customerGstin?: string | null;
  invoiceDate: string;
  dueDate: string;
  totalAmount: string;
  status: string;
  notes?: string | null;
}

const STATUS_TONE: Record<string, StatusChipTone> = {
  open: "warning",
  partial: "info",
  paid: "success",
  void: "neutral",
  overdue: "danger",
};

export default function AccountantInvoicesScreen() {
  const t = useTheme();
  const { restaurantId } = useAuth();

  const invoicesQ = useQuery({
    queryKey: ["acct-ar-invoices", restaurantId],
    queryFn: () => customFetch<ARInvoice[]>(`/api/restaurants/${restaurantId}/accounting-books/ar-invoices`).catch(() => []),
    enabled: !!restaurantId,
  });
  const rows = invoicesQ.data ?? [];

  async function shareInvoice(inv: ARInvoice) {
    const lines = [
      `Invoice ${inv.invoiceNo}`,
      `For: ${inv.customerName}`,
      inv.customerGstin ? `GSTIN: ${inv.customerGstin}` : null,
      `Date: ${new Date(inv.invoiceDate).toLocaleDateString()}`,
      `Due: ${new Date(inv.dueDate).toLocaleDateString()}`,
      `Total: ₹${Number(inv.totalAmount).toFixed(2)}`,
      `Status: ${inv.status}`,
      inv.notes ? `Notes: ${inv.notes}` : null,
    ].filter(Boolean).join("\n");
    try {
      await Share.share({ message: lines, title: `Invoice ${inv.invoiceNo}` });
    } catch { /* user cancelled */ }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="Invoices" subtitle={`${rows.length} issued`} />
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        refreshControl={<RefreshControl refreshing={invoicesQ.isFetching} onRefresh={() => invoicesQ.refetch()} tintColor={t.colors.primary} />}
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md, paddingBottom: 40 }}
        ListEmptyComponent={
          !invoicesQ.isLoading ? (
            <AppEmptyState
              icon="document-text-outline"
              title="No invoices yet"
              description="Customer invoices issued from the accounting back-office will appear here."
            />
          ) : null
        }
        renderItem={({ item }) => {
          const tone = STATUS_TONE[item.status] ?? "neutral";
          return (
            <AppCard>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="h3" numberOfLines={1}>{item.invoiceNo}</AppText>
                  <AppText variant="small" color="mutedForeground" numberOfLines={1} style={{ marginTop: 2 }}>
                    {item.customerName}
                  </AppText>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <StatusChip label={item.status} tone={tone} size="xs" />
                    <StatusChip label={`Due ${new Date(item.dueDate).toLocaleDateString()}`} tone="neutral" size="xs" />
                  </View>
                </View>
                <AppText variant="h3">₹{Number(item.totalAmount).toFixed(0)}</AppText>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <AppButton
                  label="Share"
                  leftIcon="share-outline"
                  variant="outline"
                  size="sm"
                  style={{ flex: 1 }}
                  onPress={() => shareInvoice(item)}
                />
              </View>
            </AppCard>
          );
        }}
      />
    </View>
  );
}
