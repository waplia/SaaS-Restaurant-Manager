import React from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import {
  AppText, AppCard, AppButton, AppEmptyState, AppModal, AppInput, StatusChip,
} from "@/components/ui";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/theme";

interface AggDashRow {
  aggregator: string;
  grossPaise: number;
  commissionPaise: number;
  actualNetPaise: number;
  expectedNetPaise: number;
  adjustmentsPaise: number;
  variancePaise: number;
  sheetCount: number;
  matchedCount: number;
  disputedCount: number;
  unmatchedCount: number;
}
interface AggDash {
  from?: string; to?: string;
  totals?: AggDashRow & { aggregator?: string };
  perAggregator?: AggDashRow[];
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export default function AccountantSettlementsScreen() {
  const t = useTheme();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const [claimFor, setClaimFor] = React.useState<AggDashRow | null>(null);
  const [issueType, setIssueType] = React.useState("commission_mismatch");
  const [notes, setNotes] = React.useState("");

  const dashQ = useQuery({
    queryKey: ["acct-agg-dashboard", restaurantId],
    queryFn: () => customFetch<AggDash>(`/api/restaurants/${restaurantId}/aggregator-payouts/dashboard`).catch(() => ({} as AggDash)),
    enabled: !!restaurantId,
  });

  const flag = useMutation({
    mutationFn: (body: { aggregator: string; amountPaise: number; issueType: string; notes?: string }) =>
      customFetch(`/api/restaurants/${restaurantId}/aggregator-payouts/claims`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setClaimFor(null);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["acct-agg-dashboard"] });
      Alert.alert("Claim filed", "The mismatch has been logged for follow-up.");
    },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not file claim"),
  });

  const rows = dashQ.data?.perAggregator ?? [];
  const totals = dashQ.data?.totals;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="Settlements" subtitle="Aggregator reconciliation · 30 day" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={dashQ.isFetching} onRefresh={() => dashQ.refetch()} tintColor={t.colors.primary} />}
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md, paddingBottom: 40 }}
      >
        {totals ? (
          <AppCard>
            <AppText variant="micro" color="mutedForeground" style={{ letterSpacing: 0.5 }}>NET VARIANCE</AppText>
            <AppText variant="hero" style={{ marginTop: 4 }}>{inr(totals.variancePaise)}</AppText>
            <AppText variant="small" color="mutedForeground" style={{ marginTop: 4 }}>
              Across {totals.sheetCount} payout sheets · {totals.matchedCount} matched, {totals.unmatchedCount} unmatched, {totals.disputedCount} disputed
            </AppText>
          </AppCard>
        ) : null}

        {rows.length === 0 && !dashQ.isLoading ? (
          <AppEmptyState
            icon="git-compare-outline"
            title="No payouts to reconcile"
            description="Aggregator payout sheets imported in the last 30 days will appear here for comparison."
          />
        ) : null}

        {rows.map(r => {
          const off = r.variancePaise !== 0 || r.unmatchedCount > 0 || r.disputedCount > 0;
          return (
            <AppCard key={r.aggregator}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <AppText variant="h3" style={{ textTransform: "capitalize" }}>{r.aggregator}</AppText>
                <StatusChip
                  label={off ? "Mismatch" : "Matched"}
                  tone={off ? "danger" : "success"}
                  size="xs"
                />
              </View>
              <View style={{ flexDirection: "row", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
                <Stat label="Gross" value={inr(r.grossPaise)} />
                <Stat label="Commission" value={inr(r.commissionPaise)} />
                <Stat label="Expected net" value={inr(r.expectedNetPaise)} />
                <Stat label="Actual net" value={inr(r.actualNetPaise)} />
                <Stat label="Variance" value={inr(r.variancePaise)} tone={r.variancePaise === 0 ? "neutral" : "danger"} />
              </View>
              {off ? (
                <AppButton
                  label="Flag mismatch"
                  leftIcon="flag-outline"
                  variant="outline"
                  size="sm"
                  style={{ marginTop: 12 }}
                  onPress={() => { setClaimFor(r); setIssueType("commission_mismatch"); setNotes(""); }}
                />
              ) : null}
            </AppCard>
          );
        })}
      </ScrollView>

      <AppModal
        visible={!!claimFor}
        onClose={() => setClaimFor(null)}
        title={claimFor ? `Flag ${claimFor.aggregator} mismatch` : "Flag mismatch"}
      >
        <View style={{ gap: 12 }}>
          <AppInput
            label="Issue type"
            value={issueType}
            onChangeText={setIssueType}
            placeholder="commission_mismatch"
          />
          <AppInput
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            placeholder="What's off? (optional)"
          />
          {claimFor ? (
            <AppText variant="small" color="mutedForeground">
              Amount: {inr(Math.abs(claimFor.variancePaise))}
            </AppText>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <AppButton label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setClaimFor(null)} />
            <AppButton
              label="File claim"
              style={{ flex: 1 }}
              loading={flag.isPending}
              disabled={!issueType.trim()}
              onPress={() => claimFor && flag.mutate({
                aggregator: claimFor.aggregator,
                amountPaise: Math.abs(claimFor.variancePaise),
                issueType: issueType.trim(),
                notes: notes.trim() || undefined,
              })}
            />
          </View>
        </View>
      </AppModal>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <View style={{ minWidth: 90 }}>
      <AppText variant="micro" color="mutedForeground">{label.toUpperCase()}</AppText>
      <AppText variant="bodyMd" color={tone === "danger" ? "destructive" : undefined}>{value}</AppText>
    </View>
  );
}
