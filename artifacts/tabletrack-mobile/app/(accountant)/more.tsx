import React from "react";
import { router } from "expo-router";
import { View } from "react-native";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import { RoleHomeCard, AppText } from "@/components/ui";
import { MyShiftPanel } from "@/components/MyShiftPanel";
import { useAuth } from "@/context/AuthContext";

export default function AccountantMoreScreen() {
  const { user } = useAuth();
  return (
    <RoleShellScreen title="More" subtitle={user?.name ?? "Accountant"}>
      <View style={{ marginHorizontal: -16 }}>
        <MyShiftPanel />
      </View>
      <AppText variant="h3">Money flows</AppText>
      <RoleHomeCard
        icon="business-outline"
        title="Vendor payments"
        subtitle="Approved & scheduled bills, record a payment."
        onPress={() => router.push("/(accountant)/vendor-payments" as never)}
      />
      <RoleHomeCard
        icon="git-compare-outline"
        title="Settlement reconciliation"
        subtitle="Aggregator payouts vs sales, flag mismatches."
        onPress={() => router.push("/(accountant)/settlements" as never)}
      />
      <RoleHomeCard
        icon="return-down-back-outline"
        title="Refund approvals"
        subtitle="Approve refunds and mark them succeeded."
        onPress={() => router.push("/(accountant)/refunds" as never)}
      />

      <AppText variant="h3" style={{ marginTop: 8 }}>Profile & account</AppText>
      <RoleHomeCard
        icon="person-circle-outline"
        title="Profile"
        subtitle="Manage your details and password."
        onPress={() => router.push("/profile" as never)}
      />
      <RoleHomeCard
        icon="notifications-outline"
        title="Notifications"
        subtitle="Approval requests and reconciliation alerts."
        onPress={() => router.push("/notifications" as never)}
      />
      <RoleHomeCard
        icon="settings-outline"
        title="Settings"
        subtitle="App preferences."
        onPress={() => router.push("/settings" as never)}
      />
      <RoleHomeCard
        icon="help-circle-outline"
        title="Support"
        subtitle="Reach the TableTrack team for help."
        onPress={() => router.push("/support" as never)}
      />
      <RoleHomeCard
        icon="swap-horizontal-outline"
        title="Switch role"
        subtitle="Jump to another role you have access to."
        onPress={() => router.push("/role-switch" as never)}
      />
    </RoleShellScreen>
  );
}
