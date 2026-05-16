import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

type Subscription = {
  id: number; templateId: number; status: string;
  currentCycleStart: string | null; currentCycleEnd: string | null; nextBillingDate: string | null;
  mealsRemaining: number; mealsUsed: number; creditsRemaining: number; creditsUsed: number;
  paymentMethod: string | null; failedAttempts: number;
  template: { id: number; name: string; type: string; billingCycle: string; price: string } | null;
};

function apiUrl(p: string) { return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api${p}`; }
async function fetchJson<T>(url: string, init?: RequestInit, token?: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

const COLOR_STATUS: Record<string, string> = {
  active: "#16a34a", paused: "#eab308", pending: "#3b82f6",
  expired: "#6b7280", cancelled: "#dc2626",
};

export default function MySubscriptionsScreen() {
  const colors = useColors();
  const { accessToken, restaurantId: ctxRestaurantId } = useAuth();
  const params = useLocalSearchParams<{ restaurantId?: string; customerId?: string }>();
  const restaurantId = Number(params.restaurantId ?? ctxRestaurantId ?? 1);
  const customerId = params.customerId ? Number(params.customerId) : null;
  const qc = useQueryClient();

  const { data: subs = [], isLoading } = useQuery({
    queryKey: ["my-subscriptions", restaurantId, customerId],
    queryFn: () => customerId
      ? fetchJson<Subscription[]>(apiUrl(`/restaurants/${restaurantId}/customers/${customerId}/subscriptions`), undefined, accessToken)
      : Promise.resolve([]),
    enabled: !!customerId,
  });

  const action = useMutation({
    mutationFn: ({ id, path, body }: { id: number; path: string; body?: unknown }) =>
      fetchJson(apiUrl(`/restaurants/${restaurantId}/customer-subscriptions/${id}/${path}`), {
        method: "POST", body: body ? JSON.stringify(body) : undefined,
      }, accessToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-subscriptions"] }),
    onError: (e: Error) => Alert.alert("Action failed", e.message),
  });

  if (!customerId) {
    return <View style={styles.center}>
      <Text style={{ color: colors.mutedForeground, padding: 24, textAlign: "center" }}>
        Sign in or enter a customer profile to view your subscriptions.
      </Text>
    </View>;
  }
  if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[styles.title, { color: colors.foreground }]}>My Subscriptions</Text>
      {subs.length === 0 && (
        <Text style={{ color: colors.mutedForeground, marginTop: 24, textAlign: "center" }}>
          You don't have any active subscriptions yet.
        </Text>
      )}
      {subs.map(s => (
        <View key={s.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{s.template?.name ?? `Plan #${s.templateId}`}</Text>
            <View style={[styles.badge, { backgroundColor: COLOR_STATUS[s.status] ?? "#999" }]}>
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>{s.status.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            {s.template?.billingCycle ?? ""} · ₹{s.template?.price ?? "—"}
          </Text>
          <View style={{ marginTop: 10, padding: 10, backgroundColor: colors.background, borderRadius: 8 }}>
            <Text style={{ color: colors.foreground }}>🍽️ Meals: {s.mealsRemaining} remaining ({s.mealsUsed} used)</Text>
            <Text style={{ color: colors.foreground, marginTop: 4 }}>💳 Credits: {s.creditsRemaining} remaining ({s.creditsUsed} used)</Text>
          </View>
          {s.nextBillingDate && (
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 8 }}>
              Next renewal: {new Date(s.nextBillingDate).toLocaleDateString()}
            </Text>
          )}
          {s.failedAttempts > 0 && (
            <Text style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>
              ⚠️ {s.failedAttempts} failed payment attempt(s)
            </Text>
          )}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {s.status === "active" && (
              <TouchableOpacity style={[styles.btn, { backgroundColor: "#eab308" }]}
                onPress={() => action.mutate({ id: s.id, path: "pause" })}>
                <Text style={styles.btnText}>Pause</Text>
              </TouchableOpacity>
            )}
            {s.status === "paused" && (
              <TouchableOpacity style={[styles.btn, { backgroundColor: "#16a34a" }]}
                onPress={() => action.mutate({ id: s.id, path: "resume" })}>
                <Text style={styles.btnText}>Resume</Text>
              </TouchableOpacity>
            )}
            {(s.status === "active" || s.status === "paused") && (
              <TouchableOpacity style={[styles.btn, { backgroundColor: "#dc2626" }]}
                onPress={() => Alert.alert("Cancel?", "Cancel at end of current cycle?", [
                  { text: "Keep" },
                  { text: "Cancel at cycle end", onPress: () => action.mutate({ id: s.id, path: "cancel", body: { atCycleEnd: true } }) },
                ])}>
                <Text style={styles.btnText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: "600", flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
});
