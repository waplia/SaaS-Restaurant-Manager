import React, { useMemo, useState } from "react";
import { View, Pressable, ScrollView, RefreshControl, Share, Platform } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/AppAlert";
import { useTheme } from "@/theme";
import {
  AppText, AppCard, AppButton, AppInput, AppIcon, AppEmptyState, StatusChip,
  AppBottomSheet, ConfirmationModal,
} from "@/components/ui";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { OfflineBanner } from "@/components/OfflineBanner";
import { DeviceStatusStrip } from "@/components/cashier/DeviceStatusStrip";
import { useAuth } from "@/context/AuthContext";
import { usePermission } from "@/hooks/usePermission";
import {
  cashierFetch, INR_DENOMINATIONS,
  type CashRegisterSession, type CashRegisterTotals, type CashMovement,
} from "@/lib/cashierApi";

type CurrentSession = {
  session: CashRegisterSession | null;
  totals: CashRegisterTotals | null;
};

interface MovementInput { amount: string; reason: string; type: "cash_in" | "cash_out" }

function fmtCurrency(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "₹0";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function CashierShiftScreen() {
  const t = useTheme();
  const { restaurantId, accessToken } = useAuth();
  const qc = useQueryClient();
  const canOpen = usePermission("shift.open");
  const canClose = usePermission("shift.close");
  const canMove = usePermission("cash.drop") || usePermission("cash.pickup");

  const [openSheet, setOpenSheet] = useState(false);
  const [closeSheet, setCloseSheet] = useState(false);
  const [moveSheet, setMoveSheet] = useState<null | "cash_in" | "cash_out">(null);
  const [denoms, setDenoms] = useState<Record<number, string>>({});
  const [closeDenoms, setCloseDenoms] = useState<Record<number, string>>({});
  const [openNotes, setOpenNotes] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [movement, setMovement] = useState<MovementInput>({ amount: "", reason: "", type: "cash_in" });
  const [confirmClose, setConfirmClose] = useState(false);

  const currentQ = useQuery<CurrentSession>({
    queryKey: ["cash-register-current", restaurantId],
    queryFn: () => cashierFetch<CurrentSession>(accessToken, `/restaurants/${restaurantId}/cash-register/current`),
    refetchInterval: 30_000,
    enabled: !!accessToken,
  });

  const session = currentQ.data?.session ?? null;
  const totals = currentQ.data?.totals ?? null;
  const isOpen = session?.status === "open";

  const detailsQ = useQuery({
    queryKey: ["cash-register-session", restaurantId, session?.id],
    queryFn: () =>
      cashierFetch<{
        session: CashRegisterSession;
        movements: CashMovement[];
        totals: CashRegisterTotals;
      }>(accessToken, `/restaurants/${restaurantId}/cash-register/sessions/${session!.id}`),
    enabled: !!session?.id && !!accessToken && (canClose || canMove),
    refetchInterval: 30_000,
  });
  const movements = detailsQ.data?.movements ?? [];

  const openMut = useMutation({
    mutationFn: (payload: { denominations: Array<{ denomination: number; count: number }>; notes?: string }) =>
      cashierFetch<CashRegisterSession>(accessToken, `/restaurants/${restaurantId}/cash-register/sessions/open`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setOpenSheet(false);
      setDenoms({});
      setOpenNotes("");
      qc.invalidateQueries({ queryKey: ["cash-register-current"] });
    },
    onError: (e: Error) => {
      // Dismiss the sheet first — on Android, RN can't render a Modal
      // (the themed alert) stacked on top of another Modal (the bottom
      // sheet), so the error message would be invisible otherwise.
      setOpenSheet(false);
      setTimeout(() => {
        Alert.alert("Could not open shift", e.message);
      }, 250);
    },
  });

  const closeMut = useMutation({
    mutationFn: (payload: {
      denominations: Array<{ denomination: number; count: number }>;
      closeNotes?: string;
      varianceReason?: string;
    }) =>
      cashierFetch(accessToken, `/restaurants/${restaurantId}/cash-register/sessions/${session!.id}/close`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setCloseSheet(false);
      setCloseDenoms({});
      setCloseNotes("");
      setVarianceReason("");
      qc.invalidateQueries({ queryKey: ["cash-register-current"] });
      qc.invalidateQueries({ queryKey: ["cash-register-session"] });
    },
    onError: (e: Error) => {
      // See openMut.onError — dismiss the bottom-sheet Modal first so
      // the alert Modal is actually visible (Android cannot stack Modals).
      setCloseSheet(false);
      setTimeout(() => {
        Alert.alert("Could not close shift", e.message);
      }, 250);
    },
  });

  const movementMut = useMutation({
    mutationFn: (payload: { type: string; amount: number; reason?: string }) =>
      cashierFetch(accessToken, `/restaurants/${restaurantId}/cash-register/sessions/${session!.id}/movements`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setMoveSheet(null);
      setMovement({ amount: "", reason: "", type: "cash_in" });
      qc.invalidateQueries({ queryKey: ["cash-register-current"] });
      qc.invalidateQueries({ queryKey: ["cash-register-session"] });
    },
    onError: (e: Error) => {
      // See openMut.onError — dismiss the bottom-sheet Modal first so
      // the alert Modal is actually visible (Android cannot stack Modals).
      setMoveSheet(null);
      setTimeout(() => {
        Alert.alert("Could not record movement", e.message);
      }, 250);
    },
  });

  const openTotal = useMemo(
    () =>
      INR_DENOMINATIONS.reduce(
        (s, d) => s + d * (Number(denoms[d] || 0) || 0),
        0,
      ),
    [denoms],
  );
  const closeTotal = useMemo(
    () =>
      INR_DENOMINATIONS.reduce(
        (s, d) => s + d * (Number(closeDenoms[d] || 0) || 0),
        0,
      ),
    [closeDenoms],
  );

  const expectedCash = Number(totals?.expectedCash ?? session?.expectedCash ?? 0);
  const variance = closeTotal - expectedCash;
  const varianceAbs = Math.abs(variance);
  const needsReason = varianceAbs >= 0.01;

  const submitOpen = () => {
    const list = INR_DENOMINATIONS.map((d) => ({ denomination: d, count: Number(denoms[d] || 0) || 0 }));
    if (openTotal <= 0) {
      Alert.alert("Add opening float", "Count at least one note or coin to seed the float.");
      return;
    }
    openMut.mutate({ denominations: list, notes: openNotes.trim() || undefined });
  };

  const submitClose = () => {
    if (needsReason && !varianceReason.trim()) {
      Alert.alert(
        "Reason required",
        `Counted cash is ${variance > 0 ? "over" : "short"} by ${fmtCurrency(varianceAbs)}. Enter a reason note before closing.`,
      );
      return;
    }
    const list = INR_DENOMINATIONS.map((d) => ({ denomination: d, count: Number(closeDenoms[d] || 0) || 0 }))
      .filter((r) => r.count > 0);
    closeMut.mutate({
      denominations: list,
      closeNotes: closeNotes.trim() || undefined,
      varianceReason: varianceReason.trim() || undefined,
    });
  };

  // Out-types can't push the drawer negative — server enforces this atomically
  // inside the locked session transaction (FOR UPDATE), so two simultaneous
  // cash-outs can't race past the available cash. We mirror the check here
  // so the cashier gets instant feedback instead of a 400 round-trip.
  const movementAmt = Number(movement.amount);
  const movementAmtValid = isFinite(movementAmt) && movementAmt > 0;
  const isMovementOut = moveSheet === "cash_out";
  const movementInsufficient =
    movementAmtValid && isMovementOut && movementAmt > expectedCash + 0.001;
  const movementReasonMissing = !movement.reason.trim();

  const submitMovement = () => {
    if (!movementAmtValid) {
      Alert.alert("Amount required", "Enter a positive amount.");
      return;
    }
    if (movementInsufficient) {
      Alert.alert(
        "Not enough cash in the drawer",
        `Only ${fmtCurrency(expectedCash)} is available right now — you can't take out ${fmtCurrency(movementAmt)}.`,
      );
      return;
    }
    if (movementReasonMissing) {
      Alert.alert("Reason required", "Briefly describe why cash is being moved.");
      return;
    }
    movementMut.mutate({ type: moveSheet!, amount: movementAmt, reason: movement.reason.trim() });
  };

  const printReport = async () => {
    if (!session) return;
    const totalsView = totals ?? detailsQ.data?.totals;
    const lines = [
      `Cash Register — Session #${session.id}`,
      `Opened by: ${session.openedByName ?? "—"} at ${new Date(session.openedAt).toLocaleString()}`,
      `Status: ${session.status.toUpperCase()}`,
      "",
      `Opening float:  ${fmtCurrency(totalsView?.openingFloat ?? session.openingFloat)}`,
      `Cash from bills:${fmtCurrency(totalsView?.cashSales)}`,
      `Manual cash in: ${fmtCurrency(totalsView?.cashIn)}`,
      `Cash out:       ${fmtCurrency(totalsView?.cashOut)}`,
      `Refunds:        ${fmtCurrency(totalsView?.refunds)}`,
      `Expected cash:  ${fmtCurrency(totalsView?.expectedCash)}`,
      session.actualCash != null ? `Counted cash:   ${fmtCurrency(session.actualCash)}` : "",
      session.overShort != null ? `Over/short:     ${fmtCurrency(session.overShort)}` : "",
    ].filter(Boolean).join("\n");

    // Web preview / desktop browsers don't have React Native's Share sheet,
    // so fall back to a printable popup. Native iOS/Android use the share
    // sheet (which can route to AirDrop, printers, WhatsApp, etc.).
    if (Platform.OS === "web") {
      try {
        const win = typeof window !== "undefined"
          ? window.open("", "_blank", "width=420,height=640")
          : null;
        if (!win) {
          Alert.alert("Pop-up blocked", "Allow pop-ups for this site to print the shift report.");
          return;
        }
        const safe = lines.replace(/[<&>]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;" }[c] ?? c));
        win.document.write(`<!doctype html><html><head><title>Shift #${session.id}</title>
<style>body{font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:24px;white-space:pre-wrap}</style>
</head><body>${safe}<script>setTimeout(()=>window.print(),200);</script></body></html>`);
        win.document.close();
      } catch {
        Alert.alert("Print", "Could not open the print window.");
      }
      return;
    }

    try {
      await Share.share({ message: lines, title: `Shift report #${session.id}` });
    } catch {
      Alert.alert("Print", "Could not open the share sheet.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="Shift" subtitle="Cash register" />
      <DeviceStatusStrip />
      <OfflineBanner />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={currentQ.isRefetching}
            onRefresh={() => { void currentQ.refetch(); void detailsQ.refetch(); }}
            tintColor={t.colors.primary}
          />
        }
      >
        {currentQ.isLoading ? null : !isOpen ? (
          <AppCard padding={16} shadow="sm" style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View
                style={{
                  width: 44, height: 44, borderRadius: 12,
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: "#fef9c3",
                }}
              >
                <AppIcon name="lock-closed" size={20} color="#854d0e" />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="h3">Register is closed</AppText>
                <AppText variant="small" color="mutedForeground">
                  Open a session with the opening float so cash sales start tallying.
                </AppText>
              </View>
            </View>
            <AppButton
              label={canOpen ? "Open register" : "Need permission"}
              leftIcon="lock-open-outline"
              onPress={() => setOpenSheet(true)}
              disabled={!canOpen}
            />
          </AppCard>
        ) : (
          <>
            {/* Hero session card with prominent expected cash */}
            <AppCard padding={16} shadow="md" style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="micro" color="mutedForeground">SESSION OPEN</AppText>
                  <AppText variant="h2">#{session!.id}</AppText>
                  <AppText variant="small" color="mutedForeground" numberOfLines={1}>
                    {session!.openedByName ?? "Cashier"} · {new Date(session!.openedAt).toLocaleString()}
                  </AppText>
                </View>
                <StatusChip label="Open" tone="success" icon="checkmark-circle" />
              </View>

              <View
                style={{
                  borderRadius: 14,
                  padding: 14,
                  backgroundColor: t.colors.accent,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  gap: 4,
                }}
              >
                <AppText variant="micro" color="mutedForeground">EXPECTED IN DRAWER</AppText>
                <AppText
                  variant="hero"
                  weight="bold"
                  style={{ fontSize: 34, lineHeight: 38, color: t.colors.primary }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {fmtCurrency(totals?.expectedCash)}
                </AppText>
                <AppText variant="small" color="mutedForeground">
                  Opening {fmtCurrency(totals?.openingFloat ?? session!.openingFloat)} + cash sales {fmtCurrency(totals?.cashSales)}
                </AppText>
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <Stat
                  label="Cash from bills"
                  value={fmtCurrency(totals?.cashSales)}
                  tone="success"
                  hint="Every bill you mark Cash adds here automatically"
                />
                <Stat
                  label="Manual cash in"
                  value={fmtCurrency(totals?.cashIn)}
                  tone="success"
                  hint="Owner adds, change top-ups, etc."
                />
                <Stat
                  label="Cash out"
                  value={fmtCurrency(totals?.cashOut)}
                  tone="warn"
                  hint="Pickups, drops, vendor payouts"
                />
                <Stat
                  label="Refunds"
                  value={fmtCurrency(totals?.refunds)}
                  tone="warn"
                />
              </View>
            </AppCard>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <AppButton
                label="Cash in"
                variant="outline"
                size="sm"
                leftIcon="arrow-down-circle-outline"
                onPress={() => { setMovement({ amount: "", reason: "", type: "cash_in" }); setMoveSheet("cash_in"); }}
                disabled={!canMove}
                style={{ flex: 1 }}
              />
              <AppButton
                label="Cash out"
                variant="outline"
                size="sm"
                leftIcon="arrow-up-circle-outline"
                onPress={() => { setMovement({ amount: "", reason: "", type: "cash_out" }); setMoveSheet("cash_out"); }}
                disabled={!canMove}
                style={{ flex: 1 }}
              />
              <AppButton
                label="Print"
                variant="outline"
                size="sm"
                leftIcon="print-outline"
                onPress={printReport}
                style={{ flex: 1 }}
              />
            </View>

            <AppButton
              label={canClose ? "Close register" : "Manager only"}
              variant="destructive"
              leftIcon="lock-closed-outline"
              onPress={() => { setCloseDenoms({}); setCloseSheet(true); }}
              disabled={!canClose}
            />

            <AppCard padding={14} shadow="sm" style={{ gap: 6 }}>
              <AppText variant="h3">Recent movements</AppText>
              {movements.length === 0 ? (
                <AppText variant="small" color="mutedForeground">
                  No manual movements yet. Cash-ins, drops, and payouts will appear here.
                </AppText>
              ) : (
                movements.slice(0, 12).map((m) => {
                  const isIn = m.type === "cash_in" || m.type === "sale";
                  return (
                    <View
                      key={m.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingVertical: 6,
                        borderBottomWidth: 1,
                        borderBottomColor: t.colors.border,
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <AppText variant="bodyMd" weight="semibold" numberOfLines={1}>
                          {m.type.replace("_", " ")}
                        </AppText>
                        <AppText variant="micro" color="mutedForeground" numberOfLines={1}>
                          {m.createdByName ?? ""} · {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {m.reason ? ` · ${m.reason}` : ""}
                        </AppText>
                      </View>
                      <AppText
                        variant="bodyMd"
                        weight="bold"
                        style={{ color: isIn ? "#16a34a" : "#dc2626" }}
                      >
                        {isIn ? "+" : "−"}{fmtCurrency(m.amount)}
                      </AppText>
                    </View>
                  );
                })
              )}
            </AppCard>
          </>
        )}

        {!isOpen && currentQ.isLoading ? null : isOpen ? null : (
          <AppEmptyState
            icon="cash-outline"
            title="No data yet"
            description="Open a session to start tracking cash."
          />
        )}
      </ScrollView>

      <AppBottomSheet visible={openSheet} onClose={() => setOpenSheet(false)} title="Open register">
        <AppText variant="small" color="mutedForeground">
          Count the cash currently in the drawer. The totals roll up into your opening float.
        </AppText>
        <DenomGrid value={denoms} onChange={setDenoms} />
        <View
          style={{
            flexDirection: "row", justifyContent: "space-between",
            paddingTop: 8, borderTopWidth: 1, borderTopColor: t.colors.border,
          }}
        >
          <AppText variant="bodyMd" weight="semibold">Opening float</AppText>
          <AppText variant="h3" color="primary">{fmtCurrency(openTotal)}</AppText>
        </View>
        <AppInput
          label="Notes (optional)"
          value={openNotes}
          onChangeText={setOpenNotes}
          placeholder="Shift start notes…"
          multiline
        />
        <AppButton
          label="Open shift"
          leftIcon="lock-open-outline"
          loading={openMut.isPending}
          onPress={submitOpen}
        />
      </AppBottomSheet>

      <AppBottomSheet visible={closeSheet} onClose={() => setCloseSheet(false)} title="Close register">
        <AppText variant="small" color="mutedForeground">
          Count down the drawer. The system compares against the expected cash and asks for a reason if it doesn't match.
        </AppText>
        <DenomGrid value={closeDenoms} onChange={setCloseDenoms} />
        <View style={{ gap: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: t.colors.border }}>
          <Row label="Expected" value={fmtCurrency(expectedCash)} />
          <Row label="Counted" value={fmtCurrency(closeTotal)} />
          <Row
            label={variance >= 0 ? "Over" : "Short"}
            value={fmtCurrency(varianceAbs)}
            valueColor={varianceAbs < 0.01 ? "#16a34a" : variance > 0 ? "#ca8a04" : "#dc2626"}
          />
        </View>
        {needsReason ? (
          <AppInput
            label="Variance reason"
            value={varianceReason}
            onChangeText={setVarianceReason}
            placeholder="Why doesn't the count match? (required)"
            multiline
            error={varianceReason.trim() ? null : "Required when counted ≠ expected"}
          />
        ) : null}
        <AppInput
          label="Close notes (optional)"
          value={closeNotes}
          onChangeText={setCloseNotes}
          placeholder="Anything management should know…"
          multiline
        />
        <AppButton
          label="Close shift"
          variant="destructive"
          leftIcon="lock-closed-outline"
          loading={closeMut.isPending}
          onPress={() => setConfirmClose(true)}
        />
      </AppBottomSheet>

      <ConfirmationModal
        visible={confirmClose}
        onConfirm={() => { setConfirmClose(false); submitClose(); }}
        onCancel={() => setConfirmClose(false)}
        title="Close this shift?"
        message={
          needsReason
            ? `Variance: ${fmtCurrency(varianceAbs)}. The reason note will be saved with the close.`
            : "Counted cash matches expected. This will finalize the session."
        }
        confirmLabel="Close shift"
        tone="destructive"
      />

      <AppBottomSheet
        visible={moveSheet !== null}
        onClose={() => setMoveSheet(null)}
        title={moveSheet === "cash_in" ? "Cash in" : "Cash out"}
      >
        <AppText variant="small" color="mutedForeground">
          {moveSheet === "cash_in"
            ? "Use for owner adds, change from petty cash, etc."
            : "Use for pickups, drops, vendor payouts, etc."}
        </AppText>
        <AppInput
          label="Amount (₹)"
          value={movement.amount}
          onChangeText={(v) => setMovement((m) => ({ ...m, amount: v.replace(/[^\d.]/g, "") }))}
          keyboardType={Platform.OS === "web" ? "default" : "decimal-pad"}
          placeholder="0"
          error={movementInsufficient ? `Only ${fmtCurrency(expectedCash)} in drawer right now` : null}
        />
        {isMovementOut ? (
          <AppText variant="micro" color={movementInsufficient ? "destructive" : "mutedForeground"}>
            Available in drawer: {fmtCurrency(expectedCash)}
          </AppText>
        ) : null}
        <AppInput
          label="Reason"
          value={movement.reason}
          onChangeText={(v) => setMovement((m) => ({ ...m, reason: v }))}
          placeholder="Why is cash being moved?"
        />
        <AppButton
          label={moveSheet === "cash_in" ? "Record cash in" : "Record cash out"}
          loading={movementMut.isPending}
          onPress={submitMovement}
        />
      </AppBottomSheet>
    </View>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "warn" | "primary" | "success"; hint?: string }) {
  const t = useTheme();
  const fg =
    tone === "primary" ? t.colors.primary
    : tone === "warn" ? "#ca8a04"
    : tone === "success" ? "#16a34a"
    : t.colors.foreground;
  return (
    <View
      style={{
        flexBasis: "47%",
        flexGrow: 1,
        gap: 2,
        padding: 10,
        borderRadius: 10,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.border,
      }}
    >
      <AppText variant="micro" color="mutedForeground">{label.toUpperCase()}</AppText>
      <AppText
        variant="h2"
        weight="bold"
        style={{ color: fg }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </AppText>
      {hint ? (
        <AppText variant="micro" color="mutedForeground" numberOfLines={2}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
      <AppText variant="bodyMd">{label}</AppText>
      <AppText variant="bodyMd" weight="bold" style={valueColor ? { color: valueColor } : undefined}>{value}</AppText>
    </View>
  );
}

function DenomGrid({
  value, onChange,
}: { value: Record<number, string>; onChange: (v: Record<number, string>) => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {INR_DENOMINATIONS.map((d) => {
        const count = value[d] ?? "";
        const sub = (Number(count) || 0) * d;
        return (
          <View
            key={d}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingVertical: 4,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.border,
            }}
          >
            <View style={{ width: 64 }}>
              <AppText variant="bodyMd" weight="semibold">₹{d}</AppText>
            </View>
            <View style={{ flex: 1 }}>
              <AppInput
                value={count}
                onChangeText={(v) => onChange({ ...value, [d]: v.replace(/[^\d]/g, "") })}
                keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
                placeholder="0"
                containerStyle={{ marginBottom: 0 }}
              />
            </View>
            <View style={{ width: 90, alignItems: "flex-end" }}>
              <AppText variant="bodyMd">₹{sub.toLocaleString("en-IN")}</AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}
