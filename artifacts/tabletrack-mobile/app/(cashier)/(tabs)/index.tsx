import React, { useMemo, useState } from "react";
import { View, Pressable, ScrollView, Platform } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  listOrders,
  getListOrdersQueryKey,
  type OrderList,
} from "@workspace/api-client-react";
import { useTheme } from "@/theme";
import { AppText, AppButton, AppIcon, AppCard, StatusChip } from "@/components/ui";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { OfflineBanner } from "@/components/OfflineBanner";
import { DeviceStatusStrip } from "@/components/cashier/DeviceStatusStrip";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import {
  cashierFetch,
  type CashRegisterSession,
  type CashRegisterTotals,
} from "@/lib/cashierApi";

const KEYS: Array<{ k: string; label: string; kind?: "num" | "op" }> = [
  { k: "7", label: "7", kind: "num" },
  { k: "8", label: "8", kind: "num" },
  { k: "9", label: "9", kind: "num" },
  { k: "4", label: "4", kind: "num" },
  { k: "5", label: "5", kind: "num" },
  { k: "6", label: "6", kind: "num" },
  { k: "1", label: "1", kind: "num" },
  { k: "2", label: "2", kind: "num" },
  { k: "3", label: "3", kind: "num" },
  { k: "00", label: "00", kind: "num" },
  { k: "0", label: "0", kind: "num" },
  { k: ".", label: ".", kind: "num" },
];

function tap() {
  if (Platform.OS !== "web") Haptics.selectionAsync();
}

type OpenOrder = {
  id: number;
  orderType?: string | null;
  status: string;
  paymentStatus?: string | null;
  totalAmount: string | number;
  source?: string | null;
};

type HeldOrder = {
  orderId: number;
  orderNumber: string;
  totalAmount: string | number;
};

type SalesSummary = {
  orderCount: number;
  gross: string;
  net: string;
};

