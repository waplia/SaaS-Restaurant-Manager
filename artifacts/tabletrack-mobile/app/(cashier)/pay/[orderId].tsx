import React, { useMemo, useState } from "react";
import {
  View, Pressable, ScrollView, ActivityIndicator, Platform,
} from "react-native";
import { printBill } from "@/lib/printBill";
import { useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  getOrder, getGetOrderQueryKey,
  usePayOrder, useSplitOrder, useUpdateOrder,
  type OrderDetail,
} from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import { useTheme } from "@/theme";
import {
  AppText, AppButton, AppCard, AppIcon, AppInput, StatusChip,
  AppBottomSheet, type AppIconName,
} from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { usePermission } from "@/hooks/usePermission";
import { formatOrderNumber } from "@/lib/orderNumber";

type ApiMethod = "cash" | "card" | "upi";
type SplitLeg = "cash" | "card" | "upi";

interface Method {
  key: "cash" | "card" | "upi" | "phonepe" | "qr" | "split" | "pay_later";
  label: string;
  icon: AppIconName;
  api: ApiMethod | null;
  note?: string;
}

const METHODS: Method[] = [
  { key: "cash",      label: "Cash",        icon: "cash-outline",         api: "cash" },
  { key: "upi",       label: "UPI",         icon: "phone-portrait-outline", api: "upi" },
  { key: "card",      label: "Card",        icon: "card-outline",         api: "card" },
  { key: "phonepe",   label: "PhonePe EDC", icon: "wallet-outline",       api: "card",
    note: "Charged on the linked PhonePe EDC terminal and recorded as a card payment." },
  { key: "qr",        label: "Dynamic QR",  icon: "qr-code-outline",      api: "upi",
    note: "Show the dynamic QR to the customer, then mark received." },
  { key: "split",     label: "Split bill",  icon: "git-branch-outline",   api: null },
  { key: "pay_later", label: "Pay later",   icon: "time-outline",         api: null,
    note: "Tickets ticket to the customer's tab. Manager approval may be required." },
];

const SUGGESTED_TENDERED = [100, 200, 500, 1000, 2000];

