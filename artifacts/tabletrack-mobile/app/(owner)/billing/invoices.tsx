import React from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import { RoleGate } from "@/components/RoleGate";

type Invoices = {
  payments: Array<{
    id: number; kind: string; planName: string | null;
    amount: string; currency: string; externalRef: string | null;
    periodStart: string | null; periodEnd: string | null;
    status: string; createdAt: string;
  }>;
  manualRequests: Array<{
    id: number; planName: string | null; amount: string; currency: string;
    method: string; reference: string | null; status: string;
    reviewerNote: string | null; reviewedAt: string | null; createdAt: string;
  }>;
};

function tone(s: string): StatusTone {
  switch (s) {
    case "succeeded":
    case "approved":
    case "paid": return "success";
    case "pending": return "warning";
    case "rejected":
    case "failed": return "danger";
    default: return "neutral";
  }
}

function fmtMoney(amount: string | number, currency: string) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${currency} ${amount}`;
  return `${currency === "USD" ? "$" : currency === "INR" ? "₹" : currency + " "}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
}

function InvoicesScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["billing-invoices", restaurantId],
    queryFn: () => customFetch<Invoices>(`/api/restaurants/${restaurantId}/billing/invoices?limit=50`),
    staleTime: 30_000,
  });

  const payments = data?.payments ?? [];
  const manualRequests = data?.manualRequests ?? [];
  const empty = !isLoading && payments.length === 0 && manualRequests.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Invoices & payments" showBack />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: Platform.OS === "web" ? 120 : 100 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        {isLoading ? (
          <View style={{ paddingTop: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : empty ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 24, alignItems: "center", gap: 6 }]}>
            <Ionicons name="receipt-outline" size={32} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>No invoices yet</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center" }}>
              Payments and manual submissions will appear here.
            </Text>
          </View>
        ) : (
          <>
            {payments.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text style={[styles.h2, { color: colors.foreground }]}>Payments</Text>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {payments.map((p, i) => (
                    <View
                      key={p.id}
                      style={[styles.row, {
                        borderBottomColor: colors.border,
                        borderBottomWidth: i === payments.length - 1 ? 0 : StyleSheet.hairlineWidth,
                      }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                          {p.planName ?? "Subscription"}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                          {p.kind.toUpperCase()} · {fmtDate(p.createdAt)}
                          {p.externalRef ? ` · ${p.externalRef}` : ""}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
                          {fmtMoney(p.amount, p.currency)}
                        </Text>
                        <StatusBadge label={p.status} tone={tone(p.status)} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {manualRequests.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text style={[styles.h2, { color: colors.foreground }]}>Manual payments</Text>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {manualRequests.map((m, i) => (
                    <View
                      key={m.id}
                      style={[styles.row, {
                        borderBottomColor: colors.border,
                        borderBottomWidth: i === manualRequests.length - 1 ? 0 : StyleSheet.hairlineWidth,
                      }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                          {m.planName ?? "Subscription"} · {m.method.toUpperCase()}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                          {fmtDate(m.createdAt)}
                          {m.reference ? ` · ref ${m.reference}` : ""}
                        </Text>
                        {m.reviewerNote ? (
                          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4, fontStyle: "italic" }} numberOfLines={2}>
                            Note: {m.reviewerNote}
                          </Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
                          {fmtMoney(m.amount, m.currency)}
                        </Text>
                        <StatusBadge label={m.status} tone={tone(m.status)} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default function Invoices() {
  return (
    <RoleGate module="billing">
      <InvoicesScreen />
    </RoleGate>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  h2: { fontSize: 14, fontFamily: "Inter_700Bold", marginLeft: 4 },
});