export default function CashierPosScreen() {
  const t = useTheme();
  const { restaurantId, outletScopeId, accessToken } = useAuth();
  const { startOrder } = useCart();
  const scopedId = outletScopeId ?? restaurantId;
  const [display, setDisplay] = useState("0");
  const [lines, setLines] = useState<Array<{ id: string; amount: number; qty: number }>>([]);

  // ─── Operational summary queries (all real data, refreshed live) ───
  const { data: openOrdersData } = useQuery({
    queryKey: getListOrdersQueryKey(scopedId, {
      status: "pending,confirmed,preparing,ready,served,delivered,bill_requested",
    }),
    queryFn: () =>
      listOrders(scopedId, {
        status: "pending,confirmed,preparing,ready,served,delivered,bill_requested",
      }),
    refetchInterval: 20_000,
    enabled: !!scopedId && !!accessToken,
  });

  const heldQ = useQuery<HeldOrder[]>({
    queryKey: ["cashier-held", restaurantId],
    queryFn: () =>
      cashierFetch<HeldOrder[]>(
        accessToken,
        `/restaurants/${restaurantId}/guest-verifications`,
      ),
    refetchInterval: 20_000,
    enabled: !!accessToken && !!restaurantId,
  });

  const shiftQ = useQuery<{ session: CashRegisterSession | null; totals: CashRegisterTotals | null }>({
    queryKey: ["cash-register-current", restaurantId],
    queryFn: () =>
      cashierFetch<{ session: CashRegisterSession | null; totals: CashRegisterTotals | null }>(
        accessToken,
        `/restaurants/${restaurantId}/cash-register/current`,
      ),
    refetchInterval: 30_000,
    enabled: !!accessToken && !!restaurantId,
  });

  const salesQ = useQuery<SalesSummary>({
    queryKey: ["cashier-sales-summary", restaurantId, shiftQ.data?.session?.id ?? null],
    queryFn: () => {
      const sid = shiftQ.data?.session?.id;
      const qs = sid ? `?sessionId=${sid}` : "";
      return cashierFetch<SalesSummary>(
        accessToken,
        `/restaurants/${restaurantId}/pos/sales-summary${qs}`,
      );
    },
    refetchInterval: 30_000,
    enabled: !!accessToken && !!restaurantId,
  });

  const openOrders = (openOrdersData as OrderList | undefined) ?? [];
  const openList = (openOrders as unknown as OpenOrder[]) ?? [];
  const activeBills = openList.filter((o) => o.status !== "cancelled").length;
  const pendingPayments = openList.filter((o) => o.paymentStatus !== "paid").length;
  const heldCount = (heldQ.data ?? []).length;
  const todaysGross = Number(salesQ.data?.gross ?? 0);
  const todaysCount = Number(salesQ.data?.orderCount ?? 0);
  const shift = shiftQ.data?.session ?? null;
  const shiftOpen = shift?.status === "open";

  const pressKey = (key: string) => {
    tap();
    setDisplay((cur) => {
      if (key === ".") {
        if (cur.includes(".")) return cur;
        return cur === "0" ? "0." : cur + ".";
      }
      if (cur === "0") return key === "00" ? "0" : key;
      const parts = cur.split(".");
      if (parts[1] && parts[1].length >= 2) return cur;
      return cur + key;
    });
  };
  const backspace = () => {
    tap();
    setDisplay((cur) => (cur.length <= 1 ? "0" : cur.slice(0, -1)));
  };
  const clearAll = () => {
    tap();
    setDisplay("0");
    setLines([]);
  };
  const addLine = () => {
    const amount = Number(display);
    if (!isFinite(amount) || amount <= 0) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLines((cur) => {
      const last = cur[cur.length - 1];
      if (last && Math.abs(last.amount - amount) < 0.001) {
        return cur.slice(0, -1).concat({ ...last, qty: last.qty + 1 });
      }
      return cur.concat({ id: `${Date.now()}_${cur.length}`, amount, qty: 1 });
    });
    setDisplay("0");
  };
  const removeLine = (id: string) => {
    setLines((cur) => cur.filter((l) => l.id !== id));
  };

  const total = useMemo(
    () => lines.reduce((s, l) => s + l.amount * l.qty, 0),
    [lines],
  );

  /**
   * Start a counter-bound order: walk-in / takeaway from the counter. We
   * reset the cart and seed it with the "takeaway" order type so the rest
   * of the new-order flow (customer → menu → cart → pay) is bound to a
   * counter sale rather than a dine-in table.
   */
  const startCounterOrder = () => {
    startOrder("takeaway");
    router.push("/new-order/customer" as never);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <RoleShellHeader title="Counter POS" subtitle="Calculator mode" />
      <DeviceStatusStrip onPress={() => router.push("/settings" as never)} />
      <OfflineBanner />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, paddingBottom: 24, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ─── Operational summary ─── */}
        <AppCard padding={12} shadow="sm" style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText variant="h3">Counter overview</AppText>
            <StatusChip
              label={shiftOpen ? "Shift open" : "Shift closed"}
              tone={shiftOpen ? "success" : "warning"}
              size="xs"
              icon={shiftOpen ? "checkmark-circle" : "lock-closed-outline"}
            />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <SummaryTile
              label="Active bills"
              value={String(activeBills)}
              icon="receipt-outline"
              onPress={() => router.push("/(cashier)/(tabs)/bills" as never)}
            />
            <SummaryTile
              label="Pending payments"
              value={String(pendingPayments)}
              icon="card-outline"
              onPress={() => router.push("/(cashier)/(tabs)/payments" as never)}
            />
            <SummaryTile
              label="Held bills"
              value={String(heldCount)}
              icon="hourglass-outline"
              tone={heldCount > 0 ? "warning" : "neutral"}
              onPress={() => router.push("/(cashier)/(tabs)/bills?filter=held" as never)}
            />
            <SummaryTile
              label={shiftOpen ? "Sales this shift" : "Sales today"}
              value={`₹${todaysGross.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
              sub={`${todaysCount} order${todaysCount === 1 ? "" : "s"}`}
              icon="trending-up-outline"
              onPress={() => router.push("/(cashier)/(tabs)/shift" as never)}
            />
          </View>
        </AppCard>

        {/* ─── Quick actions ─── */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <AppButton
            label="New counter order"
            variant="primary"
            size="md"
            leftIcon="restaurant-outline"
            onPress={startCounterOrder}
            style={{ flex: 1 }}
          />
          <AppButton
            label={pendingPayments > 0 ? `Charge (${pendingPayments})` : "Open bills"}
            variant="outline"
            size="md"
            leftIcon="card-outline"
            onPress={() => router.push("/(cashier)/(tabs)/payments" as never)}
            style={{ flex: 1 }}
          />
        </View>

        {/* ─── Calculator ─── */}
        <AppCard padding={14} shadow="sm" style={{ gap: 10 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <View style={{ flex: 1 }}>
              <AppText variant="micro" color="mutedForeground">AMOUNT</AppText>
              <AppText
                variant="hero"
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ fontSize: 42, lineHeight: 48 }}
              >
                ₹{Number(display).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </AppText>
            </View>
            <Pressable
              onPress={backspace}
              hitSlop={10}
              style={{
                width: 44, height: 44, borderRadius: 12,
                alignItems: "center", justifyContent: "center",
                backgroundColor: t.colors.muted, borderWidth: 1, borderColor: t.colors.border,
              }}
            >
              <AppIcon name="backspace-outline" size={20} color="foreground" />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {KEYS.map((k) => (
              <Pressable
                key={k.k}
                onPress={() => pressKey(k.k)}
                style={({ pressed }) => ({
                  flexBasis: "31%",
                  flexGrow: 1,
                  height: 56,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: t.colors.card,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <AppText variant="h2">{k.label}</AppText>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <AppButton
              label="Clear"
              variant="outline"
              size="md"
              leftIcon="trash-outline"
              onPress={clearAll}
              style={{ flex: 1 }}
            />
            <AppButton
              label="Add line"
              variant="primary"
              size="md"
              leftIcon="add-circle-outline"
              onPress={addLine}
              disabled={Number(display) <= 0}
              style={{ flex: 2 }}
            />
          </View>
        </AppCard>

        <AppCard padding={14} shadow="sm" style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText variant="h3">Bill draft</AppText>
            <AppText variant="small" color="mutedForeground">
              {lines.length} line{lines.length === 1 ? "" : "s"}
            </AppText>
          </View>
          {lines.length === 0 ? (
            <AppText variant="small" color="mutedForeground">
              Punch amounts on the pad and tap "Add line" to build a quick counter bill,
              or "New counter order" to take a proper menu-routed ticket.
            </AppText>
          ) : (
            lines.map((l) => (
              <View
                key={l.id}
                style={{
                  flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingVertical: 6,
                  borderBottomWidth: 1, borderBottomColor: t.colors.border,
                }}
              >
                <AppText variant="body">
                  ₹{l.amount.toLocaleString("en-IN")} × {l.qty}
                </AppText>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <AppText variant="bodyMd" weight="semibold">
                    ₹{(l.amount * l.qty).toLocaleString("en-IN")}
                  </AppText>
                  <Pressable onPress={() => removeLine(l.id)} hitSlop={10}>
                    <AppIcon name="close-circle" size={18} color="mutedForeground" />
                  </Pressable>
                </View>
              </View>
            ))
          )}
          <View
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.colors.border,
            }}
          >
            <AppText variant="h3">Total</AppText>
            <AppText variant="h2" color="primary">₹{total.toLocaleString("en-IN")}</AppText>
          </View>
        </AppCard>

        <AppText variant="micro" color="mutedForeground" align="center" style={{ marginTop: 4 }}>
          Counter calculator is a quick reference for walk-ins. For a proper KOT-routed
          ticket, tap "New counter order" — it creates a real takeaway order tied to
          inventory and KOTs.
        </AppText>
      </ScrollView>
    </View>
  );
}

interface SummaryTileProps {
  label: string;
  value: string;
  sub?: string;
  icon: "receipt-outline" | "card-outline" | "hourglass-outline" | "trending-up-outline";
  tone?: "primary" | "warning" | "neutral";
  onPress?: () => void;
}

function SummaryTile({ label, value, sub, icon, tone = "neutral", onPress }: SummaryTileProps) {
  const t = useTheme();
  const accent =
    tone === "warning" ? "#ca8a04" :
    tone === "primary" ? t.colors.primary :
    t.colors.mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexBasis: "48%",
        flexGrow: 1,
        backgroundColor: t.colors.card,
        borderWidth: 1,
        borderColor: t.colors.border,
        borderRadius: 12,
        padding: 10,
        gap: 4,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <AppIcon name={icon} size={14} color={accent} />
        <AppText variant="micro" color="mutedForeground" numberOfLines={1}>
          {label.toUpperCase()}
        </AppText>
      </View>
      <AppText variant="title" weight="bold" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      {sub ? (
        <AppText variant="micro" color="mutedForeground" numberOfLines={1}>
          {sub}
        </AppText>
      ) : null}
    </Pressable>
  );
}
