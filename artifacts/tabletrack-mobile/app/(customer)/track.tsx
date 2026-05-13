import React from "react";
import {
  View, Text, StyleSheet, Pressable, Platform, ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { getPublicOrder, getGetPublicOrderQueryKey } from "@workspace/api-client-react";
import type { PublicOrderStatus } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

const STEPS = [
  { key: "pending", label: "Order Received", icon: "receipt-outline" as const, desc: "Your order has been received" },
  { key: "in_progress", label: "Being Prepared", icon: "flame-outline" as const, desc: "The kitchen is preparing your food" },
  { key: "ready", label: "Ready to Serve", icon: "checkmark-circle-outline" as const, desc: "Your order is ready!" },
  { key: "served", label: "Served", icon: "happy-outline" as const, desc: "Enjoy your meal!" },
];

const STATUS_ORDER = ["pending", "in_progress", "ready", "served", "completed"];

export default function TrackOrderScreen() {
  const { orderId, orderNumber } = useLocalSearchParams<{ orderId: string; orderNumber: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const id = Number(orderId);

  const { data, isLoading, refetch } = useQuery({
    queryKey: getGetPublicOrderQueryKey(id),
    queryFn: () => getPublicOrder(id),
    refetchInterval: 8000,
    enabled: !!id,
  });

  const orderData = data as PublicOrderStatus | null;
  const status = orderData?.status ?? "pending";
  const currentStep = STATUS_ORDER.indexOf(status);

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: isWeb ? 67 + 16 : insets.top + 16,
          paddingBottom: isWeb ? 34 : insets.bottom,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Order #{orderNumber}</Text>
        <Pressable onPress={() => refetch()} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.stepsContainer}>
          {STEPS.map((step, index) => {
            const stepOrder = STATUS_ORDER.indexOf(step.key);
            const isDone = currentStep > stepOrder;
            const isCurrent = currentStep === stepOrder;
            return (
              <View key={step.key} style={styles.stepRow}>
                <View style={styles.stepLeft}>
                  <View
                    style={[
                      styles.stepIcon,
                      {
                        backgroundColor: isDone ? colors.success : isCurrent ? colors.primary : colors.muted,
                        borderColor: isCurrent ? colors.primary : "transparent",
                      },
                    ]}
                  >
                    <Ionicons
                      name={isDone ? "checkmark" : step.icon}
                      size={20}
                      color={isDone || isCurrent ? "#fff" : colors.mutedForeground}
                    />
                  </View>
                  {index < STEPS.length - 1 ? (
                    <View style={[styles.stepLine, { backgroundColor: isDone ? colors.success : colors.border }]} />
                  ) : null}
                </View>
                <View style={styles.stepContent}>
                  <Text style={[styles.stepLabel, { color: isCurrent ? colors.foreground : colors.mutedForeground }, isCurrent && styles.stepLabelActive]}>
                    {step.label}
                  </Text>
                  {isCurrent ? <Text style={[styles.stepDesc, { color: colors.primary }]}>{step.desc}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.callBtn, { backgroundColor: colors.accent, borderColor: colors.primary + "40", opacity: pressed ? 0.8 : 1 }]}
          onPress={() => refetch()}
        >
          <Ionicons name="hand-left-outline" size={20} color={colors.primary} />
          <Text style={[styles.callBtnText, { color: colors.primary }]}>Call Waiter</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.newOrderBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          onPress={() => router.replace("/(customer)" as `/${string}`)}
        >
          <Text style={[styles.newOrderBtnText, { color: colors.mutedForeground }]}>Order More Items</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 32 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  refreshBtn: { padding: 4 },
  stepsContainer: { flex: 1 },
  stepRow: { flexDirection: "row", gap: 16, minHeight: 64 },
  stepLeft: { alignItems: "center", width: 44 },
  stepIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  stepLine: { flex: 1, width: 2, marginVertical: 4 },
  stepContent: { flex: 1, justifyContent: "center", paddingBottom: 16 },
  stepLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  stepLabelActive: { fontFamily: "Inter_700Bold" } as const,
  stepDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  actions: { gap: 10, paddingVertical: 20 },
  callBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1, paddingVertical: 14 },
  callBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  newOrderBtn: { alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, paddingVertical: 12 },
  newOrderBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
