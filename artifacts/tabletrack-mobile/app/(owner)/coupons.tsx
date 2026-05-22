import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Platform, Pressable,
  TextInput, Alert,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";

// Dedicated Coupons screen with list / create / edit / delete. Mirrors the
// "Coupons" section of the Growth Engine but is accessible directly from
// the More menu so owners and managers can jump to it in one tap.

type Coupon = {
  id: number;
  code: string;
  discountType: "percent" | "percentage" | "flat" | "fixed" | string;
  discountValue: string | number;
  isActive?: boolean;
  usedCount?: number;
  usageCount?: number;
  usageLimit?: number | null;
  validTo?: string | null;
  minOrderAmount?: string | null;
  maxDiscountAmount?: string | null;
};

function CouponsScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);

  const couponsQ = useQuery({
    queryKey: ["coupons", restaurantId],
    queryFn: () => customFetch<Coupon[] | { coupons?: Coupon[] }>(`/api/restaurants/${restaurantId}/coupons`).catch(() => []),
  });
  const coupons: Coupon[] = Array.isArray(couponsQ.data) ? couponsQ.data : (couponsQ.data?.coupons ?? []);

  const errToast = (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not save");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["coupons", restaurantId] });

  const createM = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/api/restaurants/${restaurantId}/coupons`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setCreating(false); invalidate(); },
    onError: errToast,
  });
  const updateM = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      customFetch(`/api/restaurants/${restaurantId}/coupons/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });
  const deleteM = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/coupons/${id}`, { method: "DELETE" }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: errToast,
  });

  const used = (c: Coupon) => c.usedCount ?? c.usageCount ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Coupons" showBack />
      <ScrollView
        refreshControl={<RefreshControl refreshing={couponsQ.isRefetching} onRefresh={() => couponsQ.refetch()} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: isWeb ? 100 : 100 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={[styles.heading, { color: colors.foreground }]}>All coupons</Text>
          <Pressable onPress={() => setCreating(true)} hitSlop={10}
            style={({ pressed }) => [
              { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, opacity: pressed ? 0.85 : 1, flexDirection: "row", alignItems: "center", gap: 4 },
            ]}>
            <Ionicons name="add" size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" }}>New coupon</Text>
          </Pressable>
        </View>

        {coupons.length === 0 ? (
          <EmptyState icon="pricetag-outline" title="No coupons yet" message="Tap “New coupon” to create your first discount code." />
        ) : (
          coupons.map(c => (
            <Pressable
              key={c.id}
              onPress={() => setEditing(c)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="pricetag" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.foreground }]}>{c.code}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {c.discountType === "percent" || c.discountType === "percentage"
                    ? `${c.discountValue}% off`
                    : `₹${c.discountValue} off`}
                  {c.usageLimit ? ` · ${used(c)}/${c.usageLimit} used` : used(c) ? ` · used ${used(c)}` : ""}
                  {c.validTo ? ` · expires ${new Date(c.validTo).toISOString().slice(0, 10)}` : ""}
                </Text>
              </View>
              <StatusBadge label={c.isActive ? "Active" : "Off"} tone={c.isActive ? "success" : "neutral"} />
            </Pressable>
          ))
        )}
      </ScrollView>

      <CouponForm
        visible={creating}
        onClose={() => setCreating(false)}
        title="New coupon"
        submitLabel="Create"
        submitting={createM.isPending}
        onSubmit={(v) => createM.mutate(v)}
      />
      <CouponForm
        visible={!!editing}
        onClose={() => setEditing(null)}
        title="Edit coupon"
        submitLabel="Save changes"
        submitting={updateM.isPending}
        initial={editing ?? undefined}
        editMode
        onSubmit={(v) => editing && updateM.mutate({ id: editing.id, body: v })}
        onDelete={() => editing && deleteM.mutate(editing.id)}
        deleting={deleteM.isPending}
      />
    </View>
  );
}

function CouponForm({
  visible, onClose, title, submitLabel, submitting, initial, editMode, onSubmit, onDelete, deleting,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  submitting: boolean;
  initial?: Partial<Coupon>;
  editMode?: boolean;
  onSubmit: (v: Record<string, unknown>) => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const colors = useColors();
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [validTo, setValidTo] = useState("");
  const [isActive, setIsActive] = useState(true);

  React.useEffect(() => {
    if (visible) {
      setCode(initial?.code ?? "");
      const t = (initial?.discountType ?? "percentage") as string;
      setDiscountType(t === "percent" || t === "percentage" ? "percentage" : "fixed");
      setDiscountValue(initial?.discountValue ? String(initial.discountValue) : "");
      setUsageLimit(initial?.usageLimit ? String(initial.usageLimit) : "");
      setValidTo(initial?.validTo ? new Date(initial.validTo).toISOString().slice(0, 10) : "");
      setIsActive(initial?.isActive ?? true);
    }
  }, [visible, initial]);

  const canSubmit = code.trim().length > 0 && Number(discountValue) > 0 && !submitting;

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose} title={title}
      submitting={submitting} canSubmit={canSubmit}
      onSubmit={() => {
        const body: Record<string, unknown> = editMode
          ? {
              isActive,
              usageLimit: usageLimit ? Number(usageLimit) : null,
              validTo: validTo ? new Date(validTo).toISOString() : undefined,
            }
          : {
              code: code.trim().toUpperCase(),
              discountType,
              discountValue: String(Number(discountValue)),
              usageLimit: usageLimit ? Number(usageLimit) : undefined,
              validTo: validTo ? new Date(validTo).toISOString() : undefined,
            };
        onSubmit(body);
      }}
      submitLabel={submitLabel}
      onDelete={onDelete} deleting={deleting}
      deleteConfirmMessage="Delete this coupon? Customers will no longer be able to redeem it."
      deleteLabel="Delete coupon"
    >
      <FormField label="Code">
        <TextInput value={code} onChangeText={setCode} autoCapitalize="characters"
          editable={!editMode}
          placeholder="SUMMER20"
          placeholderTextColor={colors.mutedForeground}
          style={[formInputStyle(colors), editMode ? { opacity: 0.6 } : null]} />
      </FormField>
      <FormField label="Discount type">
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["percentage", "fixed"] as const).map(t => (
            <Pressable
              key={t}
              disabled={editMode}
              onPress={() => setDiscountType(t)}
              style={[styles.chip, {
                borderColor: colors.border,
                backgroundColor: discountType === t ? colors.primary : colors.background,
                opacity: editMode ? 0.6 : 1,
              }]}
            >
              <Text style={{
                color: discountType === t ? "#fff" : colors.foreground,
                fontSize: 12, fontFamily: "Inter_500Medium",
              }}>{t === "percentage" ? "Percent (%)" : "Flat (₹)"}</Text>
            </Pressable>
          ))}
        </View>
      </FormField>
      <FormField label={discountType === "percentage" ? "Discount %" : "Discount amount (₹)"}>
        <TextInput value={discountValue} onChangeText={setDiscountValue}
          keyboardType="decimal-pad"
          editable={!editMode}
          placeholderTextColor={colors.mutedForeground}
          style={[formInputStyle(colors), editMode ? { opacity: 0.6 } : null]} />
      </FormField>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <FormField label="Usage limit (optional)">
            <TextInput value={usageLimit} onChangeText={setUsageLimit} keyboardType="number-pad"
              placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
          </FormField>
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Valid until (YYYY-MM-DD)">
            <TextInput value={validTo} onChangeText={setValidTo} placeholder="2026-12-31"
              autoCapitalize="none"
              placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
          </FormField>
        </View>
      </View>
      {editMode ? (
        <FormField label="Status">
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => setIsActive(true)}
              style={[styles.chip, { borderColor: colors.border, backgroundColor: isActive ? colors.primary : colors.background }]}>
              <Text style={{ color: isActive ? "#fff" : colors.foreground, fontSize: 12, fontFamily: "Inter_500Medium" }}>Active</Text>
            </Pressable>
            <Pressable onPress={() => setIsActive(false)}
              style={[styles.chip, { borderColor: colors.border, backgroundColor: !isActive ? colors.primary : colors.background }]}>
              <Text style={{ color: !isActive ? "#fff" : colors.foreground, fontSize: 12, fontFamily: "Inter_500Medium" }}>Off</Text>
            </Pressable>
          </View>
        </FormField>
      ) : null}
    </EntityFormSheet>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 13, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
});

import { withPlanGate } from "@/components/PlanGate";
export default withPlanGate(CouponsScreen, "discounts_promotions");
