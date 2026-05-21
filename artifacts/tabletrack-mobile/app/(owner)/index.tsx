import React, { useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  customFetch,
  getDashboardSummary, getGetDashboardSummaryQueryKey,
  getRevenueTrend, getGetRevenueTrendQueryKey,
  listOrders,
  listInventoryItems, getListInventoryItemsQueryKey,
  listAttendance, getListAttendanceQueryKey,
} from "@workspace/api-client-react";
import type {
  DashboardSummary, Order, InventoryItem, AttendanceRecord,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { MetricCard, PlaceholderCard } from "@/components/MetricCard";
import { MiniBarChart } from "@/components/MiniBarChart";
import { GradientHeroCard } from "@/components/GradientHeroCard";
import { QuickActionTile } from "@/components/QuickActionTile";
import { OnboardingChecklistCard } from "@/components/OnboardingChecklistCard";

type CashSession = {
  session: { id: number; status: string; openingFloat?: string; openedByName?: string | null } | null;
  totals: { expectedCash?: string; countedCash?: string; variance?: string } | null;
};
type FraudAlertItem = { id: number; severity?: "high" | "medium" | "low"; status?: string };
type FraudListResp = FraudAlertItem[] | { alerts?: FraudAlertItem[]; data?: FraudAlertItem[] };
type ReviewItem = { id: number; rating?: number; createdAt?: string };
type ReviewsResp = ReviewItem[] | { reviews?: ReviewItem[]; data?: ReviewItem[] };
type Ticket = { id: number; status?: string; createdAt?: string };
type TicketsResp = Ticket[] | { tickets?: Ticket[]; data?: Ticket[] };
type TenantBranch = { id: number; name: string; city?: string | null; isActive?: boolean };
type CompareBranchRow = {
  restaurantId: number; name: string;
  revenue: string; orders: number; avgOrderValue: string;
  expenses?: string | null; netProfit?: string | null;
  deltaPct?: number;
};
type CompareResp = { branches: CompareBranchRow[] };

// Owner/manager dashboard. super_admin is also routed here by app/index.tsx
// (they fall through to the owner stack), so include them here to avoid a
// redirect loop between "/" and "/(owner)".
const ALLOWED_ROLES = new Set(["owner", "manager", "super_admin"]);
type SortKey = "revenue" | "orders" | "name";

export default function OwnerDashboard() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user, restaurantId, tenantId } = useAuth();

  const isOwner = user?.role === "owner";
  // Owners can switch between "all outlets" and a specific outlet; managers
  // are locked to the outlet they're assigned to (enforced server-side too).
  const canSwitchScope = isOwner && tenantId != null;

  // ---- Tenant outlet list (drives the scope selector + comparison)
  const tenantBranchesQ = useQuery({
    queryKey: ["tenant-branches", tenantId],
    queryFn: () => customFetch<TenantBranch[]>(`/api/tenants/${tenantId}/branches`),
    enabled: tenantId != null,
  });
  const tenantBranches: TenantBranch[] = Array.isArray(tenantBranchesQ.data)
    ? (tenantBranchesQ.data as TenantBranch[])
    : [];
  const hasMultipleOutlets = tenantBranches.length > 1;

  // Scope: null = all outlets (tenant-wide), number = specific restaurant id.
  const [scopeOutletId, setScopeOutletId] = useState<number | null>(null);
  const [outletSort, setOutletSort] = useState<SortKey>("revenue");

  // For non-owners we always pin scope to the user's own restaurant.
  const effectiveScope: number | null = canSwitchScope ? scopeOutletId : restaurantId;
  const isAllOutlets = effectiveScope == null;
  const restaurantScopeId = effectiveScope ?? restaurantId;

  // ---- Today's KPIs — tenant or restaurant scoped depending on selection.
  const summaryQ = useQuery({
    queryKey: isAllOutlets
      ? ["tenant-summary", tenantId]
      : getGetDashboardSummaryQueryKey(restaurantScopeId),
    queryFn: () =>
      isAllOutlets
        ? customFetch<DashboardSummary>(`/api/tenants/${tenantId}/dashboard/summary`)
        : getDashboardSummary(restaurantScopeId),
    enabled: !isAllOutlets || tenantId != null,
  });

  // ---- Live orders (open + in-kitchen + ready) — restaurant-scoped only.
  // Skipped in "All outlets" mode because there is no tenant-wide live orders
  // endpoint; we surface a placeholder card instead.
  const liveOrdersQ = useQuery({
    queryKey: ["live-orders", restaurantScopeId],
    queryFn: async () => {
      const statuses = ["pending", "in_progress", "ready"] as const;
      const results = await Promise.all(
        statuses.map((s) => listOrders(restaurantScopeId, { status: s, limit: 50 })),
      );
      const counts: Record<string, number> = { pending: 0, in_progress: 0, ready: 0 };
      let all: Order[] = [];
      results.forEach((r, i) => {
        const list = (r as { data?: Order[]; total?: number });
        const arr = list.data ?? [];
        counts[statuses[i]] = list.total ?? arr.length;
        all = all.concat(arr);
      });
      return { counts, orders: all };
    },
    enabled: !isAllOutlets,
    refetchInterval: 30_000,
  });

  // ---- Revenue trend
  const trendQ = useQuery({
    queryKey: isAllOutlets
      ? ["tenant-trend", tenantId]
      : getGetRevenueTrendQueryKey(restaurantScopeId, { period: "7d" }),
    queryFn: () =>
      isAllOutlets
        ? customFetch<Array<{ date: string; revenue: string }>>(
            `/api/tenants/${tenantId}/dashboard/revenue-trend?period=7d`,
          )
        : getRevenueTrend(restaurantScopeId, { period: "7d" }),
    enabled: !isAllOutlets || tenantId != null,
  });

  // ---- The remaining cards are restaurant-scoped (no tenant aggregate API).
  const stockQ = useQuery({
    queryKey: getListInventoryItemsQueryKey(restaurantScopeId, { lowStock: true }),
    queryFn: () => listInventoryItems(restaurantScopeId, { lowStock: true }),
    enabled: !isAllOutlets,
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const attendanceQ = useQuery({
    queryKey: getListAttendanceQueryKey(restaurantScopeId, { date: todayStr }),
    queryFn: () => listAttendance(restaurantScopeId, { date: todayStr }),
    enabled: !isAllOutlets,
  });

  const cashQ = useQuery({
    queryKey: ["cash-register-current", restaurantScopeId],
    queryFn: () => customFetch<CashSession>(`/api/restaurants/${restaurantScopeId}/cash-register/current`),
    enabled: !isAllOutlets,
  });

  const fraudQ = useQuery({
    queryKey: ["fraud-alerts", restaurantScopeId],
    queryFn: () => customFetch<FraudListResp>(`/api/restaurants/${restaurantScopeId}/fraud-alerts?status=open`),
    enabled: !isAllOutlets,
    refetchInterval: 30_000,
  });

  const reviewsQ = useQuery({
    queryKey: ["reviews-feedback", restaurantScopeId],
    queryFn: () => customFetch<ReviewsResp>(`/api/restaurants/${restaurantScopeId}/reviews/feedback?limit=50`),
    enabled: !isAllOutlets,
  });

  const ticketsQ = useQuery({
    queryKey: ["support-tickets-open", restaurantScopeId],
    queryFn: () => customFetch<TicketsResp>(`/api/support/tickets?status=open&limit=50`),
    enabled: !isAllOutlets,
  });

  // Manager approvals inbox: pending discount/void/refund + ops approvals.
  // Backed by the unified /ops/approvals endpoint added on the API server,
  // which merges ops_approvals and discount_approvals into one feed.
  type ApprovalRow = { id: number; type: string; status: string };
  const approvalsQ = useQuery({
    queryKey: ["ops-approvals-pending", restaurantScopeId],
    queryFn: () => customFetch<ApprovalRow[]>(
      `/api/restaurants/${restaurantScopeId}/ops/approvals?status=pending`,
    ),
    enabled: !isAllOutlets,
    refetchInterval: 60_000,
  });

  // ---- Outlet comparison (multi-outlet owners) — fetches today and yesterday
  // in parallel so we can render a per-outlet day-over-day delta.
  const compareQ = useQuery({
    queryKey: ["compare-branches", tenantId],
    queryFn: async () => {
      const today = new Date();
      const yest = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const qs = (from: Date, to: Date) =>
        `from=${fmt(from)}T00:00:00.000Z&to=${fmt(to)}T23:59:59.999Z`;
      const [todayResp, yestResp] = await Promise.all([
        customFetch<CompareResp>(`/api/tenants/${tenantId}/dashboard/compare-branches?${qs(today, today)}`),
        customFetch<CompareResp>(`/api/tenants/${tenantId}/dashboard/compare-branches?${qs(yest, yest)}`),
      ]);
      const yMap = new Map<number, CompareBranchRow>();
      const yBranches: CompareBranchRow[] = Array.isArray(yestResp?.branches) ? yestResp.branches : [];
      const tBranches: CompareBranchRow[] = Array.isArray(todayResp?.branches) ? todayResp.branches : [];
      yBranches.forEach((r) => yMap.set(r.restaurantId, r));
      const merged = tBranches.map((r) => {
        const y = yMap.get(r.restaurantId);
        const yRev = Number(y?.revenue ?? 0);
        const tRev = Number(r.revenue ?? 0);
        const delta = yRev > 0 ? ((tRev - yRev) / yRev) * 100 : tRev > 0 ? 100 : 0;
        return { ...r, deltaPct: delta };
      });
      return { branches: merged };
    },
    enabled: canSwitchScope && hasMultipleOutlets,
  });

  const refreshAll = () => {
    summaryQ.refetch(); trendQ.refetch();
    if (!isAllOutlets) {
      liveOrdersQ.refetch(); stockQ.refetch(); attendanceQ.refetch();
      cashQ.refetch(); fraudQ.refetch(); reviewsQ.refetch(); ticketsQ.refetch();
    }
    if (tenantId != null) tenantBranchesQ.refetch();
    if (canSwitchScope && hasMultipleOutlets) compareQ.refetch();
  };

  const isRefreshing =
    summaryQ.isRefetching || trendQ.isRefetching || ticketsQ.isRefetching ||
    tenantBranchesQ.isRefetching || compareQ.isRefetching ||
    liveOrdersQ.isRefetching || stockQ.isRefetching || attendanceQ.isRefetching ||
    cashQ.isRefetching || fraudQ.isRefetching || reviewsQ.isRefetching;

  // Role gate: redirect anyone not owner/manager away.
  React.useEffect(() => {
    if (!user) return;
    if (!ALLOWED_ROLES.has(user.role)) {
      router.replace("/");
    }
  }, [user]);

  // Tap-through helpers — every action navigates to an internal mobile
  // screen. "New Order" goes to the tables grid so the user picks a table,
  // which then opens the waiter order-create flow.
  const openOrders = () => router.push("/(owner)/orders" as never);
  const openNewOrder = () => router.push("/(owner)/tables" as never);
  const openKitchen = () => router.push("/(owner)/kitchen" as never);
  const openExpenses = () => router.push("/(owner)/expenses" as never);
  const openCashRegister = () => router.push("/(owner)/finance" as never);
  const openAttendance = () => router.push("/(owner)/attendance" as never);
  const openLowStock = () => router.push("/(owner)/inventory" as never);
  const openApprovals = () => router.push("/(owner)/approvals" as never);
  const openFraud = () => router.push("/(owner)/alerts" as never);
  const openComplaints = () => router.push("/(owner)/feedback" as never);

  // ---------- Derived values ----------
  const ds = summaryQ.data as DashboardSummary | undefined;
  const todayRevenue = ds ? `₹${Number(ds.todayRevenue ?? 0).toLocaleString("en-IN")}` : null;
  const revGrowth = ds ? Number(ds.revenueGrowth ?? 0) : 0;
  const revGrowthLabel = ds
    ? `${revGrowth >= 0 ? "▲" : "▼"} ${Math.abs(revGrowth).toFixed(1)}% vs yesterday`
    : null;

  const liveOrders = useMemo(() => {
    const d = liveOrdersQ.data as { counts?: Record<string, number>; orders?: Order[] } | undefined;
    const counts = d?.counts ?? { pending: 0, in_progress: 0, ready: 0 };
    return {
      open: counts.pending ?? 0,
      inKitchen: counts.in_progress ?? 0,
      ready: counts.ready ?? 0,
      total: (counts.pending ?? 0) + (counts.in_progress ?? 0) + (counts.ready ?? 0),
    };
  }, [liveOrdersQ.data]);

  const trend = useMemo(() => {
    const raw = trendQ.data as unknown;
    const t = Array.isArray(raw) ? (raw as Array<{ date: string; revenue: string }>) : [];
    return t.slice(-7).map((p) => ({
      label: new Date(p.date).toLocaleDateString(undefined, { weekday: "narrow" }),
      value: Number(p.revenue ?? 0),
    }));
  }, [trendQ.data]);

  const stockItems = useMemo(() => {
    const items = (stockQ.data as { items?: InventoryItem[] } | InventoryItem[] | undefined);
    const arr = Array.isArray(items) ? items : items?.items ?? [];
    const low = arr.filter((i) => Number(i.currentStock ?? 0) <= Number(i.minStockLevel ?? 0));
    const out = low.filter((i) => Number(i.currentStock ?? 0) <= 0);
    return { all: arr, low, out };
  }, [stockQ.data]);

  const attendance = useMemo(() => {
    const arr = (attendanceQ.data as AttendanceRecord[] | { records?: AttendanceRecord[] } | undefined);
    const records = Array.isArray(arr) ? arr : arr?.records ?? [];
    const present = records.filter((r) => (r as { status?: string }).status === "present" || (r as { clockIn?: string }).clockIn).length;
    const onLeave = records.filter((r) => (r as { status?: string }).status === "on_leave").length;
    const absent = records.filter((r) => (r as { status?: string }).status === "absent").length;
    return { present, onLeave, absent, total: records.length };
  }, [attendanceQ.data]);

  const cash = cashQ.data as CashSession | undefined;
  const cashOpen = !!cash?.session && cash.session.status === "open";

  const fraudAlerts = useMemo(() => {
    const d = fraudQ.data as FraudListResp | undefined;
    const list = Array.isArray(d) ? d : (d?.alerts ?? d?.data ?? []);
    const open = list.filter((a) => (a.status ?? "open") !== "resolved" && (a.status ?? "open") !== "dismissed");
    return {
      high: open.filter((a) => a.severity === "high").length,
      medium: open.filter((a) => a.severity === "medium").length,
      low: open.filter((a) => a.severity === "low").length,
      total: open.length,
    };
  }, [fraudQ.data]);

  const complaints = useMemo(() => {
    const r = reviewsQ.data as ReviewsResp | undefined;
    const reviews = Array.isArray(r) ? r : (r?.reviews ?? r?.data ?? []);
    const negative = reviews.filter((x) => Number(x.rating ?? 5) <= 2).length;
    const t = ticketsQ.data as TicketsResp | undefined;
    const tickets = Array.isArray(t) ? t : (t?.tickets ?? t?.data ?? []);
    const openTickets = tickets.filter((x) => (x.status ?? "open") !== "closed" && (x.status ?? "open") !== "resolved").length;
    return { negative, openTickets };
  }, [reviewsQ.data, ticketsQ.data]);

  const outletRows = useMemo(() => {
    const rows = (compareQ.data?.branches ?? []) as CompareBranchRow[];
    const copy = [...rows];
    if (outletSort === "revenue") copy.sort((a, b) => Number(b.revenue) - Number(a.revenue));
    else if (outletSort === "orders") copy.sort((a, b) => b.orders - a.orders);
    else copy.sort((a, b) => a.name.localeCompare(b.name));
    return copy;
  }, [compareQ.data, outletSort]);

  const scopeLabel = isAllOutlets
    ? "All outlets"
    : (tenantBranches.find((b) => b.id === restaurantScopeId)?.name ?? "Outlet");

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: isWeb ? 67 + 12 : insets.top + 12, paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90 },
      ]}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refreshAll} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
            Good {getTimeOfDay()}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Today · {scopeLabel}</Text>
        </View>
        {/* Top-right Khana AI shortcut — quick entry to the chat assistant
            without scrolling to the bottom or hunting through the More menu. */}
        <Pressable
          onPress={() => router.push("/(owner)/khana-ai-chat" as never)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Open Khana AI"
          style={({ pressed }) => [
            styles.aiHeaderBtn,
            { backgroundColor: "#ede9fe", opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Ionicons name="sparkles" size={18} color="#7C3AED" />
        </Pressable>
      </View>

      {/* Outlet scope selector — owners with multiple outlets only */}
      {canSwitchScope && hasMultipleOutlets ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scopePills}
        >
          <ScopePill
            label="All outlets"
            active={scopeOutletId == null}
            onPress={() => setScopeOutletId(null)}
          />
          {tenantBranches.map((b) => (
            <ScopePill
              key={b.id}
              label={b.name}
              active={scopeOutletId === b.id}
              onPress={() => setScopeOutletId(b.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* Onboarding resume card — highlights skipped/pending setup steps */}
      <OnboardingChecklistCard />

      {/* Hero gradient card — today's headline numbers at a glance */}
      <GradientHeroCard
        title="TODAY'S PERFORMANCE"
        onPress={openOrders}
        metrics={[
          { label: "Sales", value: todayRevenue ?? "—", sub: revGrowthLabel ?? undefined },
          { label: "Orders", value: ds ? String(ds.todayOrders ?? 0) : "—", sub: liveOrders.total > 0 ? `${liveOrders.total} live` : "All clear" },
          { label: "Avg Bill", value: ds ? `₹${Number((ds as unknown as { avgOrderValue?: string }).avgOrderValue ?? 0).toLocaleString("en-IN")}` : "—" },
        ]}
      />

      {/* Pulsing new orders banner — only when there are unaccepted orders */}
      {liveOrders.open > 0 ? (
        <Pressable onPress={openOrders} style={[styles.pulseBanner, { borderColor: colors.primary, backgroundColor: colors.accent }]}>
          <View style={[styles.pulseDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.pulseText, { color: colors.foreground }]}>
            {liveOrders.open} new order{liveOrders.open === 1 ? "" : "s"} waiting · tap to accept
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </Pressable>
      ) : null}

      {/* Quick actions — tile grid */}
      <View style={styles.tileGrid}>
        <QuickActionTile icon="cash-outline" label={cashOpen ? "Close Cash" : "Open Cash"} onPress={openCashRegister} />
        <QuickActionTile icon="time-outline" label="Attendance" onPress={openAttendance} badge={attendance.absent || null} />
        <QuickActionTile icon="cube-outline" label="Low Stock" onPress={openLowStock} badge={stockItems.low.length || null} tint="#ea580c" />
        <QuickActionTile icon="checkmark-done-outline" label="Approvals" onPress={openApprovals} badge={(approvalsQ.data ?? []).length || null} />
        <QuickActionTile icon="shield-outline" label="Fraud" onPress={openFraud} badge={fraudAlerts.total || null} tint="#dc2626" />
        <QuickActionTile icon="restaurant-outline" label="Kitchen" onPress={openKitchen} badge={liveOrders.inKitchen || null} />
      </View>

      {/* Today's sales + Live orders */}
      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <MetricCard
            title="Today's Sales"
            icon="cash-outline"
            value={todayRevenue ?? undefined}
            sub={revGrowthLabel ?? undefined}
            badge={ds ? { text: `${ds.todayOrders ?? 0} orders`, tone: "info" } : undefined}
            isLoading={summaryQ.isLoading}
            isError={summaryQ.isError}
            onRetry={() => summaryQ.refetch()}
            onPress={openOrders}
            actionLabel="View orders"
          />
        </View>
        <View style={{ flex: 1 }}>
          {isAllOutlets ? (
            <PlaceholderCard
              title="Live Orders"
              icon="flame-outline"
              message="Pick an outlet to see live kitchen orders"
            />
          ) : (
            <MetricCard
              title="Live Orders"
              icon="flame-outline"
              value={liveOrdersQ.isLoading ? undefined : String(liveOrders.total)}
              sub={
                liveOrders.total > 0
                  ? `${liveOrders.open} open · ${liveOrders.inKitchen} kitchen · ${liveOrders.ready} ready`
                  : "All clear"
              }
              isLoading={liveOrdersQ.isLoading}
              isError={liveOrdersQ.isError}
              onRetry={() => liveOrdersQ.refetch()}
              onPress={openKitchen}
              actionLabel="View kitchen"
              badge={liveOrders.total > 0 ? { text: "Live", tone: "warn" } : undefined}
            />
          )}
        </View>
      </View>

      {/* Revenue chart */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Ionicons name="trending-up-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Revenue · last 7 days</Text>
          </View>
        </View>
        {trendQ.isLoading ? (
          <View style={{ height: 110, justifyContent: "center" }}>
            <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.muted, width: "60%" }} />
          </View>
        ) : trendQ.isError ? (
          <Pressable onPress={() => trendQ.refetch()} style={{ paddingVertical: 24, alignItems: "center" }}>
            <Text style={{ color: colors.mutedForeground }}>Couldn't load chart. Tap to retry.</Text>
          </Pressable>
        ) : trend.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, paddingVertical: 24, textAlign: "center" }}>
            No revenue yet.
          </Text>
        ) : (
          <MiniBarChart data={trend} />
        )}
      </View>

      {/* Staff attendance + Cash closing — restaurant-scoped */}
      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          {isAllOutlets ? (
            <PlaceholderCard title="Staff Today" icon="people-outline" message="Pick an outlet to see attendance" />
          ) : (
            <MetricCard
              title="Staff Today"
              icon="people-outline"
              value={attendanceQ.isLoading ? undefined : String(attendance.present)}
              sub={`${attendance.absent} absent · ${attendance.onLeave} on leave`}
              isLoading={attendanceQ.isLoading}
              isError={attendanceQ.isError}
              onRetry={() => attendanceQ.refetch()}
              onPress={openAttendance}
              actionLabel="View attendance"
            />
          )}
        </View>
        <View style={{ flex: 1 }}>
          {isAllOutlets ? (
            <PlaceholderCard title="Cash Register" icon="wallet-outline" message="Pick an outlet to see register" />
          ) : (
            <MetricCard
              title="Cash Register"
              icon="wallet-outline"
              value={cashQ.isLoading ? undefined : (cashOpen ? "Open" : "Closed")}
              sub={
                cashOpen
                  ? cash?.totals?.expectedCash != null
                    ? `Expected ₹${Number(cash.totals.expectedCash).toLocaleString("en-IN")}`
                    : "Session in progress"
                  : cash?.totals?.variance != null
                    ? `Variance ₹${Number(cash.totals.variance).toLocaleString("en-IN")}`
                    : "No active session"
              }
              isLoading={cashQ.isLoading}
              isError={cashQ.isError}
              onRetry={() => cashQ.refetch()}
              onPress={openCashRegister}
              actionLabel="View register"
              badge={cashOpen ? { text: "Open", tone: "ok" } : undefined}
            />
          )}
        </View>
      </View>

      {/* Stock alerts */}
      {isAllOutlets ? (
        <PlaceholderCard title="Stock Alerts" icon="cube-outline" message="Pick an outlet to see stock alerts" />
      ) : (
        <MetricCard
          title="Stock Alerts"
          icon="cube-outline"
          value={stockQ.isLoading ? undefined : `${stockItems.low.length} low · ${stockItems.out.length} out`}
          list={stockItems.low.slice(0, 3).map((i) => ({
            key: String(i.id),
            label: i.name ?? `Item #${i.id}`,
            value: `${i.currentStock ?? 0} ${i.unit ?? ""}`.trim(),
          }))}
          emptyText="All items are stocked"
          isLoading={stockQ.isLoading}
          isError={stockQ.isError}
          onRetry={() => stockQ.refetch()}
          onPress={openLowStock}
          actionLabel="View inventory"
          badge={stockItems.out.length > 0 ? { text: `${stockItems.out.length} out`, tone: "danger" } : stockItems.low.length > 0 ? { text: "Low", tone: "warn" } : undefined}
        />
      )}

      {/* Customer complaints + Fraud alerts */}
      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          {isAllOutlets ? (
            <PlaceholderCard title="Complaints" icon="chatbubble-ellipses-outline" message="Pick an outlet for reviews" />
          ) : (
            <MetricCard
              title="Complaints (open now)"
              icon="chatbubble-ellipses-outline"
              value={
                reviewsQ.isLoading || ticketsQ.isLoading
                  ? undefined
                  : String(complaints.negative + complaints.openTickets)
              }
              sub={`${complaints.negative} negative reviews · ${complaints.openTickets} open tickets`}
              emptyText="No open complaints"
              isLoading={reviewsQ.isLoading || ticketsQ.isLoading}
              isError={reviewsQ.isError || ticketsQ.isError}
              onRetry={() => { reviewsQ.refetch(); ticketsQ.refetch(); }}
              onPress={openComplaints}
              actionLabel="View complaints"
            />
          )}
        </View>
        <View style={{ flex: 1 }}>
          {isAllOutlets ? (
            <PlaceholderCard title="Fraud Alerts" icon="shield-outline" message="Pick an outlet for fraud signals" />
          ) : (
            <MetricCard
              title="Fraud Alerts"
              icon="shield-outline"
              value={fraudQ.isLoading ? undefined : String(fraudAlerts.total)}
              sub={
                fraudAlerts.total > 0
                  ? `${fraudAlerts.high} high · ${fraudAlerts.medium} med · ${fraudAlerts.low} low`
                  : "No unresolved alerts"
              }
              emptyText="No unresolved alerts"
              isLoading={fraudQ.isLoading}
              isError={fraudQ.isError}
              onRetry={() => fraudQ.refetch()}
              onPress={openFraud}
              actionLabel="View alerts"
              badge={fraudAlerts.high > 0 ? { text: "High", tone: "danger" } : fraudAlerts.total > 0 ? { text: "Open", tone: "warn" } : undefined}
            />
          )}
        </View>
      </View>

      {/* Kitchen Queue + Manager approvals */}
      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <MetricCard
            title="Kitchen Queue"
            icon="restaurant-outline"
            value={summaryQ.isLoading ? undefined : String(ds?.pendingTickets ?? 0)}
            sub={
              (ds?.pendingTickets ?? 0) > 0
                ? "tickets in progress"
                : "kitchen is clear"
            }
            isLoading={summaryQ.isLoading}
            isError={summaryQ.isError}
            onRetry={() => summaryQ.refetch()}
            onPress={openKitchen}
            actionLabel="View kitchen"
            badge={(ds?.pendingTickets ?? 0) > 0 ? { text: "Busy", tone: "warn" } : undefined}
          />
        </View>
        <View style={{ flex: 1 }}>
          {isAllOutlets ? (
            <PlaceholderCard title="Approvals" icon="checkmark-done-outline" message="Pick an outlet to see pending approvals" />
          ) : (
            <MetricCard
              title="Approvals"
              icon="checkmark-done-outline"
              value={String((approvalsQ.data ?? []).length)}
              sub={(approvalsQ.data ?? []).length === 0 ? "No pending approvals" : "Pending sign-off"}
              isLoading={approvalsQ.isLoading}
              isError={approvalsQ.isError}
              onRetry={() => approvalsQ.refetch()}
              onPress={openApprovals}
              actionLabel="Open inbox"
              badge={(approvalsQ.data ?? []).length > 0 ? { text: "Pending", tone: "warn" } : undefined}
            />
          )}
        </View>
      </View>

      {/* Outlet comparison — sortable list backed by compare-branches */}
      {canSwitchScope && hasMultipleOutlets ? (
        <View style={{ gap: 8 }}>
          <View style={styles.outletSortRow}>
            <Text style={[styles.outletSortLabel, { color: colors.mutedForeground }]}>Sort by</Text>
            <View style={styles.outletSortPills}>
              <ScopePill label="Revenue" active={outletSort === "revenue"} onPress={() => setOutletSort("revenue")} />
              <ScopePill label="Orders" active={outletSort === "orders"} onPress={() => setOutletSort("orders")} />
              <ScopePill label="Name" active={outletSort === "name"} onPress={() => setOutletSort("name")} />
            </View>
          </View>
          <MetricCard
            title="Outlets · today"
            icon="business-outline"
            list={outletRows.slice(0, 8).map((o) => {
              const d = o.deltaPct ?? 0;
              const arrow = d >= 0 ? "▲" : "▼";
              const deltaTxt = `${arrow} ${Math.abs(d).toFixed(1)}% vs yest`;
              return {
                key: String(o.restaurantId),
                label: o.name,
                value: `₹${Number(o.revenue).toLocaleString("en-IN")} · ${o.orders} ord · ${deltaTxt}`,
              };
            })}
            emptyText="No outlet activity today"
            isLoading={compareQ.isLoading}
            isError={compareQ.isError}
            onRetry={() => compareQ.refetch()}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function ScopePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.scopePill,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.primary : colors.card,
        },
      ]}
    >
      <Text
        style={[styles.scopePillText, { color: active ? "#fff" : colors.foreground }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickAction,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={24} color={colors.primary} />
      <Text style={[styles.quickLabel, { color: colors.foreground }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 14, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  aiHeaderBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
  },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  scopePills: { gap: 8, paddingVertical: 2 },
  scopePill: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, maxWidth: 200,
  },
  scopePillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  outletSortRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  outletSortLabel: { fontSize: 12, fontWeight: "500" },
  outletSortPills: { flexDirection: "row", gap: 6, flex: 1, flexWrap: "wrap" },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" },
  pulseBanner: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
  pulseDot: { width: 10, height: 10, borderRadius: 5 },
  pulseText: { flex: 1, fontSize: 13, fontFamily: "Inter_700Bold" },
  quickAction: {
    flexBasis: "23%", flexGrow: 1, minWidth: 76, minHeight: 76,
    alignItems: "center", justifyContent: "center", gap: 6,
    borderRadius: 14, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 6,
  },
  quickLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  row2: { flexDirection: "row", gap: 10 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  cardTitle: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
});
