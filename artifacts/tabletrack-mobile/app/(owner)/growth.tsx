import React, { useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Platform, Pressable, TextInput } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";

type Coupon = {
  id: number;
  code: string;
  discountType: "percent" | "percentage" | "flat" | "fixed" | string;
  discountValue: string | number;
  isActive?: boolean;
  usedCount?: number;
  usageLimit?: number | null;
  validTo?: string | null;
};
type Campaign = {
  id: number;
  name: string;
  channel: string;
  status: string;
  sentCount?: number;
  openRate?: number;
};

const CHANNELS = ["email", "sms", "whatsapp", "push"] as const;
const CAMPAIGN_TYPES = ["promotion", "winback", "newsletter", "loyalty", "custom"] as const;

function GrowthScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";

  const [creatingCoupon, setCreatingCoupon] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);

  const couponsQ = useQuery({
    queryKey: ["coupons", restaurantId],
    queryFn: () => customFetch<Coupon[] | { coupons?: Coupon[] }>(`/api/restaurants/${restaurantId}/coupons`).catch(() => []),
  });
  const campaignsQ = useQuery({
    queryKey: ["campaigns", restaurantId],
    queryFn: () => customFetch<Campaign[] | { campaigns?: Campaign[] }>(`/api/restaurants/${restaurantId}/growth/campaigns`).catch(() => []),
  });
  const coupons: Coupon[] = Array.isArray(couponsQ.data) ? couponsQ.data : (couponsQ.data?.coupons ?? []);
  const campaigns: Campaign[] = Array.isArray(campaignsQ.data) ? campaignsQ.data : (campaignsQ.data?.campaigns ?? []);

  const errToast = (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not save");
  const invalidateCoupons = () => qc.invalidateQueries({ queryKey: ["coupons", restaurantId] });
  const invalidateCampaigns = () => qc.invalidateQueries({ queryKey: ["campaigns", restaurantId] });

  const createCouponM = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/api/restaurants/${restaurantId}/coupons`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setCreatingCoupon(false); invalidateCoupons(); },
    onError: errToast,
  });
  const updateCouponM = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      customFetch(`/api/restaurants/${restaurantId}/coupons/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { setEditingCoupon(null); invalidateCoupons(); },
    onError: errToast,
  });
  const deleteCouponM = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/coupons/${id}`, { method: "DELETE" }),
    onSuccess: () => { setEditingCoupon(null); invalidateCoupons(); },
    onError: errToast,
  });

  const createCampaignM = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/api/restaurants/${restaurantId}/growth/campaigns`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setCreatingCampaign(false); invalidateCampaigns(); },
    onError: errToast,
  });
  const updateCampaignM = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      customFetch(`/api/restaurants/${restaurantId}/growth/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { setEditingCampaign(null); invalidateCampaigns(); },
    onError: errToast,
  });
  const deleteCampaignM = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/growth/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => { setEditingCampaign(null); invalidateCampaigns(); },
    onError: errToast,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Growth Engine" showBack />
      <ScrollView
        refreshControl={<RefreshControl refreshing={couponsQ.isRefetching} onRefresh={() => { couponsQ.refetch(); campaignsQ.refetch(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: isWeb ? 100 : 100 }}
      >
        <SectionRow
          heading="Active campaigns"
          onAdd={() => setCreatingCampaign(true)}
          colors={colors}
        />
        {campaigns.length === 0 ? (
          <EmptyState icon="rocket-outline" title="No campaigns" message="Tap + to draft your first." />
        ) : (
          campaigns.map(c => (
            <Pressable
              key={c.id}
              onPress={() => setEditingCampaign(c)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="rocket" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.foreground }]}>{c.name}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {c.channel} · sent {c.sentCount ?? 0}
                  {c.openRate != null ? ` · ${(c.openRate * 100).toFixed(0)}% opened` : ""}
                </Text>
              </View>
              <StatusBadge label={c.status} tone={c.status === "active" ? "success" : "neutral"} />
            </Pressable>
          ))
        )}

        <SectionRow
          heading="Coupons"
          onAdd={() => setCreatingCoupon(true)}
          colors={colors}
        />
        {coupons.length === 0 ? (
          <EmptyState icon="pricetag-outline" title="No coupons" message="Tap + to create your first discount code." />
        ) : (
          coupons.map(c => (
            <Pressable
              key={c.id}
              onPress={() => setEditingCoupon(c)}
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
                  {c.usageLimit ? ` · ${c.usedCount ?? 0}/${c.usageLimit}` : c.usedCount ? ` · used ${c.usedCount}` : ""}
                </Text>
              </View>
              <StatusBadge label={c.isActive ? "Active" : "Off"} tone={c.isActive ? "success" : "neutral"} />
            </Pressable>
          ))
        )}
      </ScrollView>

      <CouponForm
        visible={creatingCoupon}
        onClose={() => setCreatingCoupon(false)}
        title="New coupon"
        submitLabel="Create"
        submitting={createCouponM.isPending}
        onSubmit={(v) => createCouponM.mutate(v)}
      />
      <CouponForm
        visible={!!editingCoupon}
        onClose={() => setEditingCoupon(null)}
        title="Edit coupon"
        submitLabel="Save changes"
        submitting={updateCouponM.isPending}
        initial={editingCoupon ?? undefined}
        editMode
        onSubmit={(v) => editingCoupon && updateCouponM.mutate({ id: editingCoupon.id, body: v })}
        onDelete={() => editingCoupon && deleteCouponM.mutate(editingCoupon.id)}
        deleting={deleteCouponM.isPending}
      />

      <CampaignForm
        visible={creatingCampaign}
        onClose={() => setCreatingCampaign(false)}
        title="New campaign"
        submitLabel="Save draft"
        submitting={createCampaignM.isPending}
        onSubmit={(v) => createCampaignM.mutate(v)}
      />
      <CampaignForm
        visible={!!editingCampaign}
        onClose={() => setEditingCampaign(null)}
        title="Edit campaign"
        submitLabel="Save changes"
        submitting={updateCampaignM.isPending}
        initial={editingCampaign ?? undefined}
        onSubmit={(v) => editingCampaign && updateCampaignM.mutate({ id: editingCampaign.id, body: v })}
        onDelete={() => editingCampaign && deleteCampaignM.mutate(editingCampaign.id)}
        deleting={deleteCampaignM.isPending}
      />
    </View>
  );
}

function SectionRow({
  heading, onAdd, colors,
}: {
  heading: string;
  onAdd: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={[styles.heading, { color: colors.foreground }]}>{heading}</Text>
      <Pressable onPress={onAdd} hitSlop={10}
        style={({ pressed }) => [
          { backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, opacity: pressed ? 0.85 : 1 },
        ]}>
        <Text style={{ color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" }}>+ New</Text>
      </Pressable>
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
      deleteConfirmMessage="Deactivate this coupon? Customers can no longer redeem it."
      deleteLabel="Deactivate coupon"
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

function CampaignForm({
  visible, onClose, title, submitLabel, submitting, initial, onSubmit, onDelete, deleting,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  submitting: boolean;
  initial?: Partial<Campaign>;
  onSubmit: (v: Record<string, unknown>) => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("promotion");
  const [channel, setChannel] = useState<string>("email");

  React.useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setChannel(initial?.channel ?? "email");
      setType("promotion");
    }
  }, [visible, initial]);

  const canSubmit = name.trim().length > 0 && !submitting;

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose} title={title}
      submitting={submitting} canSubmit={canSubmit}
      onSubmit={() => onSubmit({ name: name.trim(), type, channel })}
      submitLabel={submitLabel}
      onDelete={onDelete} deleting={deleting}
      deleteConfirmMessage="Delete this campaign and stop any pending sends?"
    >
      <FormField label="Campaign name">
        <TextInput value={name} onChangeText={setName} placeholder="e.g. Diwali Weekend Brunch"
          placeholderTextColor={colors.mutedForeground} style={formInputStyle(colors)} />
      </FormField>
      <FormField label="Type">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {CAMPAIGN_TYPES.map(t => (
            <Pressable key={t} onPress={() => setType(t)}
              style={[styles.chip, { borderColor: colors.border, backgroundColor: type === t ? colors.primary : colors.background }]}>
              <Text style={{ color: type === t ? "#fff" : colors.foreground, fontSize: 12, fontFamily: "Inter_500Medium" }}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </FormField>
      <FormField label="Channel">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {CHANNELS.map(c => (
            <Pressable key={c} onPress={() => setChannel(c)}
              style={[styles.chip, { borderColor: colors.border, backgroundColor: channel === c ? colors.primary : colors.background }]}>
              <Text style={{ color: channel === c ? "#fff" : colors.foreground, fontSize: 12, fontFamily: "Inter_500Medium" }}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </FormField>
      <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 12, fontFamily: "Inter_400Regular" }}>
        Audience targeting, copy, and launch happen on the web dashboard. Saved drafts appear here.
      </Text>
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
export default withPlanGate(GrowthScreen, "discounts_promotions");
