import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ScrollView, RefreshControl,
  Platform, Vibration, TextInput, Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateKitchenTicketStatus, customFetch } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { useChefColors } from "@/hooks/useChefColors";
import { useAuth } from "@/context/AuthContext";
import {
  useKdsTickets, useKitchensList, useKdsBuckets,
  type KdsTicket,
} from "@/hooks/useKdsTickets";
import { useKdsRealtime, type ConnectionState } from "@/hooks/useKdsRealtime";
import { useKdsSettings } from "@/hooks/useKdsSettings";
import { useKdsSounds, type AlertSoundKey } from "@/hooks/useKdsSounds";
import { ChefKotCard, CHEF_ITEM_CYCLE, type ChefItemStatus } from "./ChefKotCard";

type ChefTabKey = "new" | "preparing" | "ready" | "delayed" | "completed";
const TABS: ReadonlyArray<{
  key: ChefTabKey;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
}> = [
  { key: "new",       label: "New",       icon: "alert-circle",     color: "#60a5fa" },
  { key: "preparing", label: "Preparing", icon: "flame",            color: "#f59e0b" },
  { key: "ready",     label: "Ready",     icon: "checkmark-circle", color: "#34d399" },
  { key: "delayed",   label: "Delayed",   icon: "warning",          color: "#f87171" },
  { key: "completed", label: "Completed", icon: "time",             color: "#9ca3af" },
];

const CLIENT_TO_SERVER_STATUS: Record<ChefItemStatus, "pending" | "preparing" | "ready" | "out_of_stock"> = {
  pending: "pending",
  preparing: "preparing",
  ready: "ready",
  oos: "out_of_stock",
};
const SERVER_TO_CLIENT_STATUS: Record<string, ChefItemStatus> = {
  pending: "pending",
  preparing: "preparing",
  ready: "ready",
  out_of_stock: "oos",
};

const EMPTY_CHECKS: Record<number, ChefItemStatus> = {};
const keyExtractor = (t: KdsTicket) => String(t.id);

const REPRINT_ROLES = new Set(["owner", "manager", "super_admin", "chef"]);

export interface ChefBoardProps {
  /** Initial sub-tab. The chef can still switch between any of the 5 tabs. */
  initialTab?: ChefTabKey;
  /** Page title shown in the dark header. */
  title?: string;
}

/**
 * Dark "kitchen mode" KOT board for the chef/kitchen role. Surfaces tabs
 * for New / Preparing / Ready / Delayed / Completed plus a station-chip
 * filter row above the list. Pulls live data via the same hooks the
 * owner KDS uses but renders the chef-specific dark card.
 */
