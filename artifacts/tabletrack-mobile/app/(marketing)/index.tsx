import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  RoleHomeCard, QuickActionButton, AppText,
} from "@/components/ui";
import { RoleShellScreen } from "@/components/RoleShellScreen";

/**
 * Marketing home. Launches into Growth (campaigns), Coupons, Customer
 * lists and Feedback / reviews. Real screens live in /(owner)/* —
 * this is the role-scoped landing page.
 */
export default function MarketingHome() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await qc.invalidateQueries(); } finally { setRefreshing(false); }
  }, [qc]);
  return (
    <RoleShellScreen
      title="Marketing"
      subtitle="Grow your audience"
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <RoleHomeCard
        eyebrow="Today"
        icon="megaphone-outline"
        title="Campaigns & coupons"
        subtitle="Plan a push, create a coupon, or check how the last campaign performed."
        onPress={() => router.push("/(owner)/growth" as never)}
      />

      <AppText variant="h3" style={{ marginTop: 8 }}>Quick actions</AppText>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <QuickActionButton icon="megaphone-outline" label="Growth" onPress={() => router.push("/(owner)/growth" as never)} />
        <QuickActionButton icon="ticket-outline" label="Coupons" onPress={() => router.push("/(owner)/coupons" as never)} />
        <QuickActionButton icon="people-outline" label="Customers" onPress={() => router.push("/(owner)/customers" as never)} />
        <QuickActionButton icon="chatbubbles-outline" label="Feedback" onPress={() => router.push("/(owner)/feedback" as never)} />
      </View>
    </RoleShellScreen>
  );
}
