import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, SectionList, FlatList, Pressable, ScrollView, RefreshControl,
  Alert, Platform, Switch, TextInput, Vibration, Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateKitchenTicketStatus, customFetch } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { RoleGate } from "@/components/RoleGate";
import { EmptyState } from "@/components/EmptyState";
import { ListSkeleton } from "@/components/ListSkeleton";
import { OfflineBanner } from "@/components/OfflineBanner";
import {
  useKdsTickets, useKitchensList, useKdsBuckets,
  type KdsTabKey, type KdsFilterKey, type KdsTicket, type KdsKitchen,
} from "@/hooks/useKdsTickets";
import { useKdsRealtime, type ConnectionState } from "@/hooks/useKdsRealtime";
import { useKdsSettings } from "@/hooks/useKdsSettings";
import { useKdsSounds, type AlertSoundKey } from "@/hooks/useKdsSounds";
import { KdsOrderCard, ITEM_CYCLE, STATUS_META } from "@/components/kds/KdsOrderCard";
import { KdsCancelSheet } from "@/components/kds/KdsCancelSheet";
import { KdsHistoryDetailSheet } from "@/components/kds/KdsHistoryDetailSheet";

const TABS: { key: KdsTabKey; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { key: "new", label: "New", icon: "alert-circle-outline" },
  { key: "preparing", label: "Preparing", icon: "flame-outline" },
  { key: "ready", label: "Ready", icon: "checkmark-circle-outline" },
  { key: "history", label: "History", icon: "time-outline" },
  { key: "settings", label: "Settings", icon: "settings-outline" },
];

const FILTERS: { key: KdsFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "dine_in", label: "Dine-in" },
  { key: "takeaway", label: "Takeaway" },
  { key: "delivery", label: "Delivery" },
  { key: "online", label: "Online" },
  { key: "delayed", label: "Delayed" },
];

const SETTINGS_ROLES = new Set(["owner", "manager", "super_admin"]);

type ItemStatus = "pending" | "preparing" | "ready" | "oos";

const CLIENT_TO_SERVER_STATUS: Record<ItemStatus, "pending" | "preparing" | "ready" | "out_of_stock"> = {
  pending: "pending",
  preparing: "preparing",
  ready: "ready",
  oos: "out_of_stock",
};

const SERVER_TO_CLIENT_STATUS: Record<string, ItemStatus> = {
  pending: "pending",
  preparing: "preparing",
  ready: "ready",
  out_of_stock: "oos",
};

// Module-level stable references for the KDS lists — exporting them from
// the render closure was forcing FlatList to re-create every row on each
// render (one of the root causes of the scroll lag).
const EMPTY_CHECKS: Record<number, ItemStatus> = {};
const noop = () => {};
const kdsKeyExtractor = (t: KdsTicket) => String(t.id);

function KitchenScreen() {
  return (
    <RoleGate module="kitchen">
      <KdsView />
    </RoleGate>
  );
}

