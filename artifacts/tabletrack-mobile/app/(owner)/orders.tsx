import React, { useMemo, useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, RefreshControl, Platform, ScrollView, TextInput, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  customFetch, getListOrdersQueryKey,
} from "@workspace/api-client-react";
import type { Order } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { OrderCard } from "@/components/OrderCard";
import { OrderDetailDrawer } from "@/components/OrderDetailDrawer";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";

type StatusFilter = "all" | "new" | "preparing" | "ready" | "completed";
type TypeFilter = "all" | "qr" | "dine_in" | "takeaway" | "delivery";
type DateFilter = "today" | "yesterday" | "7d" | "30d" | "this_month" | "custom" | "all";
type CustomRange = { from: Date; to: Date };

const STATUS_CHIPS: { key: StatusFilter; label: string; tone?: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New", tone: "#f97316" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready", tone: "#16a34a" },
  { key: "completed", label: "Completed" },
];
const TYPE_CHIPS: { key: TypeFilter; label: string; icon?: keyof typeof Ionicons.glyphMap }[] = [
  { key: "all", label: "All types" },
  { key: "qr", label: "QR", icon: "qr-code-outline" },
  { key: "dine_in", label: "Dine-in", icon: "restaurant-outline" },
  { key: "takeaway", label: "Takeaway", icon: "bag-handle-outline" },
  { key: "delivery", label: "Delivery", icon: "bicycle-outline" },
];
const DATE_CHIPS: { key: DateFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "this_month", label: "This month" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom range" },
];

function rangeFor(d: DateFilter, custom: CustomRange | null): { since: string | null; until: string | null } {
  const now = new Date();
  const sod = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const eod = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate(), 23, 59, 59, 999);
  if (d === "all") return { since: null, until: null };
  if (d === "today") return { since: sod(now).toISOString(), until: eod(now).toISOString() };
  if (d === "yesterday") {
    const y = new Date(now); y.setDate(now.getDate() - 1);
    return { since: sod(y).toISOString(), until: eod(y).toISOString() };
  }
  if (d === "7d") return { since: sod(new Date(now.getTime() - 6 * 86400000)).toISOString(), until: eod(now).toISOString() };
  if (d === "30d") return { since: sod(new Date(now.getTime() - 29 * 86400000)).toISOString(), until: eod(now).toISOString() };
  if (d === "this_month") return { since: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), until: eod(now).toISOString() };
  if (d === "custom" && custom) return { since: sod(custom.from).toISOString(), until: eod(custom.to).toISOString() };
  return { since: null, until: null };
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dateFilterLabel(d: DateFilter, custom: CustomRange | null): string {
  if (d === "custom") {
    if (!custom) return "Custom range";
    return `${fmtShort(custom.from)} – ${fmtShort(custom.to)}`;
  }
  return DATE_CHIPS.find((c) => c.key === d)?.label ?? d;
}