function fmt(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "₹0";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function CashierPayScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { restaurantId, accessToken } = useAuth();
  const id = Number(orderId);

  const canSplit = usePermission("bill.split");
  const canCapture = usePermission("payment.capture");

  const [method, setMethod] = useState<Method["key"]>("cash");
  const [tendered, setTendered] = useState("");
  const [splitLegs, setSplitLegs] = useState<Array<{ id: string; method: SplitLeg; amount: string }>>([
    { id: "1", method: "cash", amount: "" },
    { id: "2", method: "upi",  amount: "" },
  ]);
  const [showQrSheet, setShowQrSheet] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: getGetOrderQueryKey(restaurantId, id),
    queryFn: () => getOrder(restaurantId, id),
    enabled: !!id && !!restaurantId,
  });
  const order = (data as OrderDetail | null) ?? null;
  const orderTotal = Number(order?.totalAmount ?? 0);
  const isPaid = (order as { paymentStatus?: string } | null)?.paymentStatus === "paid";
  const orderNumber = formatOrderNumber((order as { orderNumber?: string } | null)?.orderNumber ?? String(id));

  const payMut = usePayOrder();
  const splitMut = useSplitOrder();
  const updateMut = useUpdateOrder();

  const selectedMethod = METHODS.find((m) => m.key === method) ?? METHODS[0];

  const tenderedNum = Number(tendered || 0);
  const change = method === "cash" ? Math.max(0, tenderedNum - orderTotal) : 0;
  const shortfall = method === "cash" ? Math.max(0, orderTotal - tenderedNum) : 0;

  const splitTotal = splitLegs.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const splitRemaining = +(orderTotal - splitTotal).toFixed(2);

  const buzz = () => { if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };
  const buzzWarn = () => { if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); };

  const onAfterPayment = async () => {
    try {
      await updateMut.mutateAsync({ restaurantId, id, data: { status: "completed" } });
    } catch {
      /* status update is best-effort; pay already succeeded */
    }
    qc.invalidateQueries({ queryKey: getGetOrderQueryKey(restaurantId, id) });
    qc.invalidateQueries({ queryKey: ["/api/restaurants", restaurantId, "orders"] });
    qc.invalidateQueries({ queryKey: ["cashier-sales-summary", restaurantId] });
    qc.invalidateQueries({ queryKey: ["cash-register-current", restaurantId] });
    qc.invalidateQueries({ queryKey: ["cashier-bill-requests", restaurantId] });
  };

  const submitSingleApi = async (api: ApiMethod, extra?: Partial<{ amountTendered: number }>) => {
    if (!canCapture) {
      Alert.alert("Permission needed", "You don't have permission to capture payments.");
      return;
    }
    try {
      await payMut.mutateAsync({
        restaurantId,
        id,
        data: { paymentMethod: api, ...(extra ?? {}) },
      });
      buzz();
      await onAfterPayment();
      Alert.alert(
        "Payment recorded",
        `Order #${orderNumber} marked as paid via ${selectedMethod.label}.${change > 0 ? `\nReturn change: ${fmt(change)}` : ""}`,
        [{ text: "Done", onPress: () => router.back() }],
      );
    } catch (e: unknown) {
      buzzWarn();
      Alert.alert("Could not record payment", (e as Error).message || "Please try again.");
    }
  };

  const handleCharge = async () => {
    if (!order || isPaid) return;
    const m = selectedMethod;

    if (m.key === "pay_later") {
      try {
        await updateMut.mutateAsync({
          restaurantId, id,
          data: { status: "completed", notes: "Pay later — settle on the customer's tab" },
        });
        buzz();
        Alert.alert("Marked pay-later", "Order moved off the counter. Settle it from the customer profile when paid.", [
          { text: "Done", onPress: () => router.back() },
        ]);
      } catch (e) {
        Alert.alert("Could not mark pay-later", (e as Error).message);
      }
      return;
    }

    if (m.key === "split") {
      if (!canSplit) {
        Alert.alert("Permission needed", "Your role can't split bills.");
        return;
      }
      if (Math.abs(splitRemaining) > 0.01) {
        Alert.alert("Splits don't add up", `${splitRemaining > 0 ? "Short" : "Over"} by ${fmt(Math.abs(splitRemaining))}. Adjust the legs to total ${fmt(orderTotal)}.`);
        return;
      }
      const legs = splitLegs
        .filter((l) => Number(l.amount) > 0)
        .map((l) => ({
          paymentMethod: l.method,
          amount: Number(l.amount),
          ...(l.method === "cash" ? { amountTendered: Number(l.amount) } : {}),
        }));
      if (legs.length < 2) {
        Alert.alert("Need at least 2 legs", "A split requires two or more payment legs.");
        return;
      }
      try {
        await splitMut.mutateAsync({ restaurantId, id, data: { splits: legs } });
        buzz();
        await onAfterPayment();
        Alert.alert("Split recorded", `Order #${orderNumber} settled across ${legs.length} legs.`, [
          { text: "Done", onPress: () => router.back() },
        ]);
      } catch (e) {
        buzzWarn();
        Alert.alert("Could not split bill", (e as Error).message);
      }
      return;
    }

    if (m.key === "cash") {
      if (tenderedNum && shortfall > 0) {
        Alert.alert("Short tender", `Tendered amount is short by ${fmt(shortfall)}.`);
        return;
      }
      await submitSingleApi("cash", { amountTendered: tenderedNum || orderTotal });
      return;
    }

    if (m.key === "qr") {
      setShowQrSheet(true);
      return;
    }

    if (m.api) await submitSingleApi(m.api);
  };

  const handlePrintBill = async () => {
    if (!order) return;
    // Pull the real rendered bill from the server (honors the outlet's
    // active template, logo, tax breakdown, etc.) and route through the
    // OS print sheet — no more hand-rolled plain-text receipts.
    await printBill({
      restaurantId,
      orderId: order.id,
      orderNumber,
      accessToken,
      channel: "pos_thermal",
    });
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={t.colors.primary} />
      </View>
    );
  }
  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.background, alignItems: "center", justifyContent: "center", gap: 8 }}>
        <AppIcon name="alert-circle-outline" size={32} color="mutedForeground" />
        <AppText color="mutedForeground">Order not found</AppText>
        <AppButton label="Back" onPress={() => router.back()} variant="outline" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View
        style={{
          paddingTop: (Platform.OS === "web" ? 16 : insets.top) + 8,
          paddingHorizontal: 12,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderBottomWidth: 1,
          borderBottomColor: t.colors.border,
          backgroundColor: t.colors.background,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={{
            width: 40, height: 40, borderRadius: 12,
            alignItems: "center", justifyContent: "center",
            backgroundColor: t.colors.muted,
          }}
        >
          <AppIcon name="chevron-back" size={20} color="foreground" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="h3">Charge #{orderNumber}</AppText>
          <AppText variant="small" color="mutedForeground" numberOfLines={1}>
            {(order as { tableLabel?: string }).tableLabel
              ?? (order as { customerName?: string }).customerName
              ?? (order as { orderType?: string }).orderType
              ?? "Walk-in"}
          </AppText>
        </View>
        {isPaid ? <StatusChip label="Paid" tone="success" icon="checkmark-circle" /> : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <AppCard padding={16} shadow="sm" style={{ gap: 4 }}>
          <AppText variant="micro" color="mutedForeground">AMOUNT DUE</AppText>
          <AppText variant="hero" style={{ fontSize: 40, lineHeight: 46 }}>{fmt(orderTotal)}</AppText>
        </AppCard>

        {!isPaid ? (
          <AppCard padding={14} shadow="sm" style={{ gap: 10 }}>
            <AppText variant="h3">Payment method</AppText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {METHODS.map((m) => {
                const active = method === m.key;
                const disabled = (m.key === "split" && !canSplit);
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => setMethod(m.key)}
                    disabled={disabled}
                    style={({ pressed }) => ({
                      flexBasis: "31%",
                      flexGrow: 1,
                      minWidth: 96,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: active ? t.colors.primary : t.colors.border,
                      backgroundColor: active ? t.colors.primary + "15" : t.colors.card,
                      paddingVertical: 12,
                      paddingHorizontal: 10,
                      alignItems: "center",
                      gap: 6,
                      opacity: pressed ? 0.85 : disabled ? 0.45 : 1,
                    })}
                  >
                    <AppIcon name={m.icon} size={22} color={active ? "primary" : "foreground"} />
                    <AppText
                      variant="small"
                      weight="semibold"
                      align="center"
                      style={{ color: active ? t.colors.primary : t.colors.foreground }}
                    >
                      {m.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            {selectedMethod.note ? (
              <AppText variant="micro" color="mutedForeground">{selectedMethod.note}</AppText>
            ) : null}
          </AppCard>
        ) : null}

        {!isPaid && method === "cash" ? (
          <AppCard padding={14} shadow="sm" style={{ gap: 10 }}>
            <AppText variant="h3">Cash tendered</AppText>
            <AppInput
              value={tendered}
              onChangeText={(v) => setTendered(v.replace(/[^\d.]/g, ""))}
              keyboardType={Platform.OS === "web" ? "default" : "decimal-pad"}
              placeholder={`Exact: ${fmt(orderTotal)}`}
              leftIcon="cash-outline"
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Pressable
                onPress={() => setTendered(String(orderTotal))}
                style={({ pressed }) => ({
                  paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                  borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.muted,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <AppText variant="small" weight="semibold">Exact</AppText>
              </Pressable>
              {SUGGESTED_TENDERED.filter((v) => v >= orderTotal).slice(0, 4).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setTendered(String(v))}
                  style={({ pressed }) => ({
                    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                    borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.muted,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <AppText variant="small" weight="semibold">₹{v}</AppText>
                </Pressable>
              ))}
            </View>
            <View
              style={{
                flexDirection: "row", justifyContent: "space-between",
                paddingTop: 8, borderTopWidth: 1, borderTopColor: t.colors.border,
              }}
            >
              <AppText variant="bodyMd" color="mutedForeground">
                {shortfall > 0 ? "Short" : "Change to return"}
              </AppText>
              <AppText
                variant="h3"
                style={{ color: shortfall > 0 ? "#dc2626" : "#16a34a" }}
              >
                {shortfall > 0 ? fmt(shortfall) : fmt(change)}
              </AppText>
            </View>
          </AppCard>
        ) : null}

        {!isPaid && method === "split" ? (
          <AppCard padding={14} shadow="sm" style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <AppText variant="h3">Split into legs</AppText>
              <Pressable
                onPress={() =>
                  setSplitLegs((cur) =>
                    cur.concat({ id: String(Date.now()), method: "cash", amount: "" }),
                  )
                }
                hitSlop={8}
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <AppIcon name="add-circle-outline" size={18} color="primary" />
                <AppText variant="small" color="primary" weight="semibold">Add leg</AppText>
              </Pressable>
            </View>
            {splitLegs.map((leg, idx) => (
              <View key={leg.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <AppText variant="small" weight="semibold">Leg {idx + 1}</AppText>
                  {splitLegs.length > 2 ? (
                    <Pressable
                      onPress={() => setSplitLegs((cur) => cur.filter((l) => l.id !== leg.id))}
                      hitSlop={8}
                    >
                      <AppIcon name="trash-outline" size={16} color="mutedForeground" />
                    </Pressable>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {(["cash", "card", "upi"] as SplitLeg[]).map((m) => {
                    const active = leg.method === m;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => setSplitLegs((cur) => cur.map((l) => l.id === leg.id ? { ...l, method: m } : l))}
                        style={({ pressed }) => ({
                          flex: 1,
                          paddingVertical: 8,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: active ? t.colors.primary : t.colors.border,
                          backgroundColor: active ? t.colors.primary + "15" : t.colors.card,
                          alignItems: "center",
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <AppText
                          variant="small"
                          weight="semibold"
                          style={{ color: active ? t.colors.primary : t.colors.foreground }}
                        >
                          {m.toUpperCase()}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
                <AppInput
                  value={leg.amount}
                  onChangeText={(v) => setSplitLegs((cur) => cur.map((l) => l.id === leg.id ? { ...l, amount: v.replace(/[^\d.]/g, "") } : l))}
                  keyboardType={Platform.OS === "web" ? "default" : "decimal-pad"}
                  placeholder="Amount (₹)"
                  containerStyle={{ marginBottom: 0 }}
                />
              </View>
            ))}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Pressable
                onPress={() => {
                  const each = +(orderTotal / splitLegs.length).toFixed(2);
                  setSplitLegs((cur) => cur.map((l, i) =>
                    i === cur.length - 1
                      ? { ...l, amount: String(+(orderTotal - each * (cur.length - 1)).toFixed(2)) }
                      : { ...l, amount: String(each) },
                  ));
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                  borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.muted,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <AppText variant="small" weight="semibold">Split evenly</AppText>
              </Pressable>
            </View>
            <View
              style={{
                flexDirection: "row", justifyContent: "space-between",
                paddingTop: 8, borderTopWidth: 1, borderTopColor: t.colors.border,
              }}
            >
              <AppText variant="bodyMd" color="mutedForeground">Remaining</AppText>
              <AppText
                variant="h3"
                style={{
                  color: Math.abs(splitRemaining) < 0.01
                    ? "#16a34a"
                    : splitRemaining > 0 ? "#dc2626" : "#ca8a04",
                }}
              >
                {fmt(splitRemaining)}
              </AppText>
            </View>
          </AppCard>
        ) : null}

        <AppCard padding={14} shadow="xs" style={{ gap: 6 }}>
          <AppText variant="h3">Bill</AppText>
          {((order.items ?? []) as Array<{ id: number; menuItemName: string; quantity: number; totalPrice?: string; unitPrice?: string }>).map((it) => (
            <View key={it.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                {it.menuItemName} ×{it.quantity}
              </AppText>
              <AppText variant="body">{fmt(it.totalPrice ?? it.unitPrice)}</AppText>
            </View>
          ))}
          <View
            style={{
              flexDirection: "row", justifyContent: "space-between",
              borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: 8, marginTop: 4,
            }}
          >
            <AppText variant="h3">Total</AppText>
            <AppText variant="h3" color="primary">{fmt(orderTotal)}</AppText>
          </View>
        </AppCard>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <AppButton
            label="Print bill"
            variant="outline"
            leftIcon="print-outline"
            onPress={handlePrintBill}
            style={{ flex: 1 }}
          />
          {!isPaid ? (
            <AppButton
              label={method === "pay_later" ? "Mark pay-later" : "Charge"}
              variant="primary"
              leftIcon="checkmark-circle-outline"
              loading={payMut.isPending || splitMut.isPending || updateMut.isPending}
              onPress={handleCharge}
              style={{ flex: 2 }}
            />
          ) : (
            <AppButton
              label="Back to bills"
              variant="primary"
              leftIcon="arrow-back-outline"
              onPress={() => router.back()}
              style={{ flex: 2 }}
            />
          )}
        </View>
      </ScrollView>

      <AppBottomSheet
        visible={showQrSheet}
        onClose={() => setShowQrSheet(false)}
        title="Dynamic QR"
      >
        <AppText variant="small" color="mutedForeground">
          Show this prompt to the customer. Once their app confirms the transfer of {fmt(orderTotal)},
          tap "Mark received" — the payment will be recorded as UPI.
        </AppText>
        <View
          style={{
            alignSelf: "center",
            width: 220, height: 220, borderRadius: 16,
            borderWidth: 2, borderColor: t.colors.border,
            alignItems: "center", justifyContent: "center",
            backgroundColor: t.colors.muted, gap: 8,
          }}
        >
          <AppIcon name="qr-code" size={120} color="foreground" />
          <AppText variant="small" color="mutedForeground">
            QR rendered by terminal
          </AppText>
        </View>
        <AppText variant="h3" align="center">{fmt(orderTotal)}</AppText>
        <AppButton
          label="Mark received"
          leftIcon="checkmark-circle-outline"
          loading={payMut.isPending}
          onPress={async () => {
            setShowQrSheet(false);
            await submitSingleApi("upi");
          }}
        />
      </AppBottomSheet>
    </View>
  );
}