export function ChefBoard({ initialTab = "new", title = "KOT Board" }: ChefBoardProps) {
  const colors = useChefColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const qc = useQueryClient();
  const { restaurantId, user } = useAuth();
  const { settings, loaded: settingsLoaded } = useKdsSettings();

  const [tab, setTab] = useState<ChefTabKey>(initialTab);
  const [stationId, setStationId] = useState<number | "all">(settings.defaultStationId);
  const [itemOverrides, setItemOverrides] = useState<Record<number, ChefItemStatus>>({});
  const [pendingTicketIds, setPendingTicketIds] = useState<Record<number, true>>({});
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; message: string } | null>(null);
  const [delayTarget, setDelayTarget] = useState<KdsTicket | null>(null);
  const stationDefaultedRef = useRef(false);

  // Default station: chef's assigned kitchen if they have one; else the
  // device default. Runs once when settings + auth are ready, so manual
  // chip taps below still win for the rest of the session.
  useEffect(() => {
    if (!settingsLoaded || stationDefaultedRef.current) return;
    const role = user?.role ?? "";
    const assignedKitchen = user?.kitchenId ?? null;
    if ((role === "chef" || role === "kitchen") && assignedKitchen != null) {
      setStationId(assignedKitchen);
    } else {
      setStationId(settings.defaultStationId);
    }
    stationDefaultedRef.current = true;
  }, [settingsLoaded, user?.role, user?.kitchenId, settings.defaultStationId]);

  const kitchensQ = useKitchensList(restaurantId);
  const ticketsQ = useKdsTickets(restaurantId, { pollMs: 15_000 });
  const tickets = (ticketsQ.data ?? []) as KdsTicket[];
  const sounds = useKdsSounds(settings.sound);

  const triggerAlert = useCallback((kind: "new" | "delayed") => {
    if (settings.sound) sounds.play(settings.alertSound as AlertSoundKey);
    if (settings.vibration) {
      if (kind === "delayed") Vibration.vibrate([0, 200, 100, 200]);
      else Vibration.vibrate(150);
      Haptics.notificationAsync(
        kind === "delayed" ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
    }
  }, [settings.sound, settings.vibration, settings.alertSound, sounds]);

  const connection: ConnectionState = useKdsRealtime(restaurantId, ticketsQ.queryKey, {
    onNewOrder: (payload) => {
      if (stationId !== "all" && payload?.kitchenId != null && Number(payload.kitchenId) !== stationId) return;
      triggerAlert("new");
    },
    onTicketDelayed: (payload) => {
      if (stationId !== "all" && payload?.kitchenId != null && Number(payload.kitchenId) !== stationId) return;
      triggerAlert("delayed");
    },
  });

  // For Delayed / Completed we still want the underlying tab bucket from
  // the shared hook; we override `tab` below.
  const buckets = useKdsBuckets(
    tickets,
    tab === "delayed" ? "preparing"
      : tab === "completed" ? "history"
      : (tab as "new" | "preparing" | "ready"),
    "all",
    stationId,
    settings.delayedThresholdMin,
  );

  const filteredForTab = useMemo(() => {
    if (tab === "delayed") {
      // Show every in-flight ticket flagged as delayed (regardless of
      // its New/Preparing/Ready bucket) for this station.
      const list: KdsTicket[] = [];
      const seen = new Set<number>();
      const merge = (arr: KdsTicket[]) => {
        for (const t of arr) {
          if (!t.isDelayed || seen.has(t.id)) continue;
          seen.add(t.id);
          list.push(t);
        }
      };
      merge(buckets.byTab.new);
      merge(buckets.byTab.preparing);
      merge(buckets.byTab.ready);
      return list;
    }
    return buckets.filtered;
  }, [tab, buckets]);

  const counts = useMemo(() => {
    const delayed = [
      ...buckets.byTab.new, ...buckets.byTab.preparing, ...buckets.byTab.ready,
    ].filter((t) => t.isDelayed).length;
    return {
      new: buckets.counts.new,
      preparing: buckets.counts.preparing,
      ready: buckets.counts.ready,
      delayed,
      completed: buckets.counts.history,
    } satisfies Record<ChefTabKey, number>;
  }, [buckets]);

  // New-order chime: seen-ticket guard so the first poll on mount doesn't
  // play the chime for every existing ticket.
  const seenTicketIds = useRef<Set<number>>(new Set());
  const seenDelayedIds = useRef<Set<number>>(new Set());
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!initialLoadDone.current && !ticketsQ.isLoading) {
      tickets.forEach((t) => seenTicketIds.current.add(t.id));
      initialLoadDone.current = true;
      return;
    }
    for (const t of tickets) {
      if (!seenTicketIds.current.has(t.id)) {
        seenTicketIds.current.add(t.id);
        if (connection !== "live" && (stationId === "all" || t.kitchenId === stationId)) triggerAlert("new");
      }
    }
  }, [tickets, ticketsQ.isLoading, connection, stationId, triggerAlert]);

  useEffect(() => {
    if (!initialLoadDone.current) return;
    for (const t of tickets) {
      if (t.isDelayed && !seenDelayedIds.current.has(t.id)) {
        seenDelayedIds.current.add(t.id);
        if (stationId === "all" || t.kitchenId === stationId) triggerAlert("delayed");
      }
    }
  }, [tickets, stationId, triggerAlert]);

  const updateStatus = useUpdateKitchenTicketStatus();

  const computeItemStatus = useCallback((item: { id: number; status?: string | null }): ChefItemStatus => {
    const override = itemOverrides[item.id];
    if (override) return override;
    return SERVER_TO_CLIENT_STATUS[String(item.status ?? "pending")] ?? "pending";
  }, [itemOverrides]);

  const showToast = useCallback((kind: "success" | "error" | "info", message: string) => {
    setToast({ kind, message });
    setTimeout(() => setToast((t) => (t && t.message === message ? null : t)), 2500);
  }, []);

  const cycleItem = useCallback(async (ticket: KdsTicket, itemId: number) => {
    const item = (ticket.items ?? []).find((i) => i.id === itemId);
    if (!item) return;
    const current = computeItemStatus(item);
    const next = CHEF_ITEM_CYCLE[current];
    setItemOverrides((m) => ({ ...m, [itemId]: next }));
    Haptics.selectionAsync().catch(() => {});
    try {
      await customFetch(`/api/restaurants/${restaurantId}/orders/${ticket.orderId}/items/${itemId}/kitchen-status`, {
        method: "PATCH",
        body: JSON.stringify({ status: CLIENT_TO_SERVER_STATUS[next] }),
        headers: { "content-type": "application/json" },
      });
      // Bug fix (Task #672): item-level status change must also invalidate
      // the orders list so waiters' Orders screen reflects which items the
      // kitchen has started / finished. Without this, the orders detail
      // drawer stayed stale until the next poll.
      qc.invalidateQueries({ queryKey: ticketsQ.queryKey });
      qc.invalidateQueries({ queryKey: ["orders", restaurantId] });
    } catch (err) {
      setItemOverrides((m) => ({ ...m, [itemId]: current }));
      showToast("error", (err as Error).message || "Couldn't update item");
    }
  }, [computeItemStatus, restaurantId, qc, ticketsQ.queryKey, showToast]);

  // Drop overrides once the server reports the same status.
  useEffect(() => {
    if (ticketsQ.isFetching) return;
    setItemOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next: Record<number, ChefItemStatus> = {};
      const itemMap = new Map<number, string>();
      for (const t of tickets) for (const i of t.items ?? []) itemMap.set(i.id, String(i.status ?? "pending"));
      for (const [k, v] of Object.entries(prev)) {
        const serverStatus = itemMap.get(Number(k));
        if (!serverStatus) { next[Number(k)] = v; continue; }
        if (SERVER_TO_CLIENT_STATUS[serverStatus] !== v) next[Number(k)] = v;
      }
      return next;
    });
  }, [ticketsQ.isFetching, tickets]);

  const advanceTo = useCallback(async (ticket: KdsTicket, nextStatus: "preparing" | "ready" | "served") => {
    if (pendingTicketIds[ticket.id]) return;
    const queryKey = ticketsQ.queryKey;
    const previous = qc.getQueryData<KdsTicket[]>(queryKey);
    qc.setQueryData<KdsTicket[]>(queryKey, (old) =>
      Array.isArray(old) ? old.map((t) => (t.id === ticket.id ? { ...t, status: nextStatus } : t)) : old,
    );
    setPendingTicketIds((m) => ({ ...m, [ticket.id]: true }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await updateStatus.mutateAsync({ restaurantId, id: ticket.id, data: { status: nextStatus } });
      qc.invalidateQueries({ queryKey });
      const label = `KOT #${ticket.orderNumber ?? ticket.id}`;
      showToast(
        "success",
        nextStatus === "preparing" ? `${label} accepted` :
          nextStatus === "ready" ? `${label} ready to serve` :
            `${label} served`,
      );
      // Auto-jump so the chef visually follows the ticket into the next bucket.
      if (nextStatus === "preparing" && tab !== "preparing") setTab("preparing");
      else if (nextStatus === "ready" && tab !== "ready") setTab("ready");
    } catch (err) {
      if (previous) qc.setQueryData(queryKey, previous);
      showToast("error", (err as Error).message || "Couldn't update ticket");
    } finally {
      setPendingTicketIds((m) => {
        const { [ticket.id]: _, ...rest } = m;
        return rest;
      });
    }
  }, [pendingTicketIds, qc, ticketsQ.queryKey, updateStatus, restaurantId, tab, showToast]);

  const onAccept = useCallback((t: KdsTicket) => advanceTo(t, "preparing"), [advanceTo]);
  const onStartCooking = useCallback((t: KdsTicket) => advanceTo(t, "preparing"), [advanceTo]);
  const onMarkReady = useCallback((t: KdsTicket) => {
    const status = String(t.status);
    if (status === "ready") return void advanceTo(t, "served");
    return void advanceTo(t, "ready");
  }, [advanceTo]);

  const submitDelayReason = useCallback(async (reason: string) => {
    const target = delayTarget;
    if (!target) return;
    setDelayTarget(null);
    try {
      await customFetch(`/api/restaurants/${restaurantId}/kitchen/tickets/${target.id}/delay-reason`, {
        method: "POST",
        body: JSON.stringify({ reason }),
        headers: { "content-type": "application/json" },
      });
      showToast("info", `Delay reason logged for KOT #${target.orderNumber ?? target.id}`);
    } catch (err) {
      showToast("error", (err as Error).message || "Couldn't log delay reason");
    }
  }, [delayTarget, restaurantId, showToast]);

  // Permission-gated reprint via the existing print-jobs API. Mirrors the
  // owner KDS path so the same printer routing logic applies.
  const canReprint = REPRINT_ROLES.has(user?.role ?? "") || !!user?.isSuperAdmin;
  const reprintKot = useCallback(async (ticket: KdsTicket) => {
    const station = ticket.kitchen?.name ?? "this station";
    try {
      const items = (ticket.items ?? []).map((it) => ({
        name: (it as { menuItemName?: string }).menuItemName ?? "Item",
        qty: it.quantity ?? 1,
        modifiers: (it.modifiers ?? []).map((m) => `${m.quantity > 1 ? `${m.quantity}x ` : ""}${m.name}`),
        notes: it.notes ?? undefined,
      }));
      const payload = {
        type: "kot",
        payload: {
          paperSize: ticket.kitchen?.paperSize ?? "80mm",
          kotNumber: String(ticket.id),
          orderNumber: ticket.orderNumber ? String(ticket.orderNumber) : undefined,
          tableLabel: ticket.tableNumber ?? undefined,
          customerName: ticket.customerName ?? undefined,
          orderType: ticket.orderType ?? undefined,
          stationName: ticket.kitchen?.name,
          marker: "reprint",
          items,
          printedAt: new Date().toISOString(),
        },
      };
      const resp = await customFetch<{ id: number; status: string; error?: string }>(
        `/api/restaurants/${restaurantId}/print-jobs`,
        {
          method: "POST",
          body: JSON.stringify({
            printType: "reprint_kot",
            role: "kot",
            kitchenId: ticket.kitchenId ?? null,
            orderId: ticket.orderId ?? null,
            kotNumber: String(ticket.id),
            payload,
            dedupeKey: `reprint-kot-${ticket.id}-${Date.now()}`,
          }),
        },
      );
      if (resp.status === "failed") {
        showToast("error", resp.error || `No KOT printer for ${station}`);
      } else {
        showToast("success", `KOT reprint queued for ${station}`);
        Haptics.selectionAsync().catch(() => {});
      }
    } catch (err) {
      showToast("error", (err as Error).message || "Couldn't queue reprint");
    }
  }, [restaurantId, showToast]);

  // Pre-compute checks map per ticket to keep card memo comparator happy.
  const checksByTicket = useMemo(() => {
    const map = new Map<number, Record<number, ChefItemStatus>>();
    for (const t of filteredForTab) {
      const checks: Record<number, ChefItemStatus> = {};
      for (const i of t.items ?? []) checks[i.id] = computeItemStatus(i);
      map.set(t.id, checks);
    }
    return map;
  }, [filteredForTab, computeItemStatus]);

  const renderItem = useCallback(({ item }: { item: KdsTicket }) => {
    const checks = checksByTicket.get(item.id) ?? EMPTY_CHECKS;
    const waiterName =
      (item as { waiterName?: string | null }).waiterName ??
      (item as { createdByName?: string | null }).createdByName ??
      null;
    return (
      <ChefKotCard
        ticket={item}
        itemChecks={checks}
        onCycleItem={(id) => cycleItem(item, id)}
        onAccept={onAccept}
        onStartCooking={onStartCooking}
        onMarkReady={onMarkReady}
        onDelayReason={(t) => setDelayTarget(t)}
        onReprint={reprintKot}
        canReprint={canReprint}
        waiterName={waiterName}
        isPending={!!pendingTicketIds[item.id]}
      />
    );
  }, [checksByTicket, cycleItem, onAccept, onStartCooking, onMarkReady, reprintKot, canReprint, pendingTicketIds]);

  const activeStations = (kitchensQ.data ?? []).filter((k) => k.isActive !== false);
  const headerTop = isWeb ? 16 : insets.top + 4;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: headerTop, borderBottomColor: colors.border }]}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {stationId === "all" ? "All stations" : activeStations.find((k) => k.id === stationId)?.name ?? "Station"}
              {" · "}{filteredForTab.length} {filteredForTab.length === 1 ? "ticket" : "tickets"}
            </Text>
          </View>
          <ConnectionDot state={connection} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {TABS.map((t) => {
            const key = t.key as ChefTabKey;
            const active = tab === key;
            const count = counts[key];
            return (
              <Pressable
                key={t.key}
                onPress={() => { Haptics.selectionAsync().catch(() => {}); setTab(t.key); }}
                style={({ pressed }) => [
                  styles.tabChip,
                  {
                    backgroundColor: active ? t.color : colors.surfaceAlt,
                    borderColor: active ? t.color : colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Ionicons name={t.icon} size={16} color={active ? "#0a0908" : t.color} />
                <Text style={[styles.tabChipText, { color: active ? "#0a0908" : colors.foreground }]}>
                  {t.label}
                </Text>
                {count > 0 ? (
                  <View style={[styles.tabBadge, { backgroundColor: active ? "#0a0908" : t.color }]}>
                    <Text style={[styles.tabBadgeText, { color: active ? t.color : "#0a0908" }]}>
                      {count > 99 ? "99+" : count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stationRow}>
          <StationChip label="All Stations" active={stationId === "all"} onPress={() => setStationId("all")} />
          {activeStations.map((k) => (
            <StationChip
              key={k.id}
              label={k.name}
              active={stationId === k.id}
              onPress={() => setStationId(k.id)}
            />
          ))}
        </ScrollView>
      </View>

      {ticketsQ.isLoading ? (
        <View style={styles.centerWrap}>
          <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>Loading tickets…</Text>
        </View>
      ) : ticketsQ.isError ? (
        <View style={styles.centerWrap}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load tickets</Text>
          <Pressable
            onPress={() => ticketsQ.refetch()}
            style={({ pressed }) => [styles.retryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={[styles.retryBtnText, { color: colors.primaryForeground }]}>Retry sync</Text>
          </Pressable>
        </View>
      ) : filteredForTab.length === 0 ? (
        <View style={styles.centerWrap}>
          <Ionicons
            name={
              tab === "new" ? "checkmark-done-circle"
                : tab === "preparing" ? "flame"
                : tab === "ready" ? "restaurant"
                : tab === "delayed" ? "thumbs-up"
                : "time"
            }
            size={56}
            color={colors.mutedForeground}
          />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {tab === "new" ? "No new KOTs"
              : tab === "preparing" ? "Nothing on the line"
              : tab === "ready" ? "Nothing waiting"
              : tab === "delayed" ? "No delayed tickets"
              : "No completed tickets"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredForTab}
          keyExtractor={keyExtractor}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={ticketsQ.isRefetching}
              onRefresh={ticketsQ.refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews={Platform.OS === "android"}
        />
      )}

      {toast ? (
        <View
          style={[
            styles.toast,
            {
              bottom: insets.bottom + 92,
              backgroundColor:
                toast.kind === "error" ? "#7f1d1d"
                : toast.kind === "info" ? "#1e3a8a"
                : "#065f46",
            },
          ]}
        >
          <Ionicons
            name={toast.kind === "error" ? "alert-circle" : toast.kind === "info" ? "information-circle" : "checkmark-circle"}
            size={18}
            color="#fff"
          />
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      ) : null}

      <DelayReasonSheet
        visible={!!delayTarget}
        kotLabel={delayTarget ? `KOT #${delayTarget.orderNumber ?? delayTarget.id}` : ""}
        onClose={() => setDelayTarget(null)}
        onSubmit={submitDelayReason}
      />
    </View>
  );
}

function ConnectionDot({ state }: { state: ConnectionState }) {
  const colors = useChefColors();
  const map = {
    live: { color: "#34d399", label: "Live" },
    polling: { color: "#fbbf24", label: "Polling" },
    offline: { color: "#f87171", label: "Offline" },
  } as const;
  const m = map[state];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.color }} />
      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: colors.mutedForeground }}>{m.label}</Text>
    </View>
  );
}

function StationChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useChefColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.stationChip,
        {
          backgroundColor: active ? colors.primary : colors.surfaceAlt,
          borderColor: active ? colors.primary : colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={[styles.stationChipText, { color: active ? colors.primaryForeground : colors.foreground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const DELAY_PRESETS = [
  "Out of stock",
  "Equipment issue",
  "Large order behind",
  "Custom request",
  "Staff shortage",
];

function DelayReasonSheet({
  visible, kotLabel, onClose, onSubmit,
}: {
  visible: boolean;
  kotLabel: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const colors = useChefColors();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!visible) setReason("");
  }, [visible]);

  const submit = () => {
    const r = reason.trim();
    if (!r) return;
    onSubmit(r);
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16, borderColor: colors.border }]}>
        <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Delay reason</Text>
        <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>{kotLabel}</Text>

        <View style={styles.presetGrid}>
          {DELAY_PRESETS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setReason(p)}
              style={({ pressed }) => [
                styles.presetChip,
                {
                  backgroundColor: reason === p ? colors.primary : colors.surfaceAlt,
                  borderColor: reason === p ? colors.primary : colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={{ color: reason === p ? colors.primaryForeground : colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                {p}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Add a note for the floor…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={[styles.textInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
        />

        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.sheetBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={submit}
            disabled={!reason.trim()}
            style={({ pressed }) => [
              styles.sheetBtnPrimary,
              { backgroundColor: colors.primary, opacity: !reason.trim() ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_700Bold", fontSize: 14 }}>Log delay</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 12, paddingBottom: 10, gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 4, gap: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  tabsRow: { gap: 8, paddingHorizontal: 4, paddingVertical: 2 },
  tabChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1.5,
  },
  tabChipText: { fontSize: 14, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },
  tabBadge: { minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: "center", justifyContent: "center", marginLeft: 2 },
  tabBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  stationRow: { gap: 6, paddingHorizontal: 4 },
  stationChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  stationChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  list: { padding: 12 },
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  toast: {
    position: "absolute", left: 16, right: 16,
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
  },
  toastText: { flex: 1, color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderBottomWidth: 0,
    padding: 16,
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sheetSubtitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 2, marginBottom: 12 },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  textInput: {
    minHeight: 80, padding: 12, borderRadius: 10, borderWidth: 1,
    fontFamily: "Inter_400Regular", fontSize: 14, textAlignVertical: "top",
  },
  sheetBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 10, borderWidth: 1 },
  sheetBtnPrimary: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 10 },
});
