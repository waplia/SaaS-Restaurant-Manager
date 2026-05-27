import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  RoleHomeCard, QuickActionButton, AppText,
} from "@/components/ui";
import { RoleShellScreen } from "@/components/RoleShellScreen";

/**
 * Accountant / Payroll home. Launchpad into finance, expenses, reports
 * and approvals. Real screens live in /(owner)/* and are reused so
 * accountants see the same numbers the owner does.
 */
export default function AccountantHome() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await qc.invalidateQueries(); } finally { setRefreshing(false); }
  }, [qc]);
  return (
    <RoleShellScreen
      title="Accounts"
      subtitle="Books & reports"
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <RoleHomeCard
        eyebrow="Today"
        icon="calculator-outline"
        title="Books at a glance"
        subtitle="Review the day's revenue, expenses pending approval and any open settlements."
        onPress={() => router.push("/(owner)/finance" as never)}
      />

      <AppText variant="h3" style={{ marginTop: 8 }}>Quick actions</AppText>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <QuickActionButton icon="wallet-outline" label="Finance" onPress={() => router.push("/(owner)/finance" as never)} />
        <QuickActionButton icon="receipt-outline" label="Expenses" onPress={() => router.push("/(owner)/expenses" as never)} />
        <QuickActionButton icon="document-text-outline" label="Reports" onPress={() => router.push("/(owner)/reports" as never)} />
        <QuickActionButton icon="checkmark-done-outline" label="Approvals" onPress={() => router.push("/(owner)/approvals" as never)} />
      </View>
    </RoleShellScreen>
  );
}
