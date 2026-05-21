import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { BRAND } from "@/constants/brand";

type AiSummary = { balance?: number; included?: number; used?: number; resetAt?: string };

interface Tool {
  key: string;
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  cost: number;
  href: string;
}

const TOOLS: Tool[] = [
  { key: "menu", label: "Menu generator", desc: "AI item names + descriptions + photos", icon: "restaurant-outline", cost: 5, href: "/(owner)/menu" },
  { key: "review-reply", label: "Review reply assistant", desc: "Polite, on-brand replies in seconds", icon: "chatbubbles-outline", cost: 1, href: "/(owner)/feedback" },
  { key: "campaign", label: "Campaign writer", desc: "WhatsApp/SMS for inactive customers", icon: "megaphone-outline", cost: 3, href: "/(owner)/growth" },
  { key: "fraud", label: "Fraud watch", desc: "Auto-flag risky cash & void patterns", icon: "shield-checkmark-outline", cost: 0, href: "/(owner)/reports" },
  { key: "forecast", label: "Demand forecast", desc: "What sells tomorrow + prep list", icon: "trending-up-outline", cost: 2, href: "/(owner)/reports" },
  { key: "stock", label: "Smart reorder", desc: "AI suggests POs from sales velocity", icon: "cube-outline", cost: 2, href: "/(owner)/inventory" },
];

export default function KhanaAIScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { restaurantId } = useAuth();

  const { data } = useQuery({
    queryKey: ["ai-usage-summary", restaurantId],
    queryFn: () => customFetch<AiSummary>(`/api/restaurants/${restaurantId}/ai/usage-summary`).catch(() => ({} as AiSummary)),
  });
  const balance = data?.balance ?? 0;
  const used = data?.used ?? 0;
  const included = data?.included ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Khana AI" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: isWeb ? 100 : insets.bottom + 100 }}>
        <View style={[styles.balanceCard, { backgroundColor: BRAND.ai }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.balanceLabel}>Your AI credits</Text>
            <Text style={styles.balanceNum}>{balance}</Text>
            <Text style={styles.balanceSub}>{used} used of {included} this month</Text>
          </View>
          <Ionicons name="sparkles" size={40} color="#fff" />
        </View>

        <Pressable
          onPress={() => router.push("/(owner)/khana-ai-chat" as never)}
          style={({ pressed }) => [styles.chatCta, { backgroundColor: colors.card, borderColor: BRAND.ai, opacity: pressed ? 0.85 : 1 }]}
        >
          <View style={[styles.iconWrap, { backgroundColor: "#ede9fe" }]}>
            <Ionicons name="chatbubble-ellipses" size={22} color={BRAND.ai} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.chatTitle, { color: colors.foreground }]}>Chat with Khana AI</Text>
            <Text style={[styles.chatDesc, { color: colors.mutedForeground }]}>
              Ask anything about your restaurant — sales, staff, stock, customers.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>

        <Text style={[styles.heading, { color: colors.mutedForeground }]}>AI tools</Text>
        {TOOLS.map(t => (
          <Pressable
            key={t.key}
            onPress={() => router.push(t.href as never)}
            style={({ pressed }) => [styles.toolCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
              <Ionicons name={t.icon} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.toolTitle, { color: colors.foreground }]}>{t.label}</Text>
              <Text style={[styles.toolDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{t.desc}</Text>
            </View>
            <View style={[styles.costChip, { backgroundColor: t.cost === 0 ? "#dcfce7" : "#ede9fe" }]}>
              <Text style={[styles.costText, { color: t.cost === 0 ? "#166534" : BRAND.ai }]}>
                {t.cost === 0 ? "Free" : `${t.cost} cr`}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  balanceCard: { flexDirection: "row", alignItems: "center", padding: 18, borderRadius: 16 },
  balanceLabel: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  balanceNum: { color: "#fff", fontSize: 36, fontFamily: "Inter_700Bold", marginTop: 4 },
  balanceSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  chatCta: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  chatTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  chatDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  heading: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, paddingHorizontal: 4 },
  toolCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  toolTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  toolDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  costChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  costText: { fontSize: 11, fontFamily: "Inter_700Bold" },
});