export default function OrdersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const qc = useQueryClient();
  const { restaurantId, effectiveBranchId } = useAuth();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [dateRange, setDateRange] = useState<DateFilter>("today");
  const [customRange, setCustomRange] = useState<CustomRange | null>(null);
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // Free-text search box. Debounced so we don't hammer the server on every
  // keystroke, and trimmed/lower-bounded so a single character doesn't run
  // a near-unbounded ILIKE on the orders table.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  React.useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = searchInput.trim();
      setSearch(trimmed.length >= 2 ? trimmed : "");
    }, 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const statusLabel = STATUS_CHIPS.find((c) => c.key === status)?.label ?? status;
  const typeLabel = TYPE_CHIPS.find((c) => c.key === type)?.label ?? type;
  const dateLabel = dateFilterLabel(dateRange, customRange);

  const activeChips: { key: string; label: string; onClear: () => void }[] = [];
  if (dateRange !== "today") activeChips.push({ key: "date", label: dateLabel, onClear: () => { setDateRange("today"); setCustomRange(null); } });
  if (status !== "all") activeChips.push({ key: "status", label: statusLabel, onClear: () => setStatus("all") });
  if (type !== "all") activeChips.push({ key: "type", label: typeLabel, onClear: () => setType("all") });
  const activeFilterCount = activeChips.length;

  // Map "new" filter to pending API status.
  const apiStatus = status === "new" ? "pending" : status === "preparing" ? "in_progress" : status;
  const { since, until } = rangeFor(dateRange, customRange);
  // Server-side type filter when possible. "qr" is a sourceChannel, not an
  // orderType, so it still falls through to the client-side filter below.
  const apiOrderType: string | null = type === "all" || type === "qr" ? null : type;
  const params: Record<string, unknown> = { limit: 50 };
  if (apiStatus !== "all") params.status = apiStatus;
  if (apiOrderType) params.orderType = apiOrderType;
  if (since) params.since = since;
  if (until) params.until = until;
  if (search) params.search = search;
  if (effectiveBranchId != null) params.branchId = effectiveBranchId;

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: getListOrdersQueryKey(restaurantId, params),
    queryFn: () => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v != null && v !== "") qs.set(k, String(v));
      });
      return customFetch<{ data?: Order[]; total?: number }>(
        `/api/restaurants/${restaurantId}/orders?${qs.toString()}`,
      );
    },
    refetchInterval: 20_000,
  });

  const orders = useMemo(() => {
    const raw = (data as { data?: Order[]; orders?: Order[] } | null);
    const list = raw?.data ?? raw?.orders ?? (Array.isArray(data) ? (data as Order[]) : []);
    if (type === "all") return list;
    return (list as Order[]).filter((o) => {
      const t = (o.orderType ?? "dine_in") as string;
      const src = ((o as unknown as { sourceChannel?: string }).sourceChannel ?? "").toLowerCase();
      if (type === "qr") return src === "qr" || src === "self-order" || src === "self_order";
      return t === type;
    });
  }, [data, type]);

  const acceptMut = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/orders/${id}`, {
      method: "PATCH", body: JSON.stringify({ status: "in_progress" }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: getListOrdersQueryKey(restaurantId) }),
    onError: () => Alert.alert("Couldn't accept", "Try again."),
  });
  const rejectMut = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/orders/${id}`, {
      method: "PATCH", body: JSON.stringify({ status: "cancelled" }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: getListOrdersQueryKey(restaurantId) }),
    onError: () => Alert.alert("Couldn't reject", "Try again."),
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: isWeb ? 67 : insets.top, borderBottomColor: colors.border }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Orders</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>Tap a card to view · accept new orders inline</Text>
          </View>
          <Pressable onPress={() => router.push("/new-order" as never)} style={[styles.headerCta, { backgroundColor: colors.primary }]}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.headerCtaText}>New</Text>
          </Pressable>
        </View>

        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search order #, customer name or phone"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search orders"
          />
          {searchInput.length > 0 ? (
            <Pressable onPress={() => setSearchInput("")} accessibilityLabel="Clear search" hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setFilterSheetOpen(true)}
            style={[styles.filterBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            accessibilityLabel="Open filters"
          >
            <Ionicons name="options-outline" size={16} color={colors.foreground} />
            <Text style={[styles.filterBtnText, { color: colors.foreground }]}>Filters</Text>
            {activeFilterCount > 0 ? (
              <View style={[styles.filterBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            ) : null}
          </Pressable>

          {activeChips.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {activeChips.map((c) => (
                <Pressable
                  key={c.key}
                  onPress={c.onClear}
                  style={[styles.activeChip, { backgroundColor: colors.primary }]}
                  accessibilityLabel={`Clear ${c.key} filter`}
                >
                  <Text style={styles.activeChipText}>{c.label}</Text>
                  <Ionicons name="close" size={12} color="#fff" />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      </View>

      <FilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        status={status}
        type={type}
        dateRange={dateRange}
        customRange={customRange}
        onApply={(next) => {
          setStatus(next.status);
          setType(next.type);
          setDateRange(next.dateRange);
          setCustomRange(next.customRange);
          setFilterSheetOpen(false);
        }}
        onReset={() => {
          setStatus("all");
          setType("all");
          setDateRange("today");
          setCustomRange(null);
        }}
      />

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : orders.length === 0 ? (
        <EmptyState icon="receipt-outline" title="No orders" message="Orders will appear here when placed." />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => String(o.id)}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          renderItem={({ item: o }) => {
            const isNew = (o.status ?? "pending") === "pending";
            return (
              <View style={{ marginBottom: 10 }}>
                <Pressable onPress={() => setOpenOrderId(o.id)}>
                  <OrderCard
                    orderNumber={o.orderNumber ?? String(o.id)}
                    displayNumber={(o as unknown as { orderDisplayNumber?: string | null }).orderDisplayNumber ?? null}
                    internalNumber={(o as unknown as { orderInternalNumber?: string | null }).orderInternalNumber ?? null}
                    tableLabel={(o as unknown as { tableLabel?: string | null }).tableLabel}
                    itemCount={(o as { items?: unknown[] }).items?.length ?? 0}
                    total={o.totalAmount ?? 0}
                    status={o.status ?? "pending"}
                    orderType={o.orderType ?? "dine_in"}
                    createdAt={o.createdAt ?? new Date().toISOString()}
                  />
                </Pressable>
                {isNew ? (
                  <View style={styles.actionRow}>
                    <Pressable
                      disabled={rejectMut.isPending}
                      onPress={() => Alert.alert("Reject order?", `Order #${o.orderNumber ?? o.id}`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Reject", style: "destructive", onPress: () => rejectMut.mutate(o.id) },
                      ])}
                      style={[styles.rejectBtn, { borderColor: colors.border }]}
                    >
                      <Ionicons name="close" size={14} color={colors.destructive} />
                      <Text style={[styles.rejectText, { color: colors.destructive }]}>Reject</Text>
                    </Pressable>
                    <Pressable
                      disabled={acceptMut.isPending}
                      onPress={() => acceptMut.mutate(o.id)}
                      style={[styles.acceptBtn, { backgroundColor: colors.primary }]}
                    >
                      <Ionicons name="checkmark" size={14} color="#fff" />
                      <Text style={styles.acceptText}>Accept</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
      <OrderDetailDrawer orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  sub: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  headerCta: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  headerCtaText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 38, borderRadius: 10, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", paddingVertical: 0 },
  pills: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 36, borderRadius: 10, borderWidth: 1 },
  filterBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  filterBadge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  filterBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  chipsRow: { gap: 6, paddingRight: 8, alignItems: "center" },
  activeChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 10, paddingRight: 6, height: 28, borderRadius: 999 },
  activeChipText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, maxHeight: "85%" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 8, marginBottom: 8 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sheetSection: { paddingVertical: 12, borderTopWidth: 1 },
  sheetSectionTitle: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  sheetChipsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sheetFooter: { flexDirection: "row", gap: 10, paddingTop: 14, paddingBottom: 4 },
  sheetResetBtn: { flex: 1, alignItems: "center", justifyContent: "center", height: 46, borderRadius: 12, borderWidth: 1 },
  sheetResetText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sheetApplyBtn: { flex: 2, alignItems: "center", justifyContent: "center", height: 46, borderRadius: 12 },
  sheetApplyText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  customRangeRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  customDateBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  customDateLabel: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  customDateValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  list: { padding: 16 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  rejectBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  rejectText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  acceptBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: 10 },
  acceptText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
});

interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  status: StatusFilter;
  type: TypeFilter;
  dateRange: DateFilter;
  customRange: CustomRange | null;
  onApply: (next: { status: StatusFilter; type: TypeFilter; dateRange: DateFilter; customRange: CustomRange | null }) => void;
  onReset: () => void;
}

function FilterSheet({ visible, onClose, status, type, dateRange, customRange, onApply, onReset }: FilterSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [draftStatus, setDraftStatus] = useState<StatusFilter>(status);
  const [draftType, setDraftType] = useState<TypeFilter>(type);
  const [draftDate, setDraftDate] = useState<DateFilter>(dateRange);
  const [draftCustom, setDraftCustom] = useState<CustomRange>(() => {
    const now = new Date();
    const from = customRange?.from ?? new Date(now.getTime() - 6 * 86400000);
    const to = customRange?.to ?? now;
    return { from, to };
  });
  const [showPicker, setShowPicker] = useState<null | "from" | "to">(null);

  React.useEffect(() => {
    if (visible) {
      setDraftStatus(status);
      setDraftType(type);
      setDraftDate(dateRange);
      const now = new Date();
      setDraftCustom({
        from: customRange?.from ?? new Date(now.getTime() - 6 * 86400000),
        to: customRange?.to ?? now,
      });
      setShowPicker(null);
    }
  }, [visible, status, type, dateRange, customRange]);

  const handlePickerChange = (which: "from" | "to") => (event: DateTimePickerEvent, selected?: Date) => {
    // Android dismisses the picker after a selection; iOS keeps it inline.
    if (Platform.OS !== "ios") setShowPicker(null);
    if (event.type === "dismissed" || !selected) return;
    setDraftCustom((prev) => {
      const next = { ...prev, [which]: selected } as CustomRange;
      // Keep from <= to.
      if (next.from > next.to) {
        if (which === "from") next.to = next.from;
        else next.from = next.to;
      }
      return next;
    });
  };

  const renderChip = <T extends string>(active: boolean, label: string, onPress: () => void, key: T) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={[
        styles.pill,
        { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.card },
      ]}
    >
      <Text style={[styles.pillText, { color: active ? "#fff" : colors.foreground }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 12 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Filters</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close filters">
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={[styles.sheetSection, { borderTopColor: colors.border }]}>
              <Text style={[styles.sheetSectionTitle, { color: colors.mutedForeground }]}>Date range</Text>
              <View style={styles.sheetChipsGrid}>
                {DATE_CHIPS.map((c) => renderChip(draftDate === c.key, c.label, () => setDraftDate(c.key), c.key))}
              </View>
              {draftDate === "custom" ? (
                <View style={styles.customRangeRow}>
                  <Pressable
                    onPress={() => setShowPicker(showPicker === "from" ? null : "from")}
                    style={[styles.customDateBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  >
                    <Text style={[styles.customDateLabel, { color: colors.mutedForeground }]}>From</Text>
                    <Text style={[styles.customDateValue, { color: colors.foreground }]}>{fmtShort(draftCustom.from)}, {draftCustom.from.getFullYear()}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setShowPicker(showPicker === "to" ? null : "to")}
                    style={[styles.customDateBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  >
                    <Text style={[styles.customDateLabel, { color: colors.mutedForeground }]}>To</Text>
                    <Text style={[styles.customDateValue, { color: colors.foreground }]}>{fmtShort(draftCustom.to)}, {draftCustom.to.getFullYear()}</Text>
                  </Pressable>
                </View>
              ) : null}
              {showPicker ? (
                <DateTimePicker
                  value={showPicker === "from" ? draftCustom.from : draftCustom.to}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  maximumDate={new Date()}
                  onChange={handlePickerChange(showPicker)}
                />
              ) : null}
            </View>

            <View style={[styles.sheetSection, { borderTopColor: colors.border }]}>
              <Text style={[styles.sheetSectionTitle, { color: colors.mutedForeground }]}>Status</Text>
              <View style={styles.sheetChipsGrid}>
                {STATUS_CHIPS.map((c) => renderChip(draftStatus === c.key, c.label, () => setDraftStatus(c.key), c.key))}
              </View>
            </View>

            <View style={[styles.sheetSection, { borderTopColor: colors.border }]}>
              <Text style={[styles.sheetSectionTitle, { color: colors.mutedForeground }]}>Order type</Text>
              <View style={styles.sheetChipsGrid}>
                {TYPE_CHIPS.map((c) => renderChip(draftType === c.key, c.label, () => setDraftType(c.key), c.key))}
              </View>
            </View>
          </ScrollView>

          <View style={styles.sheetFooter}>
            <Pressable
              onPress={() => {
                setDraftStatus("all");
                setDraftType("all");
                setDraftDate("today");
                setShowPicker(null);
                onReset();
              }}
              style={[styles.sheetResetBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.sheetResetText, { color: colors.foreground }]}>Reset</Text>
            </Pressable>
            <Pressable
              onPress={() => onApply({
                status: draftStatus,
                type: draftType,
                dateRange: draftDate,
                customRange: draftDate === "custom" ? draftCustom : null,
              })}
              style={[styles.sheetApplyBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.sheetApplyText}>Apply filters</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