function KdsView() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const qc = useQueryClient();
  const { restaurantId, user } = useAuth();
  const { settings, update: updateSettings, loaded: settingsLoaded } = useKdsSettings();

  const [tab, setTab] = useState<KdsTabKey>("new");
  const [filter, setFilter] = useState<KdsFilterKey>("all");
  const [stationId, setStationId] = useState<number | "all">(settings.defaultStationId);
  const [historySearch, setHistorySearch] = useState("");
  const [itemOverrides, setItemOverrides] = useState<Record<number, ItemStatus>>({});
  const [cancelTarget, setCancelTarget] = useState<KdsTicket | null>(null);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<KdsTicket | null>(null);
  const [undoState, setUndoState] = useState<{ ticketId: number; itemId: number; prev: ItemStatus } | null>(null);
  const [pendingTicketIds, setPendingTicketIds] = useState<Record<number, true>>({});
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const stationDefaultedRef = useRef(false);

  const seenTicketIds = useRef<Set<number>>(new Set());
  const seenDelayedIds = useRef<Set<number>>(new Set());
  const initialLoadDone = useRef(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!settingsLoaded || stationDefaultedRef.current) return;
    // Kitchen-role cooks land on their assigned kitchen if their staff record
    // has one — admins / cashiers fall back to the per-device default. This
    // happens once on first load; manual station switches still persist via
    // local setStationId state.
    const role = user?.role ?? "";
    const assignedKitchen = user?.kitchenId ?? null;
    if ((role === "kitchen" || role === "chef") && assignedKitchen != null) {
      setStationId(assignedKitchen);
    } else {
      setStationId(settings.defaultStationId);
    }
    stationDefaultedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, user?.role, user?.kitchenId]);

  const kitchensQ = useKitchensList(restaurantId);
  const ticketsQ = useKdsTickets(restaurantId, { pollMs: 15_000 });
  const tickets = (ticketsQ.data ?? []) as KdsTicket[];
  const sounds = useKdsSounds(settings.sound);

  const triggerAlert = useCallback((kind: "new" | "delayed") => {
    if (settings.sound) {
      sounds.play(settings.alertSound as AlertSoundKey);
    }
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
      if (settings.sound || settings.vibration) triggerAlert("new");
    },
    onTicketDelayed: (payload) => {
      if (stationId !== "all" && payload?.kitchenId != null && Number(payload.kitchenId) !== stationId) return;
      if (settings.sound || settings.vibration) triggerAlert("delayed");
    },
  });

  const buckets = useKdsBuckets(tickets, tab, filter, stationId, settings.delayedThresholdMin);

  useEffect(() => {
    if (!initialLoadDone.current) return;
    for (const t of tickets) {
      if (t.isDelayed && !seenDelayedIds.current.has(t.id)) {
        seenDelayedIds.current.add(t.id);
        if (stationId === "all" || t.kitchenId === stationId) triggerAlert("delayed");
      }
    }
  }, [tickets, stationId, triggerAlert]);

  useEffect(() => {
    if (!initialLoadDone.current && !ticketsQ.isLoading) {
      tickets.forEach((t) => seenTicketIds.current.add(t.id));
      initialLoadDone.current = true;
      return;
    }
    for (const t of tickets) {
      if (!seenTicketIds.current.has(t.id)) {
        seenTicketIds.current.add(t.id);
        if (connection !== "live" && (stationId === "all" || t.kitchenId === stationId)) {
          triggerAlert("new");
        }
      }
    }
  }, [tickets, ticketsQ.isLoading, connection, stationId, triggerAlert]);

  const updateStatus = useUpdateKitchenTicketStatus();

  // Per-item status: optimistic update against the new backend endpoint.
  // We keep an override map keyed by item id so the UI stays in sync with
  // the cook's tap even before the round-trip lands, and we roll back
  // on failure. A 4s undo toast follows so accidental taps are recoverable.
  const computeItemStatus = useCallback((item: { id: number; status?: string | null }): ItemStatus => {
    const override = itemOverrides[item.id];
    if (override) return override;
    return SERVER_TO_CLIENT_STATUS[String(item.status ?? "pending")] ?? "pending";
  }, [itemOverrides]);

  const onCycleItem = useCallback(async (ticket: KdsTicket, itemId: number) => {
    const item = (ticket.items ?? []).find((i) => i.id === itemId);
    if (!item) return;
    const current = computeItemStatus(item);
    const next = ITEM_CYCLE[current];
    setItemOverrides((m) => ({ ...m, [itemId]: next }));
    Haptics.selectionAsync().catch(() => {});
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoState({ ticketId: ticket.id, itemId, prev: current });
    undoTimer.current = setTimeout(() => setUndoState(null), 4000);
    try {
      await customFetch(`/api/restaurants/${restaurantId}/orders/${ticket.orderId}/items/${itemId}/kitchen-status`, {
        method: "PATCH",
        body: JSON.stringify({ status: CLIENT_TO_SERVER_STATUS[next] }),
        headers: { "content-type": "application/json" },
      });
      qc.invalidateQueries({ queryKey: ticketsQ.queryKey });
    } catch (err) {
      setItemOverrides((m) => ({ ...m, [itemId]: current }));
      setUndoState(null);
      Alert.alert("Couldn't update item", (err as Error).message || "Please try again.");
    }
  }, [computeItemStatus, restaurantId, qc, ticketsQ.queryKey]);

  const undoLastItemChange = useCallback(async () => {
    const u = undoState;
    if (!u) return;
    setUndoState(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setItemOverrides((m) => ({ ...m, [u.itemId]: u.prev }));
    try {
      await customFetch(`/api/restaurants/${restaurantId}/orders/${u.ticketId ? tickets.find((t) => t.id === u.ticketId)?.orderId ?? 0 : 0}/items/${u.itemId}/kitchen-status`, {
        method: "PATCH",
        body: JSON.stringify({ status: CLIENT_TO_SERVER_STATUS[u.prev] }),
        headers: { "content-type": "application/json" },
      });
      qc.invalidateQueries({ queryKey: ticketsQ.queryKey });
    } catch {
      /* server reconciles on next poll */
    }
  }, [undoState, restaurantId, tickets, qc, ticketsQ.queryKey]);

  // After a successful refetch, clear any overrides that match the
  // server-reported status so the override map doesn't grow unbounded.
  useEffect(() => {
    if (ticketsQ.isFetching) return;
    setItemOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next: Record<number, ItemStatus> = {};
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

  const showToast = useCallback((kind: "success" | "error", message: string) => {
    setToast({ kind, message });
    setTimeout(() => setToast((t) => (t && t.message === message ? null : t)), 2500);
  }, []);

  // Ticket-level transitions are optimistic so cooks see the card hop tabs
  // instantly. We patch the React Query cache, fire the mutation, then either
  // reconcile from the server response (which holds the canonical timestamps)
  // or roll back the cache entry on failure. Polling at 15s and the socket
  // `ticket:status` event silently re-converge after that.
  const advanceTicket = useCallback(async (ticket: KdsTicket) => {
    const nextStatus =
      ticket.status === "new" || ticket.status === "pending" ? "preparing"
      : ticket.status === "preparing" || ticket.status === "in_progress" ? "ready"
      : ticket.status === "ready" ? "served"
      : null;
    if (!nextStatus) return;
    if (pendingTicketIds[ticket.id]) return;

    const queryKey = ticketsQ.queryKey;
    const previous = qc.getQueryData<KdsTicket[]>(queryKey);
    qc.setQueryData<KdsTicket[]>(queryKey, (old) =>
      Array.isArray(old)
        ? old.map((t) => (t.id === ticket.id ? { ...t, status: nextStatus } : t))
        : old,
    );
    setPendingTicketIds((m) => ({ ...m, [ticket.id]: true }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await updateStatus.mutateAsync({ restaurantId, id: ticket.id, data: { status: nextStatus } });
      qc.invalidateQueries({ queryKey });
      // Auto-jump to the tab the ticket just moved into so the cook never
      // loses sight of an order they're actively working on. On mobile the
      // KDS uses tabs (vs the web's side-by-side columns), so without this
      // the card appears to "disappear" after Accept & Start / Mark Ready.
      // Auto-jump only when the ticket moves to a workflow tab the cook is
      // actively watching (Preparing / Ready). When marking served, the cook
      // is finishing the order — they should stay on their current tab and
      // simply see the card disappear, not get bounced to History.
      const destTab: KdsTabKey | null =
        nextStatus === "preparing" ? "preparing"
        : nextStatus === "ready" ? "ready"
        : null;
      const orderLabel = `#${ticket.orderNumber ?? ticket.id}`;
      const verb =
        nextStatus === "preparing" ? "moved to Preparing"
        : nextStatus === "ready" ? "ready to serve"
        : "served";
      if (destTab && destTab !== tab) {
        setTab(destTab);
      }
      showToast("success", `${orderLabel} ${verb}`);
    } catch (err) {
      if (previous) qc.setQueryData(queryKey, previous);
      showToast("error", (err as Error).message || "Couldn't update ticket. Please try again.");
    } finally {
      setPendingTicketIds((m) => {
        const { [ticket.id]: _, ...rest } = m;
        return rest;
      });
    }
  }, [restaurantId, updateStatus, qc, ticketsQ.queryKey, pendingTicketIds, showToast, tab]);

  const requestCancel = useCallback((ticket: KdsTicket) => {
    const role = user?.role ?? "";
    if (!SETTINGS_ROLES.has(role) && !user?.isSuperAdmin) {
      Alert.alert("Not allowed", "Only owner or manager can cancel a kitchen ticket.");
      return;
    }
    setCancelTarget(ticket);
  }, [user]);

  const submitCancel = useCallback(async (reason: string) => {
    if (!cancelTarget) return;
    setCancelSubmitting(true);
    try {
      await customFetch(`/api/restaurants/${restaurantId}/kitchen/tickets/${cancelTarget.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled", reason }),
        headers: { "content-type": "application/json" },
      });
      qc.invalidateQueries({ queryKey: ticketsQ.queryKey });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setCancelTarget(null);
    } finally {
      setCancelSubmitting(false);
    }
  }, [cancelTarget, restaurantId, qc, ticketsQ.queryKey]);

  const togglePriority = useCallback(async (ticket: KdsTicket) => {
    const queryKey = ticketsQ.queryKey;
    const previous = qc.getQueryData<KdsTicket[]>(queryKey);
    qc.setQueryData<KdsTicket[]>(queryKey, (old) =>
      Array.isArray(old)
        ? old.map((t) => (t.id === ticket.id ? { ...t, isPriority: !t.isPriority } : t))
        : old,
    );
    try {
      await customFetch(`/api/restaurants/${restaurantId}/kitchen/tickets/${ticket.id}/priority`, { method: "PATCH" });
      qc.invalidateQueries({ queryKey });
    } catch (err) {
      if (previous) qc.setQueryData(queryKey, previous);
      showToast("error", (err as Error).message || "Couldn't update priority.");
    }
  }, [restaurantId, qc, ticketsQ.queryKey, showToast]);

  // "Bump" is parity with the web KDS — a single tap that advances the
  // ticket one step regardless of label, useful when the cook is clearing
  // a busy board and doesn't want to read the primary-button text.
  const bumpTicket = useCallback((ticket: KdsTicket) => {
    void advanceTicket(ticket);
  }, [advanceTicket]);

  // Queues a real KOT reprint through the print-jobs API. The server routes
  // the job to the configured KOT printer for this station (or the default
  // KOT printer if the station has none). Whichever device claims the job
  // (mobile via printerAdapter, or the desktop print bridge) emits the paper
  // ticket. We surface a toast immediately based on the queue response.
  const reprintKot = useCallback(async (ticket: KdsTicket) => {
    const station = ticket.kitchen?.name ?? "this station";
    try {
      const items = (ticket.items ?? []).map((it) => ({
        name: (it as { menuItemName?: string; name?: string }).menuItemName
          ?? (it as { name?: string }).name
          ?? "Item",
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
          marker: "new",
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
        showToast("error", resp.error || `No KOT printer configured for ${station}`);
      } else {
        showToast("success", `KOT reprint queued for ${station}`);
        Haptics.selectionAsync().catch(() => {});
      }
    } catch (err) {
      showToast("error", (err as Error).message || "Couldn't queue KOT reprint");
    }
  }, [restaurantId, showToast]);

  const autoAcceptedIds = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!settings.autoAccept || !initialLoadDone.current) return;
    for (const t of tickets) {
      if (autoAcceptedIds.current.has(t.id)) continue;
      const status = String(t.status);
      if (status !== "new" && status !== "pending") continue;
      if (stationId !== "all" && t.kitchenId !== stationId) continue;
      autoAcceptedIds.current.add(t.id);
      updateStatus.mutateAsync({ restaurantId, id: t.id, data: { status: "preparing" } })
        .then(() => qc.invalidateQueries({ queryKey: ticketsQ.queryKey }))
        .catch(() => { /* staff can advance manually */ });
    }
  }, [tickets, settings.autoAccept, stationId, restaurantId, updateStatus, qc, ticketsQ.queryKey]);

  // History grouping: by hour, last 24h, with optional order# search.
  const historySections = useMemo(() => {
    if (tab !== "history") return [];
    const q = historySearch.trim().toLowerCase();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const list = buckets.byTab.history
      .filter((t) => new Date(t.createdAt ?? Date.now()).getTime() > cutoff)
      .filter((t) => !q || String(t.orderNumber ?? t.id).toLowerCase().includes(q))
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const groups = new Map<string, KdsTicket[]>();
    for (const t of list) {
      const d = new Date(t.createdAt ?? Date.now());
      const key = `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${String(d.getHours()).padStart(2, "0")}:00`;
      const arr = groups.get(key) ?? [];
      arr.push(t);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([title, data]) => ({ title, data }));
  }, [tab, buckets.byTab.history, historySearch]);

  // Pre-compute the per-item check map for every ticket in the active
  // bucket ONCE per render instead of inside renderItem. Each map is a
  // stable reference until the ticket's items or local overrides change,
  // which keeps the KdsOrderCard memo comparator happy and stops the
  // entire list from re-rendering when one card flips state.
  const checksByTicket = useMemo(() => {
    const map = new Map<number, Record<number, ItemStatus>>();
    for (const t of buckets.filtered) {
      const checks: Record<number, ItemStatus> = {};
      for (const i of t.items ?? []) checks[i.id] = computeItemStatus(i);
      map.set(t.id, checks);
    }
    return map;
  }, [buckets.filtered, computeItemStatus]);

  const renderActiveItem = useCallback(({ item }: { item: KdsTicket }) => {
    const checks = checksByTicket.get(item.id) ?? EMPTY_CHECKS;
    return (
      <KdsOrderCard
        ticket={item}
        itemChecks={checks}
        onCycleItem={(itemId) => onCycleItem(item, itemId)}
        onPrimaryAction={advanceTicket}
        onCancel={requestCancel}
        onPriority={togglePriority}
        onBump={bumpTicket}
        onReprint={reprintKot}
        isPending={!!pendingTicketIds[item.id]}
      />
    );
  }, [checksByTicket, onCycleItem, advanceTicket, requestCancel, togglePriority, bumpTicket, reprintKot, pendingTicketIds]);

  const openHistoryTarget = useCallback((t: KdsTicket) => setHistoryTarget(t), []);

  const renderHistoryItem = useCallback(({ item }: { item: KdsTicket }) => (
    <Pressable onPress={() => setHistoryTarget(item)}>
      <KdsOrderCard
        ticket={item}
        itemChecks={EMPTY_CHECKS}
        onCycleItem={noop}
        onPrimaryAction={openHistoryTarget}
        onCancel={openHistoryTarget}
      />
    </Pressable>
  ), [openHistoryTarget]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 16 : insets.top + 4, borderBottomColor: colors.border }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Kitchen Display</Text>
          <ConnectionDot state={connection} />
        </View>

        {tab !== "settings" && tab !== "history" ? (
          <View style={styles.statusBoxRow}>
            {(["new", "preparing", "ready"] as const).map((k) => {
              const meta = STATUS_META[k] ?? STATUS_META.new;
              const active = tab === k;
              const count = buckets.counts[k];
              return (
                <Pressable
                  key={k}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); setTab(k); }}
                  style={({ pressed }) => [
                    styles.statusBox,
                    {
                      backgroundColor: active ? meta.color : colors.muted,
                      borderColor: active ? meta.color : colors.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.statusBoxCount, { color: active ? "#fff" : meta.color }]}>{count}</Text>
                  <Text style={[styles.statusBoxLabel, { color: active ? "#fff" : colors.foreground }]}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <StationChip label="All Stations" active={stationId === "all"} onPress={() => setStationId("all")} />
          {(kitchensQ.data ?? []).filter((k) => k.isActive !== false).map((k) => (
            <StationChip key={k.id} label={k.name} active={stationId === k.id} onPress={() => setStationId(k.id)} />
          ))}
        </ScrollView>

        {tab !== "settings" && tab !== "history" ? (
          <View style={styles.filterRow}>
            <View style={styles.filterLabelWrap}>
              <Ionicons name="filter" size={14} color={colors.mutedForeground} />
              <Text style={[styles.filterLabel, { color: colors.mutedForeground }]}>Filter</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {FILTERS.map((f) => (
                <FilterChip
                  key={f.key}
                  label={f.label}
                  active={filter === f.key}
                  badge={f.key === "delayed" ? buckets.delayedCount : undefined}
                  onPress={() => setFilter(f.key)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {tab === "history" ? (
          <View style={[styles.searchWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Ionicons name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={historySearch}
              onChangeText={setHistorySearch}
              placeholder="Search by order number"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground }]}
              returnKeyType="search"
            />
            {historySearch ? (
              <Pressable onPress={() => setHistorySearch("")}>
                <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <OfflineBanner />

      {tab === "settings" ? (
        <SettingsTab
          settings={settings}
          updateSettings={updateSettings}
          stations={kitchensQ.data ?? []}
          restaurantId={restaurantId}
          onAutoPrintSync={() => qc.invalidateQueries({ queryKey: ["kds", "kitchens", restaurantId] })}
          canEdit={SETTINGS_ROLES.has(user?.role ?? "") || !!user?.isSuperAdmin}
        />
      ) : ticketsQ.isLoading ? (
        <ListSkeleton rows={4} />
      ) : ticketsQ.isError ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.mutedForeground} />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>Couldn't load tickets</Text>
          <Pressable
            onPress={() => ticketsQ.refetch()}
            style={({ pressed }) => [styles.retryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>Retry sync</Text>
          </Pressable>
        </View>
      ) : tab === "history" ? (
        historySections.length === 0 ? (
          <EmptyState icon="time-outline" title="No history in the last 24 hours" />
        ) : (
          <SectionList
            sections={historySections}
            keyExtractor={kdsKeyExtractor}
            stickySectionHeadersEnabled
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 84 }]}
            renderSectionHeader={({ section }) => (
              <View style={[styles.sectionHeader, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
                <Text style={[styles.sectionHeaderText, { color: colors.mutedForeground }]}>{section.title}</Text>
                <Text style={[styles.sectionHeaderCount, { color: colors.mutedForeground }]}>{section.data.length}</Text>
              </View>
            )}
            renderItem={renderHistoryItem}
            refreshControl={
              <RefreshControl refreshing={ticketsQ.isRefetching} onRefresh={ticketsQ.refetch} tintColor={colors.primary} />
            }
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={5}
          />
        )
      ) : buckets.filtered.length === 0 ? (
        <EmptyState
          icon={tab === "new" ? "checkmark-done-circle-outline" : tab === "preparing" ? "flame-outline" : tab === "ready" ? "restaurant-outline" : "time-outline"}
          title={
            tab === "new" ? "No new orders 🎉"
              : tab === "preparing" ? "Nothing on the line"
              : "Nothing waiting to be served"
          }
          message={tab === "new" ? "When a new order arrives, it shows up here automatically." : undefined}
        />
      ) : (
        <FlatList
          data={buckets.filtered}
          keyExtractor={kdsKeyExtractor}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 84 }]}
          refreshControl={
            <RefreshControl refreshing={ticketsQ.isRefetching} onRefresh={ticketsQ.refetch} tintColor={colors.primary} />
          }
          renderItem={renderActiveItem}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          // Gate clipping to Android — on iOS this is a known cause of
          // sticky-header / row disappearance, which is unacceptable on
          // a KDS where missing a ticket means a missed order.
          removeClippedSubviews={Platform.OS === "android"}
        />
      )}

      {undoState ? (
        <View style={[styles.undoToast, { bottom: insets.bottom + 80 }]}>
          <Ionicons name="checkmark-circle" size={18} color="#fff" />
          <Text style={styles.undoText}>Item updated</Text>
          <Pressable onPress={undoLastItemChange} hitSlop={8}>
            <Text style={styles.undoLink}>UNDO</Text>
          </Pressable>
        </View>
      ) : null}

      {toast ? (
        <View
          style={[
            styles.undoToast,
            { bottom: insets.bottom + (undoState ? 140 : 80), backgroundColor: toast.kind === "error" ? "#7f1d1d" : "#065f46" },
          ]}
        >
          <Ionicons
            name={toast.kind === "error" ? "alert-circle" : "checkmark-circle"}
            size={18}
            color="#fff"
          />
          <Text style={styles.undoText}>{toast.message}</Text>
          <Pressable onPress={() => setToast(null)} hitSlop={8}>
            <Ionicons name="close" size={16} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.tabBar, { paddingBottom: insets.bottom > 0 ? insets.bottom : 8, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        {TABS.map((t) => {
          const count = t.key === "settings" ? 0 : buckets.counts[t.key];
          const active = tab === t.key;
          // The 3 "upper" workflow categories (New/Preparing/Ready) each carry
          // the same status color used on web KDS columns and on the ticket
          // cards, so the cook reads the same colour story across surfaces.
          const statusColor =
            t.key === "new" ? STATUS_META.new.color
            : t.key === "preparing" ? STATUS_META.preparing.color
            : t.key === "ready" ? STATUS_META.ready.color
            : colors.primary;
          const activeColor = statusColor;
          return (
            <Pressable
              key={t.key}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); setTab(t.key); }}
              style={styles.tabBtn}
            >
              {active && (t.key === "new" || t.key === "preparing" || t.key === "ready") ? (
                <View style={[styles.tabActiveBar, { backgroundColor: activeColor }]} />
              ) : null}
              <View>
                <Ionicons name={t.icon} size={22} color={active ? activeColor : colors.mutedForeground} />
                {count > 0 ? (
                  <View style={[
                    styles.tabBadge,
                    (t.key === "new" || t.key === "preparing" || t.key === "ready") && { backgroundColor: statusColor },
                  ]}>
                    <Text style={styles.tabBadgeText}>{count > 99 ? "99+" : count}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tabLabel, { color: active ? activeColor : colors.mutedForeground }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <KdsCancelSheet
        visible={!!cancelTarget}
        orderLabel={cancelTarget ? `#${cancelTarget.orderNumber ?? cancelTarget.id}` : ""}
        submitting={cancelSubmitting}
        onClose={() => !cancelSubmitting && setCancelTarget(null)}
        onSubmit={submitCancel}
      />
      <KdsHistoryDetailSheet ticket={historyTarget} onClose={() => setHistoryTarget(null)} />
    </View>
  );
}

function ConnectionDot({ state }: { state: ConnectionState }) {
  const colors = useColors();
  const map = {
    live: { color: "#16a34a", label: "Live" },
    polling: { color: "#f59e0b", label: "Polling" },
    offline: { color: "#dc2626", label: "Offline" },
  } as const;
  const m = map[state];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.color }} />
      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground }}>{m.label}</Text>
    </View>
  );
}

function StationChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: active ? colors.primary : colors.muted, borderColor: active ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

function FilterChip({ label, active, onPress, badge }: { label: string; active: boolean; onPress: () => void; badge?: number }) {
  const colors = useColors();
  const activeBg = colors.primary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: active ? activeBg : "transparent", borderColor: active ? activeBg : colors.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>{label}</Text>
      {badge && badge > 0 ? (
        <View style={[styles.chipBadge, { backgroundColor: active ? "#fff" : "#dc2626" }]}>
          <Text style={[styles.chipBadgeText, { color: active ? activeBg : "#fff" }]}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function SettingsTab({
  settings, updateSettings, stations, restaurantId, onAutoPrintSync, canEdit,
}: {
  settings: ReturnType<typeof useKdsSettings>["settings"];
  updateSettings: ReturnType<typeof useKdsSettings>["update"];
  stations: KdsKitchen[];
  restaurantId: number;
  onAutoPrintSync: () => void;
  canEdit: boolean;
}) {
  const colors = useColors();
  const [stationPickerOpen, setStationPickerOpen] = useState(false);
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const [autoPrintSyncing, setAutoPrintSyncing] = useState(false);
  const sounds = useKdsSounds(true);

  if (!canEdit) {
    return (
      <EmptyState
        icon="lock-closed-outline"
        title="Settings are owner-only"
        message="Ask the owner or manager to change KDS settings on this device."
      />
    );
  }

  const defaultStationLabel =
    settings.defaultStationId === "all" ? "All Stations" : stations.find((s) => s.id === settings.defaultStationId)?.name ?? "Default";
  const SOUND_OPTIONS: { key: AlertSoundKey; label: string }[] = [
    { key: "chime", label: "Soft Chime" },
    { key: "bell", label: "Service Bell" },
    { key: "ding", label: "Quick Ding" },
  ];

  // Sync the local autoPrint toggle to every active station server-side so
  // the existing /kitchens/:id auto-print pipeline picks it up. We surface
  // a synced/unsynced state from the actual kitchen records.
  const allActiveAutoPrint = stations.filter((k) => k.isActive !== false).every((k) => k.autoPrint);
  const autoPrintInSync = allActiveAutoPrint === settings.autoPrint;
  const handleAutoPrintToggle = async (v: boolean) => {
    updateSettings({ autoPrint: v });
    setAutoPrintSyncing(true);
    try {
      await Promise.all(
        stations
          .filter((k) => k.isActive !== false && k.autoPrint !== v)
          .map((k) =>
            customFetch(`/api/restaurants/${restaurantId}/kitchens/${k.id}`, {
              method: "PATCH",
              body: JSON.stringify({ autoPrint: v }),
              headers: { "content-type": "application/json" },
            }),
          ),
      );
      onAutoPrintSync();
    } catch (err) {
      Alert.alert(
        "Auto-print sync failed",
        (err as Error).message || "Saved on this device but couldn't update station settings.",
      );
    } finally {
      setAutoPrintSyncing(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 120 }}>
      <Row label="Delayed threshold (min)">
        <View style={styles.numStepper}>
          <Pressable onPress={() => updateSettings({ delayedThresholdMin: Math.max(1, settings.delayedThresholdMin - 1) })} style={[styles.stepBtn, { borderColor: colors.border }]}>
            <Ionicons name="remove" size={16} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.stepperValue, { color: colors.foreground }]}>{settings.delayedThresholdMin}</Text>
          <Pressable onPress={() => updateSettings({ delayedThresholdMin: Math.min(120, settings.delayedThresholdMin + 1) })} style={[styles.stepBtn, { borderColor: colors.border }]}>
            <Ionicons name="add" size={16} color={colors.foreground} />
          </Pressable>
        </View>
      </Row>
      <Row label="Sound on new orders / delays">
        <Switch value={settings.sound} onValueChange={(v) => updateSettings({ sound: v })} />
      </Row>
      <Row label="Vibration alerts">
        <Switch value={settings.vibration} onValueChange={(v) => updateSettings({ vibration: v })} />
      </Row>
      <Row label="Auto-accept new orders">
        <Switch value={settings.autoAccept} onValueChange={(v) => updateSettings({ autoAccept: v })} />
      </Row>
      <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={[styles.rowLabel, { color: colors.foreground }]}>Auto-print KOT</Text>
          <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: autoPrintInSync ? colors.mutedForeground : "#c2410c", marginTop: 2 }}>
            {autoPrintSyncing
              ? "Syncing to stations…"
              : autoPrintInSync
                ? `${stations.filter((k) => k.isActive !== false).length} station(s) in sync`
                : "Out of sync — re-toggle to push to stations"}
          </Text>
        </View>
        <Switch value={settings.autoPrint} onValueChange={handleAutoPrintToggle} disabled={autoPrintSyncing} />
      </View>
      <PickerRow label="Default station view" value={defaultStationLabel} onPress={() => setStationPickerOpen(true)} />
      <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card, gap: 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { color: colors.foreground }]}>Alert sound</Text>
          <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
            {SOUND_OPTIONS.find((s) => s.key === settings.alertSound)?.label ?? "Chime"} · plays even on silent
          </Text>
        </View>
        <Pressable
          onPress={() => sounds.play(settings.alertSound as AlertSoundKey)}
          style={({ pressed }) => [styles.iconSquare, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          accessibilityLabel="Preview alert sound"
        >
          <Ionicons name="play" size={16} color={colors.foreground} />
        </Pressable>
        <Pressable
          onPress={() => setSoundPickerOpen(true)}
          style={({ pressed }) => [styles.iconSquare, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="chevron-down" size={16} color={colors.foreground} />
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push("/(owner)/menu")}
        style={({ pressed }) => [styles.linkRow, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
      >
        <View>
          <Text style={[styles.rowLabel, { color: colors.foreground }]}>Station &amp; category mapping</Text>
          <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
            Map menu items to kitchen stations from the menu screen.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </Pressable>

      <BottomPicker
        visible={stationPickerOpen}
        title="Default station"
        options={[{ key: "all", label: "All Stations" }, ...stations.map((s) => ({ key: String(s.id), label: s.name }))]}
        selectedKey={String(settings.defaultStationId)}
        onSelect={(key) => { updateSettings({ defaultStationId: key === "all" ? "all" : Number(key) }); setStationPickerOpen(false); }}
        onClose={() => setStationPickerOpen(false)}
      />
      <BottomPicker
        visible={soundPickerOpen}
        title="Alert sound"
        options={SOUND_OPTIONS.map((s) => ({ key: s.key, label: s.label }))}
        selectedKey={settings.alertSound}
        onSelect={(key) => { updateSettings({ alertSound: key as AlertSoundKey }); setSoundPickerOpen(false); sounds.play(key as AlertSoundKey); }}
        onClose={() => setSoundPickerOpen(false)}
      />
    </ScrollView>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
      {children}
    </View>
  );
}

function PickerRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>{value}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

function BottomPicker({
  visible, title, options, selectedKey, onSelect, onClose,
}: {
  visible: boolean;
  title: string;
  options: { key: string; label: string }[];
  selectedKey: string;
  onSelect: (k: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.sheetHandle} />
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
        <ScrollView style={{ maxHeight: 360 }}>
          {options.map((o) => {
            const active = o.key === selectedKey;
            return (
              <Pressable
                key={o.key}
                onPress={() => onSelect(o.key)}
                style={({ pressed }) => [
                  styles.sheetOption,
                  { borderColor: colors.border, backgroundColor: active ? colors.primary + "15" : "transparent", opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 15 }}>{o.label}</Text>
                {active ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, marginBottom: 4 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  statusBoxRow: { flexDirection: "row", gap: 8, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 2 },
  statusBox: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", gap: 2 },
  statusBoxCount: { fontSize: 22, fontFamily: "Inter_700Bold", lineHeight: 26 },
  statusBoxLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4, textTransform: "uppercase" },
  chipsRow: { gap: 6, paddingHorizontal: 4, paddingVertical: 4 },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  filterLabelWrap: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4 },
  filterLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4, textTransform: "uppercase" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  chipBadge: { minWidth: 18, paddingHorizontal: 5, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  chipBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 38, borderRadius: 10, borderWidth: 1, marginTop: 2 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 0 },
  list: { padding: 12 },
  retryBtn: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4, paddingVertical: 6, borderBottomWidth: 1 },
  sectionHeaderText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  sectionHeaderCount: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  tabBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    borderTopWidth: 1, paddingTop: 6,
    position: "absolute", left: 0, right: 0, bottom: 0,
  },
  tabBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 4, gap: 2, position: "relative" },
  tabActiveBar: { position: "absolute", top: -8, left: "20%", right: "20%", height: 3, borderRadius: 2 },
  tabLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  tabBadge: { position: "absolute", top: -4, right: -10, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: "#dc2626", alignItems: "center", justifyContent: "center" },
  tabBadgeText: { color: "#fff", fontSize: 9, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1 },
  rowLabel: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1, marginRight: 12 },
  linkRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 14, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  numStepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepperValue: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 28, textAlign: "center" },
  iconSquare: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, gap: 10 },
  sheetHandle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "#d1d5db" },
  sheetTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 6 },
  sheetOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 14, borderBottomWidth: 1 },
  undoToast: {
    position: "absolute", left: 16, right: 16,
    backgroundColor: "#111827",
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: "row", alignItems: "center", gap: 10,
    elevation: 6, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  undoText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  undoLink: { color: "#fbbf24", fontSize: 13, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
});

import { withPlanGate } from "@/components/PlanGate";
export default withPlanGate(KitchenScreen, "kitchen_display");
