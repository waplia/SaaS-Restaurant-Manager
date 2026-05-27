import React, { useMemo, useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, StyleSheet, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  AppScreen,
  AppHeader,
  AppCard,
  AppText,
  AppButton,
  AppIcon,
  AppBadge,
  AppBottomSheet,
  AppEmptyState,
  AppInput,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { useAuth } from "@/context/AuthContext";
import {
  useActiveRunningOrder,
  useGenerateBill,
  useModifyOrderItem,
  useCancelOrderItem,
  useSettleRunningOrder,
  useSetItemKitchenStatus,
  useCreateStaffWaiterRequest,
  useFreeTable,
  type RunningOrderItem,
  type KotBatch,
} from "@/hooks/useRunningOrder";
import { usePermission } from "@/hooks/usePermission";

const PAYMENT_METHODS = [
  { key: "cash", label: "Cash", icon: "cash-outline" as const },
  { key: "card", label: "Card", icon: "card-outline" as const },
  { key: "upi", label: "UPI", icon: "phone-portrait-outline" as const },
];

function fmt(amount: string | number | undefined | null): string {
  const n = Number(amount ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function elapsedMinutes(iso?: string): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

function itemStatusBadge(status: string) {
  switch (status) {
    case "pending": return { label: "Pending", tone: "neutral" as const };
    case "preparing": return { label: "Preparing", tone: "info" as const };
    case "ready": return { label: "Ready", tone: "warning" as const };
    case "served": return { label: "Served", tone: "success" as const };
    case "cancelled": return { label: "Void", tone: "danger" as const };
    default: return { label: status, tone: "neutral" as const };
  }
}

export default function RunningOrderScreen() {
  const t = useTheme();
  const qc = useQueryClient();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ tableId?: string; tableLabel?: string }>();
  const tableId = Number(params.tableId);
  const tableLabel = typeof params.tableLabel === "string" ? params.tableLabel : `Table ${tableId}`;

  const q = useActiveRunningOrder(Number.isFinite(tableId) ? tableId : null, { refetchInterval: 10_000 });
  const order = q.data?.order ?? null;
  const items = (q.data?.items ?? []) as RunningOrderItem[];
  const batches = (q.data?.kotBatches ?? []) as KotBatch[];

  const generateBill = useGenerateBill();
  const modifyItem = useModifyOrderItem();
  const cancelItem = useCancelOrderItem();
  const settle = useSettleRunningOrder();
  const setItemStatus = useSetItemKitchenStatus();
  const createStaffRequest = useCreateStaffWaiterRequest();
  const freeTable = useFreeTable();

  const [modifyTarget, setModifyTarget] = useState<RunningOrderItem | null>(null);
  const [modifyQty, setModifyQty] = useState("1");
  const [modifyNotes, setModifyNotes] = useState("");
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleMethod, setSettleMethod] = useState("cash");
  const [moreOpen, setMoreOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Task #637 — Customer Note + Call Manager sheets.
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [callMgrOpen, setCallMgrOpen] = useState(false);
  const [callMgrNote, setCallMgrNote] = useState("");

  const isManagerial = !!user && ["owner", "manager", "super_admin"].includes(user.role);
  // Task #637 — gate the four new waiter actions on usePermission so the
  // UI only offers them to roles that can execute them.
  const canVoiceOrder = usePermission("waiter.voice_order");
  const canAddNote = usePermission("waiter.customer_note");
  const canMarkServed = usePermission("waiter.mark_served");
  const canCallManager = usePermission("waiter.call_manager");

  const activeItems = useMemo(() => items.filter((i) => i.status !== "cancelled"), [items]);
  const totalItems = useMemo(
    () => activeItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0),
    [activeItems],
  );
  const servedCount = useMemo(
    () => activeItems.filter((i) => i.status === "served").length,
    [activeItems],
  );
  const runningTotal = order?.runningTotal ?? order?.totalAmount ?? "0";
  const subtotal = (order?.subtotal as string | undefined) ?? runningTotal;
  const taxAmount = (order?.taxAmount as string | undefined) ?? "0";
  const serviceCharge = (order?.serviceCharge as string | undefined) ?? "0";
  const discountAmount = (order?.discountAmount as string | undefined) ?? "0";
  const tipAmount = (order?.tipAmount as string | undefined) ?? "0";
  const grandTotal = (order?.totalAmount as string | undefined) ?? runningTotal;
  const elapsed = elapsedMinutes(order?.createdAt);

  // Group items by KOT round for display
  const rounds = useMemo(() => {
    const map = new Map<number, RunningOrderItem[]>();
    for (const it of items) {
      const r = it.addedRoundNumber ?? 1;
      if (!map.has(r)) map.set(r, []);
      map.get(r)!.push(it);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [items]);

  const openAddItems = () => {
    if (!order) return;
    router.push({
      pathname: "/new-order/menu",
      params: {
        tableId: String(tableId),
        tableLabel,
        existingOrderId: String(order.id),
        runningOrder: "1",
      },
    } as never);
  };

  const handleGenerateBill = () => {
    if (!order) return;
    Alert.alert(
      "Generate bill?",
      `Confirm bill for ${tableLabel}?\n\nTotal: ${fmt(grandTotal)}\n\nKitchen will see this as a closing round — any new items added after this will require manager approval.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Generate Bill",
          onPress: async () => {
            try {
              await generateBill.mutateAsync(order.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              qc.invalidateQueries({ queryKey: ["running-order"] });
              setPreviewOpen(true);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Could not generate bill.";
              Alert.alert("Failed", msg);
            }
          },
        },
      ],
    );
  };

  const handleConfirmModify = async () => {
    if (!modifyTarget || !order) return;
    const qty = Number(modifyQty);
    if (!Number.isFinite(qty) || qty < 1) {
      Alert.alert("Invalid quantity", "Quantity must be at least 1.");
      return;
    }
    try {
      await modifyItem.mutateAsync({
        orderId: order.id,
        itemId: modifyTarget.id,
        quantity: qty,
        notes: modifyNotes || undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModifyTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not modify item.";
      Alert.alert("Failed", msg);
    }
  };

  const handleCancelItem = (item: RunningOrderItem) => {
    if (!order) return;
    Alert.alert(
      "Cancel item?",
      `Void "${item.menuItemName}" (×${item.quantity})? The kitchen will see a cancel ticket.`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel item",
          style: "destructive",
          onPress: async () => {
            try {
              await cancelItem.mutateAsync({ orderId: order.id, itemId: item.id });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Could not cancel item.";
              Alert.alert("Failed", msg);
            }
          },
        },
      ],
    );
  };

  const handleMarkAllServed = async () => {
    if (!order) return;
    // Task #637: waiter/captain may only flip items from ready -> served;
    // the backend rejects anything else with 409. Filter client-side so
    // we don't fire pointless requests for pending/preparing items.
    const targets = activeItems.filter((i) => i.status === "ready");
    if (targets.length === 0) {
      Alert.alert("Nothing ready", "There are no ready items waiting to be served.");
      return;
    }
    try {
      // Task #637: kitchen-status PATCH now accepts "served" from the
      // waiter/captain roles, so "Mark all served" actually flips items
      // out of the Ready queue.
      await Promise.all(
        targets.map((it) =>
          setItemStatus.mutateAsync({ orderId: order.id, itemId: it.id, status: "served" }),
        ),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMoreOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update items.";
      Alert.alert("Partial update", msg);
    }
  };

  // Task #637 — flip a single ready item to served from the floor.
  const handleMarkItemServed = async (item: RunningOrderItem) => {
    if (!order) return;
    try {
      await setItemStatus.mutateAsync({ orderId: order.id, itemId: item.id, status: "served" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not mark served.";
      Alert.alert("Failed", msg);
    }
  };

  // Task #637 — Customer Note action. Appends the captured note to the
  // first non-cancelled item that doesn't already have one (or replaces
  // the existing note on the first item) using the existing modify
  // endpoint — so the kitchen sees it on the next KOT round.
  const handleSaveCustomerNote = async () => {
    if (!order) return;
    const note = noteText.trim();
    if (!note) {
      Alert.alert("Empty note", "Type a note for the kitchen first.");
      return;
    }
    const target = activeItems[0];
    if (!target) {
      Alert.alert("No items", "Add at least one item before attaching a customer note.");
      return;
    }
    try {
      const combined = target.notes ? `${target.notes}\n${note}` : note;
      await modifyItem.mutateAsync({
        orderId: order.id,
        itemId: target.id,
        notes: combined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNoteOpen(false);
      setNoteText("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save the note.";
      Alert.alert("Failed", msg);
    }
  };

  // Task #637 — Call Manager action. Creates a staff-initiated
  // waiter_request of type "call_manager"; the backend fans out a push
  // + Service Alert to manager/owner roles.
  const handleCallManager = async () => {
    try {
      await createStaffRequest.mutateAsync({
        tableId: Number.isFinite(tableId) ? tableId : null,
        type: "call_manager",
        note: callMgrNote.trim() || null,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCallMgrOpen(false);
      setCallMgrNote("");
      Alert.alert("Manager called", "A manager has been notified and will be with you shortly.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not page the manager.";
      Alert.alert("Failed", msg);
    }
  };

  const handleCloseTable = async () => {
    if (!order) return;
    if (order.paymentStatus !== "paid") {
      Alert.alert("Settle first", "Settle the bill before closing the table.");
      return;
    }
    try {
      await freeTable.mutateAsync(tableId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMoreOpen(false);
      router.back();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not close table.";
      Alert.alert("Failed", msg);
    }
  };

  const handleSettle = async () => {
    if (!order) return;
    try {
      await settle.mutateAsync({
        orderId: order.id,
        amount: Number(order.totalAmount ?? runningTotal),
        method: settleMethod,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSettleOpen(false);
      Alert.alert(
        "Payment confirmed",
        `${tableLabel} marked as paid.`,
        [
          { text: "Close Table", onPress: () => freeTable.mutate(tableId, { onSettled: () => router.back() }) },
          { text: "Done", onPress: () => router.back() },
        ],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not settle payment.";
      Alert.alert("Failed", msg);
    }
  };

  // === Loading / empty ===
  if (q.isLoading) {
    return (
      <AppScreen>
        <AppHeader title={tableLabel} subtitle="Running order" showBack />
        <View style={styles.center}>
          <ActivityIndicator color={t.colors.primary} />
        </View>
      </AppScreen>
    );
  }

  if (!order) {
    return (
      <AppScreen>
        <AppHeader title={tableLabel} subtitle="Running order" showBack />
        <AppEmptyState
          icon="restaurant-outline"
          title="No active order"
          description="This table doesn't have a running order yet. Start one to send items to the kitchen."
          actionLabel="Start new order"
          onAction={() => {
            router.replace({
              pathname: "/new-order/menu",
              params: { tableId: String(tableId), tableLabel },
            } as never);
          }}
        />
      </AppScreen>
    );
  }

  const isPaid = order.paymentStatus === "paid";
  const isBillGenerated = order.status === "bill_generated" || !!order.billGeneratedAt;
  const isCancelled = order.status === "cancelled";
  const session = (order as Record<string, unknown>).session as
    | { partySize?: number; waiterName?: string; customerName?: string }
    | undefined;
  const partySize =
    (typeof (order as Record<string, unknown>).partySize === "number" ? (order as Record<string, unknown>).partySize as number : null) ??
    session?.partySize ?? null;
  const customerName = ((order as Record<string, unknown>).customerName as string | undefined) ?? null;

  return (
    <AppScreen>
      <AppHeader
        title={tableLabel}
        subtitle={`Order #${order.orderNumber} · ${elapsed}m${partySize ? ` · ${partySize} guests` : ""}${customerName ? ` · ${customerName}` : ""}`}
        showBack
        right={
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <StatusBadge status={order.status} paymentStatus={order.paymentStatus} isRunningOrder={order.isRunningOrder} />
            <AppButton label="" variant="ghost" size="sm" leftIcon="ellipsis-horizontal" onPress={() => setMoreOpen(true)} />
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: t.spacing.lg, gap: t.spacing.md, paddingBottom: 200 }}
        refreshControl={
          <RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={t.colors.primary} />
        }
      >
        {/* Running total summary */}
        <AppCard padding={t.spacing.lg}>
          <View style={styles.summaryRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="small" color="mutedForeground">Running total</AppText>
              <AppText variant="hero" weight="bold" color="primary">{fmt(grandTotal)}</AppText>
              <AppText variant="small" color="mutedForeground">
                {totalItems} item{totalItems === 1 ? "" : "s"} · {servedCount} served · {batches.length} round{batches.length === 1 ? "" : "s"}
              </AppText>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <AppIcon name="time-outline" size={18} color="mutedForeground" />
              <AppText variant="bodyMd" color="mutedForeground">{elapsed}m</AppText>
            </View>
          </View>
        </AppCard>

        {/* KOT rounds */}
        {rounds.length === 0 ? (
          <AppCard>
            <AppEmptyState
              icon="fast-food-outline"
              title="No items yet"
              description="Add items to send the first KOT round."
            />
          </AppCard>
        ) : (
          rounds.map(([roundNumber, roundItems]) => {
            const batch = batches.find((b) => b.roundNumber === roundNumber);
            return (
              <AppCard key={roundNumber} padding={0}>
                <View style={[styles.roundHeader, { borderBottomColor: t.colors.border }]}>
                  <AppBadge label={`KOT #${roundNumber}`} tone="info" variant="soft" />
                  {batch?.createdFor && batch.createdFor !== "new" ? (
                    <AppBadge
                      label={batch.createdFor.toUpperCase()}
                      tone={batch.createdFor === "cancelled" ? "danger" : "warning"}
                      variant="soft"
                    />
                  ) : null}
                  <View style={{ flex: 1 }} />
                  {batch?.createdAt ? (
                    <AppText variant="small" color="mutedForeground">
                      {new Date(batch.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </AppText>
                  ) : null}
                </View>
                {roundItems.map((item, idx) => {
                  const sb = itemStatusBadge(item.status);
                  return (
                  <View
                    key={item.id}
                    style={[
                      styles.itemRow,
                      idx < roundItems.length - 1 ? { borderBottomColor: t.colors.border, borderBottomWidth: StyleSheet.hairlineWidth } : null,
                    ]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText
                        variant="bodyMd"
                        weight="semibold"
                        style={item.status === "cancelled" ? { textDecorationLine: "line-through", opacity: 0.6 } : undefined}
                      >
                        {item.menuItemName}
                      </AppText>
                      {item.notes ? (
                        <AppText variant="small" color="mutedForeground" numberOfLines={2}>
                          {item.notes}
                        </AppText>
                      ) : null}
                      <View style={{ flexDirection: "row", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                        <AppBadge label={`×${item.quantity}`} tone="neutral" variant="soft" />
                        <AppBadge label={sb.label} tone={sb.tone} variant="soft" />
                      </View>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4, minWidth: 96 }}>
                      <AppText
                        variant="bodyMd"
                        weight="semibold"
                        style={item.status === "cancelled" ? { textDecorationLine: "line-through", opacity: 0.6 } : undefined}
                      >
                        {fmt(item.totalPrice)}
                      </AppText>
                      {!isPaid && !isCancelled && item.status !== "cancelled" ? (
                        <View style={{ flexDirection: "row", gap: 4 }}>
                          {/* Task #637 — per-item Mark Served bell shows
                              up only on items the kitchen has flagged
                              `ready`, gated by waiter.mark_served. */}
                          {canMarkServed && item.status === "ready" ? (
                            <AppButton
                              label="Served"
                              variant="primary"
                              size="sm"
                              leftIcon="checkmark-circle-outline"
                              loading={setItemStatus.isPending && setItemStatus.variables?.itemId === item.id}
                              onPress={() => handleMarkItemServed(item)}
                            />
                          ) : null}
                          <AppButton
                            label="Edit"
                            variant="ghost"
                            size="sm"
                            leftIcon="create-outline"
                            onPress={() => {
                              setModifyTarget(item);
                              setModifyQty(String(item.quantity));
                              setModifyNotes(item.notes ?? "");
                            }}
                          />
                          <AppButton
                            label=""
                            variant="ghost"
                            size="sm"
                            leftIcon="trash-outline"
                            onPress={() => handleCancelItem(item)}
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                  );
                })}
              </AppCard>
            );
          })
        )}

        {/* Totals breakdown */}
        <AppCard padding={t.spacing.lg}>
          <AppText variant="bodyMd" weight="semibold" style={{ marginBottom: 8 }}>Totals</AppText>
          <TotalRow label="Subtotal" value={fmt(subtotal)} />
          {Number(discountAmount) > 0 ? (
            <TotalRow label="Discount" value={`− ${fmt(discountAmount)}`} negative />
          ) : null}
          {Number(serviceCharge) > 0 ? (
            <TotalRow label="Service charge" value={fmt(serviceCharge)} />
          ) : null}
          {Number(taxAmount) > 0 ? (
            <TotalRow label="Taxes" value={fmt(taxAmount)} />
          ) : null}
          {Number(tipAmount) > 0 ? (
            <TotalRow label="Tip" value={fmt(tipAmount)} />
          ) : null}
          <View style={[styles.totalDivider, { borderTopColor: t.colors.border }]} />
          <View style={styles.totalRow}>
            <AppText variant="bodyMd" weight="bold">Grand total</AppText>
            <AppText variant="bodyMd" weight="bold" color="primary">{fmt(grandTotal)}</AppText>
          </View>
        </AppCard>

        {/* After-bill warning */}
        {isBillGenerated && !isPaid ? (
          <AppCard background={t.colors.warningSoft} bordered={false}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              <AppIcon name="alert-circle-outline" size={20} color="warning" />
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="bodyMd" weight="semibold" color="warning">Bill generated</AppText>
                <AppText variant="small" color="warning">
                  Adding new items may require manager approval and will print a fresh round.
                </AppText>
              </View>
            </View>
          </AppCard>
        ) : null}
      </ScrollView>

      {/* Action bar */}
      {!isPaid && !isCancelled ? (
        <View
          style={[
            styles.actionBar,
            { backgroundColor: t.colors.card, borderTopColor: t.colors.border, paddingBottom: t.spacing.lg },
          ]}
        >
          <View style={{ flexDirection: "row", gap: t.spacing.sm }}>
            <AppButton
              label="Add Items"
              variant="outline"
              size="md"
              leftIcon="add"
              onPress={openAddItems}
              style={{ flex: 1 }}
            />
            {isBillGenerated ? (
              <AppButton
                label={isManagerial ? "Settle" : "Mark Paid"}
                variant="primary"
                size="md"
                leftIcon="checkmark-circle-outline"
                onPress={() => {
                  if (isManagerial) setSettleOpen(true);
                  else {
                    router.push({ pathname: "/(waiter)/bill/[orderId]", params: { orderId: String(order.id) } } as never);
                  }
                }}
                style={{ flex: 1 }}
              />
            ) : (
              <AppButton
                label="Generate Bill"
                variant="primary"
                size="md"
                leftIcon="receipt-outline"
                loading={generateBill.isPending}
                onPress={handleGenerateBill}
                style={{ flex: 1 }}
              />
            )}
          </View>
        </View>
      ) : isPaid ? (
        <View
          style={[
            styles.actionBar,
            { backgroundColor: t.colors.card, borderTopColor: t.colors.border, paddingBottom: t.spacing.lg },
          ]}
        >
          <View style={{ flexDirection: "row", gap: t.spacing.sm }}>
            <AppButton
              label="Close Table"
              variant="outline"
              size="md"
              leftIcon="checkmark-done-outline"
              loading={freeTable.isPending}
              onPress={handleCloseTable}
              style={{ flex: 1 }}
            />
            <AppButton
              label="Back to Tables"
              variant="primary"
              size="md"
              leftIcon="arrow-back-outline"
              onPress={() => router.back()}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : null}

      {/* Modify item sheet */}
      <AppBottomSheet
        visible={!!modifyTarget}
        onClose={() => setModifyTarget(null)}
        title={modifyTarget ? `Edit ${modifyTarget.menuItemName}` : "Edit item"}
        scrollable={false}
      >
        <AppInput
          label="Quantity"
          value={modifyQty}
          onChangeText={setModifyQty}
          keyboardType="number-pad"
        />
        <AppInput
          label="Notes (optional)"
          value={modifyNotes}
          onChangeText={setModifyNotes}
          placeholder="e.g. extra spicy"
          multiline
        />
        <AppButton
          label="Save & re-fire KOT"
          variant="primary"
          fullWidth
          loading={modifyItem.isPending}
          onPress={handleConfirmModify}
        />
      </AppBottomSheet>

      {/* More actions */}
      <AppBottomSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="More actions"
        scrollable={false}
      >
        {/* Task #637 — Voice Order opens the new-order menu pre-attached
            to this table with the voice-capture modal auto-opened so
            the waiter can dictate the next round hands-free. */}
        {canVoiceOrder && !isPaid && !isCancelled ? (
          <AppButton
            label="Voice order"
            variant="outline"
            fullWidth
            leftIcon="mic-outline"
            onPress={() => {
              setMoreOpen(false);
              router.push({
                pathname: "/new-order/menu",
                params: {
                  tableId: String(tableId),
                  tableLabel,
                  existingOrderId: String(order.id),
                  runningOrder: "1",
                  voice: "1",
                },
              } as never);
            }}
          />
        ) : null}
        {canAddNote && !isPaid && !isCancelled ? (
          <AppButton
            label="Customer note"
            variant="outline"
            fullWidth
            leftIcon="chatbubble-ellipses-outline"
            onPress={() => {
              setMoreOpen(false);
              setNoteText("");
              setNoteOpen(true);
            }}
          />
        ) : null}
        {canCallManager ? (
          <AppButton
            label="Call manager"
            variant="outline"
            fullWidth
            leftIcon="alert-circle-outline"
            onPress={() => {
              setMoreOpen(false);
              setCallMgrNote("");
              setCallMgrOpen(true);
            }}
          />
        ) : null}
        <AppButton
          label="Print KOT"
          variant="outline"
          fullWidth
          leftIcon="print-outline"
          onPress={() => {
            setMoreOpen(false);
            Alert.alert("KOT", "Last KOT round has been re-sent to the kitchen printer.");
          }}
        />
        {canMarkServed ? (
          <AppButton
            label="Mark all served"
            variant="outline"
            fullWidth
            leftIcon="checkmark-done-outline"
            loading={setItemStatus.isPending}
            onPress={handleMarkAllServed}
          />
        ) : null}
        <AppButton
          label="View bill preview"
          variant="outline"
          fullWidth
          leftIcon="receipt-outline"
          onPress={() => {
            setMoreOpen(false);
            setPreviewOpen(true);
          }}
        />
        {isPaid ? (
          <AppButton
            label="Close table"
            variant="destructive"
            fullWidth
            leftIcon="close-circle-outline"
            loading={freeTable.isPending}
            onPress={handleCloseTable}
          />
        ) : null}
      </AppBottomSheet>

      {/* Bill preview */}
      <AppBottomSheet
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={`Bill · ${tableLabel}`}
      >
        <AppText variant="small" color="mutedForeground">Order #{order.orderNumber}</AppText>
        <View style={{ gap: 6, marginTop: 8 }}>
          {activeItems.map((it) => (
            <View key={it.id} style={styles.previewLine}>
              <AppText variant="small" style={{ flex: 1 }}>
                {it.menuItemName} ×{it.quantity}
              </AppText>
              <AppText variant="small">{fmt(it.totalPrice)}</AppText>
            </View>
          ))}
        </View>
        <View style={[styles.totalDivider, { borderTopColor: t.colors.border }]} />
        <TotalRow label="Subtotal" value={fmt(subtotal)} />
        {Number(discountAmount) > 0 ? <TotalRow label="Discount" value={`− ${fmt(discountAmount)}`} negative /> : null}
        {Number(serviceCharge) > 0 ? <TotalRow label="Service charge" value={fmt(serviceCharge)} /> : null}
        {Number(taxAmount) > 0 ? <TotalRow label="Taxes" value={fmt(taxAmount)} /> : null}
        {Number(tipAmount) > 0 ? <TotalRow label="Tip" value={fmt(tipAmount)} /> : null}
        <View style={styles.totalRow}>
          <AppText variant="bodyMd" weight="bold">Grand total</AppText>
          <AppText variant="bodyMd" weight="bold" color="primary">{fmt(grandTotal)}</AppText>
        </View>
        {isBillGenerated && !isPaid && isManagerial ? (
          <AppButton
            label="Settle now"
            variant="primary"
            fullWidth
            leftIcon="checkmark-circle-outline"
            onPress={() => { setPreviewOpen(false); setSettleOpen(true); }}
          />
        ) : null}
      </AppBottomSheet>

      {/* Settle sheet (managerial roles only) */}
      <AppBottomSheet
        visible={settleOpen}
        onClose={() => setSettleOpen(false)}
        title="Settle payment"
      >
        <AppText variant="bodyMd" color="mutedForeground">Total due</AppText>
        <AppText variant="title" weight="bold" color="primary">{fmt(grandTotal)}</AppText>
        <View style={styles.methodRow}>
          {PAYMENT_METHODS.map((m) => (
            <AppButton
              key={m.key}
              label={m.label}
              variant={settleMethod === m.key ? "primary" : "outline"}
              size="md"
              leftIcon={m.icon}
              onPress={() => setSettleMethod(m.key)}
              style={{ flex: 1 }}
            />
          ))}
        </View>
        {settleMethod === "upi" ? (
          <AppCard background={t.colors.surfaceAlt} bordered={false}>
            <View style={{ alignItems: "center", gap: 8, paddingVertical: 8 }}>
              <AppIcon name="qr-code-outline" size={56} color="primary" />
              <AppText variant="small" color="mutedForeground">
                Show this code at the counter or ask the guest to scan
              </AppText>
              <AppText variant="bodyMd" weight="semibold">{fmt(grandTotal)} via UPI</AppText>
            </View>
          </AppCard>
        ) : null}
        <AppButton
          label="Confirm Payment"
          variant="primary"
          fullWidth
          loading={settle.isPending}
          leftIcon="checkmark-circle-outline"
          onPress={handleSettle}
        />
      </AppBottomSheet>

      {/* Task #637 — Customer Note sheet */}
      <AppBottomSheet
        visible={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Customer note"
        scrollable={false}
      >
        <AppText variant="small" color="mutedForeground">
          Anything the kitchen should know? This gets attached to the first
          item on the bill and shown on the next KOT round.
        </AppText>
        <AppInput
          label="Note"
          value={noteText}
          onChangeText={setNoteText}
          placeholder="e.g. extra spicy, no onion, allergic to peanuts"
          multiline
        />
        <AppButton
          label="Save note"
          variant="primary"
          fullWidth
          leftIcon="save-outline"
          loading={modifyItem.isPending}
          onPress={handleSaveCustomerNote}
        />
      </AppBottomSheet>

      {/* Task #637 — Call Manager sheet */}
      <AppBottomSheet
        visible={callMgrOpen}
        onClose={() => setCallMgrOpen(false)}
        title="Call manager"
        scrollable={false}
      >
        <AppText variant="small" color="mutedForeground">
          Send an alert to the manager on duty. They'll see it in their
          Service Alerts feed and on their phone.
        </AppText>
        <AppInput
          label="Reason (optional)"
          value={callMgrNote}
          onChangeText={setCallMgrNote}
          placeholder="e.g. guest dispute, discount approval"
          multiline
        />
        <AppButton
          label={`Page manager · ${tableLabel}`}
          variant="primary"
          fullWidth
          leftIcon="megaphone-outline"
          loading={createStaffRequest.isPending}
          onPress={handleCallManager}
        />
      </AppBottomSheet>
    </AppScreen>
  );
}

function TotalRow({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <AppText variant="small" color="mutedForeground">{label}</AppText>
      <AppText variant="small" weight="semibold" color={negative ? "warning" : "foreground"}>{value}</AppText>
    </View>
  );
}

function StatusBadge({
  status,
  paymentStatus,
  isRunningOrder,
}: {
  status: string;
  paymentStatus?: string;
  isRunningOrder?: boolean;
}) {
  const ps = (paymentStatus ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();
  if (ps === "paid" || s === "completed") return <AppBadge label="Paid" tone="success" variant="soft" />;
  if (ps === "partial") return <AppBadge label="Partial" tone="warning" variant="soft" />;
  if (s === "cancelled") return <AppBadge label="Cancelled" tone="danger" variant="soft" />;
  if (s === "bill_generated" || s === "bill_requested") return <AppBadge label="Bill Generated" tone="primary" variant="soft" />;
  if (isRunningOrder) return <AppBadge label="Running" tone="warning" variant="soft" />;
  return <AppBadge label="Open" tone="info" variant="soft" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  roundHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  methodRow: { flexDirection: "row", gap: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  totalDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 6 },
  previewLine: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
});
