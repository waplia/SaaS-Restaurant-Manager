import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

type Template = {
  id: number; name: string; description: string | null; type: string;
  price: string; currency: string; billingCycle: string;
  mealsPerCycle: number | null; creditsPerCycle: number | null;
  bonusCredits: number; durationCycles: number | null; autoRenew: boolean;
  maxFamilyMembers: number;
};

function apiUrl(p: string) { return `${getApiBaseUrl()}/api${p}`; }
async function fetchJson<T>(url: string, init?: RequestInit, token?: string | null): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export default function PlansScreen() {
  const colors = useColors();
  const { accessToken, restaurantId: ctxRestaurantId } = useAuth();
  const params = useLocalSearchParams<{ restaurantId?: string; customerId?: string }>();
  const restaurantId = Number(params.restaurantId ?? ctxRestaurantId ?? 1);
  const customerId = params.customerId ? Number(params.customerId) : null;
  const qc = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["public-meal-plans", restaurantId],
    queryFn: () => fetchJson<Template[]>(apiUrl(`/restaurants/${restaurantId}/public/meal-plans`), undefined, accessToken),
  });

  const subscribe = useMutation({
    mutationFn: (templateId: number) => {
      if (!customerId) throw new Error("Sign in or provide a customer profile to subscribe.");
      return fetchJson(apiUrl(`/restaurants/${restaurantId}/customer-subscriptions`), {
        method: "POST",
        body: JSON.stringify({ customerId, templateId, paymentMethod: "upi" }),
      }, accessToken);
    },
    onSuccess: () => {
      Alert.alert("Subscribed!", "Your meal plan is active. Show your phone at the restaurant to redeem meals.");
      qc.invalidateQueries({ queryKey: ["my-subscriptions"] });
    },
    onError: (e: Error) => Alert.alert("Subscribe failed", e.message),
  });

  if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[styles.title, { color: colors.foreground }]}>Available Meal Plans</Text>
      {templates.length === 0 && (
        <Text style={{ color: colors.mutedForeground, marginTop: 24, textAlign: "center" }}>
          No public meal plans yet.
        </Text>
      )}
      {templates.map(t => (
        <View key={t.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t.name}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t.type} · {t.billingCycle}</Text>
            </View>
            <Text style={[styles.price, { color: colors.primary }]}>₹{t.price}</Text>
          </View>
          {t.description && <Text style={{ color: colors.foreground, marginTop: 8 }}>{t.description}</Text>}
          <View style={{ marginTop: 8 }}>
            {t.mealsPerCycle ? <Text style={styles.meta}>🍽️ {t.mealsPerCycle} meals per cycle</Text> : null}
            {t.creditsPerCycle ? <Text style={styles.meta}>💳 {t.creditsPerCycle} credits{t.bonusCredits ? ` + ${t.bonusCredits} bonus` : ""}</Text> : null}
            {t.maxFamilyMembers > 1 ? <Text style={styles.meta}>👨‍👩‍👧 Up to {t.maxFamilyMembers} family members</Text> : null}
            {t.durationCycles ? <Text style={styles.meta}>⏳ {t.durationCycles} cycles</Text> : null}
            {t.autoRenew ? <Text style={[styles.meta, { color: "#16a34a" }]}>↻ Auto-renews</Text> : null}
          </View>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.primary }]}
            onPress={() => subscribe.mutate(t.id)}
            disabled={subscribe.isPending}
          >
            <Text style={{ color: "#fff", fontWeight: "600" }}>
              {subscribe.isPending ? "Subscribing…" : "Subscribe"}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  price: { fontSize: 20, fontWeight: "700" },
  meta: { fontSize: 13, marginTop: 4 },
  btn: { marginTop: 12, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
});
