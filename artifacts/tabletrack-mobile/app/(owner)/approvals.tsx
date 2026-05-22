import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Alert, Platform } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { ListSkeleton } from "@/components/ListSkeleton";

type ApprovalKind = "expense" | "leave" | "purchase_order" | "stock_adjustment" | "campaign";

interface ApprovalItem {
  kind: ApprovalKind;
  id: number;
  title: string;
  subtitle: string;
  amount?: string;
}

const KIND_META: Record<ApprovalKind, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  expense: { label: "Expense", icon: "wallet-outline", color: "#dc2626" },
  leave: { label: "Leave", icon: "airplane-outline", color: "#2563eb" },
  purchase_order: { label: "PO", icon: "cube-outline", color: "#7c3aed" },
  stock_adjustment: { label: "Stock Adj.", icon: "swap-horizontal-outline", color: "#ea580c" },
  campaign: { label: "Campaign", icon: "rocket-outline", color: "#16a34a" },
};

export default function ApprovalsScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const [activeKind, setActiveKind] = useState<ApprovalKind | "all">("all");
  const isWeb = Platform.OS === "web";

  type ExpensesResp = { data?: Array<{ id: number; amount: string; payee?: string | null; expenseDate: string; status?: string }> };
  const expensesQ = useQuery({
    queryKey: ["pending-expenses", restaurantId],
    queryFn: () => customFetch<ExpensesResp>(`/api/restaurants/${restaurantId}/expenses?status=pending&limit=50`).catch(() => ({} as ExpensesResp)),
  });
  const leavesQ = useQuery({
    queryKey: ["pending-leaves", restaurantId],
    queryFn: () => customFetch<Array<{ id: number; userName?: string; startDate: string; endDate: string; reason?: string; status?: string }>>(`/api/restaurants/${restaurantId}/leave-requests?status=pending`).catch(() => []),
  });
  const posQ = useQuery({
    queryKey: ["pending-pos", restaurantId],
    queryFn: () => customFetch<Array<{ id: number; supplierName?: string; total?: string; status?: string; createdAt: string }>>(`/api/restaurants/${restaurantId}/purchase-orders?status=pending_approval`).catch(() => []),
  });

  const items: ApprovalItem[] = useMemo(() => {
    const out: ApprovalItem[] = [];
    for (const e of (Array.isArray(expensesQ.data?.data) ? expensesQ.data!.data : [])) {
      out.push({
        kind: "expense", id: e.id,
        title: e.payee ?? "Expense",
        subtitle: new Date(e.expenseDate).toLocaleDateString(),
        amount: `₹${e.amount}`,
      });
    }
    for (const l of (Array.isArray(leavesQ.data) ? leavesQ.data : [])) {
      out.push({
        kind: "leave", id: l.id,
        title: l.userName ?? `Leave #${l.id}`,
        subtitle: `${new Date(l.startDate).toLocaleDateString()} – ${new Date(l.endDate).toLocaleDateString()}`,
      });
    }
    for (const p of (Array.isArray(posQ.data) ? posQ.data : [])) {
      out.push({
        kind: "purchase_order", id: p.id,
        title: p.supplierName ?? `PO #${p.id}`,
        subtitle: new Date(p.createdAt).toLocaleDateString(),
        amount: p.total ? `₹${p.total}` : undefined,
      });
    }
    return activeKind === "all" ? out : out.filter(i => i.kind === activeKind);
  }, [expensesQ.data, leavesQ.data, posQ.data, activeKind]);

  const approve = useMutation({
    mutationFn: async ({ kind, id }: { kind: ApprovalKind; id: number }) => {
      const map: Record<string, string> = {
        expense: `/api/restaurants/${restaurantId}/expenses/${id}/approve`,
        leave: `/api/restaurants/${restaurantId}/leave-requests/${id}/approve`,
        purchase_order: `/api/restaurants/${restaurantId}/purchase-orders/${id}/approve`,
      };
      const url = map[kind];
      if (!url) throw new Error("Unsupported");
      return customFetch(url, { method: "POST", body: JSON.stringify({}) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-expenses"] });
      qc.invalidateQueries({ queryKey: ["pending-leaves"] });
      qc.invalidateQueries({ queryKey: ["pending-pos"] });
    },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not approve"),
  });

  const reject = useMutation({
    mutationFn: async ({ kind, id }: { kind: ApprovalKind; id: number }) => {
      const map: Record<string, string> = {
        expense: `/api/restaurants/${restaurantId}/expenses/${id}/reject`,
        leave: `/api/restaurants/${restaurantId}/leave-requests/${id}/reject`,
        purchase_order: `/api/restaurants/${restaurantId}/purchase-orders/${id}/reject`,
      };
      const url = map[kind];
      if (!url) throw new Error("Unsupported");
      const reason = kind === "expense" ? "Rejected from mobile" : undefined;
      return customFetch(url, { method: "POST", body: JSON.stringify(reason ? { reason } : {}) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-expenses"] });
      qc.invalidateQueries({ queryKey: ["pending-leaves"] });
      qc.invalidateQueries({ queryKey: ["pending-pos"] });
    },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not reject"),
  });

  const isLoading = expensesQ.isLoading || leavesQ.isLoading || posQ.isLoading;
  const refetch = () => { expensesQ.refetch(); leavesQ.refetch(); posQ.refetch(); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Approvals" subtitle={`${items.length} pending`} showBack />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 48, flexGrow: 0 }} contentContainerStyle={styles.pills}>
        {(["all", "expense", "leave", "purchase_order"] as const).map(k => (
          <Pressable
            key={k}
            onPress={() => setActiveKind(k as ApprovalKind | "all")}
            style={[styles.pill, { borderColor: colors.border, backgroundColor: activeKind === k ? colors.primary : colors.card }]}
          >
            <Text style={[styles.pillText, { color: activeKind === k ? "#fff" : colors.mutedForeground }]}>
              {k === "all" ? "All" : KIND_META[k as ApprovalKind].label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState icon="checkmark-done-outline" title="Nothing to approve" message="You're all caught up." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: isWeb ? 100 : 100 }}
        >
          {items.map(item => {
            const meta = KIND_META[item.kind];
            return (
              <View
                key={`${item.kind}-${item.id}`}
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={styles.headerRow}>
                  <View style={[styles.iconWrap, { backgroundColor: meta.color + "20" }]}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{item.title}</Text>
                    <Text style={[styles.sub, { color: colors.mutedForeground }]}>{meta.label} · {item.subtitle}</Text>
                  </View>
                  {item.amount ? (
                    <Text style={[styles.amount, { color: colors.foreground }]}>{item.amount}</Text>
                  ) : null}
                </View>
                <View style={styles.btnRow}>
                  <Pressable
                    onPress={() => reject.mutate({ kind: item.kind, id: item.id })}
                    style={({ pressed }) => [styles.btn, { borderColor: colors.destructive, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.btnText, { color: colors.destructive }]}>Reject</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => approve.mutate({ kind: item.kind, id: item.id })}
                    style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.btnText, { color: "#fff" }]}>Approve</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pills: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  card: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  amount: { fontSize: 15, fontFamily: "Inter_700Bold" },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
