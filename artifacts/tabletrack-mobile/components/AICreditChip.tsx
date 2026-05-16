import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/constants/brand";

type AiSummary = { balance?: number; included?: number; used?: number };

export function AICreditChip({ compact = false }: { compact?: boolean }) {
  const { restaurantId } = useAuth();
  const { data } = useQuery({
    queryKey: ["ai-usage-summary", restaurantId],
    queryFn: () => customFetch<AiSummary>(`/api/restaurants/${restaurantId}/ai/usage-summary`).catch(() => ({} as AiSummary)),
    staleTime: 60_000,
  });
  const balance = data?.balance ?? 0;
  const low = balance < 10;

  return (
    <Pressable
      onPress={() => router.push("/(owner)/khana-ai" as never)}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: low ? "#fef3c7" : "#ede9fe",
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: compact ? 8 : 10,
        },
      ]}
    >
      <Ionicons name="sparkles" size={12} color={low ? "#92400e" : BRAND.ai} />
      <Text style={[styles.text, { color: low ? "#92400e" : BRAND.ai }]}>
        {compact ? balance : `${balance} AI credits`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, borderRadius: 12 },
  text: { fontSize: 11, fontFamily: "Inter_700Bold" },
});
