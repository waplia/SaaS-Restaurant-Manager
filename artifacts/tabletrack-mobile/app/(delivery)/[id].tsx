import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, Linking, Platform,
  ActivityIndicator, Image, TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import {
  type Assignment, STATUS_LABEL, statusBg, statusFg, fmtTime, UNAVAILABLE_REASONS,
} from "@/lib/delivery";

export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, accessToken } = useAuth();
  const qc = useQueryClient();
  const assignmentId = Number(id);
  const isWeb = Platform.OS === "web";

  const [uploading, setUploading] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");

  const { data: a, isLoading, refetch } = useQuery({
    queryKey: ["delivery-assignment", restaurantId, assignmentId],
    queryFn: () =>
      customFetch<Assignment>(`/api/restaurants/${restaurantId}/delivery/assignments/${assignmentId}`),
    enabled: !!accessToken && !!assignmentId,
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["delivery-assignment", restaurantId, assignmentId] });
    qc.invalidateQueries({ queryKey: ["my-deliveries", restaurantId] });
    qc.invalidateQueries({ queryKey: ["delivery-handovers-mine", restaurantId] });
  };

  const updateStatus = useMutation({
    mutationFn: ({ status, codCollected }: { status: string; codCollected?: boolean }) =>
      customFetch(`/api/restaurants/${restaurantId}/delivery/assignments/${assignmentId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, codCollected }),
      }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => Alert.alert("Failed", e.message),
  });

  const markCod = useMutation({
    mutationFn: () =>
      customFetch(`/api/restaurants/${restaurantId}/delivery/assignments/${assignmentId}/cod-collected`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => Alert.alert("Failed", e.message),
  });

  const markUnavailable = useMutation({
    mutationFn: (r: string) =>
      customFetch(`/api/restaurants/${restaurantId}/delivery/assignments/${assignmentId}/unavailable`, {
        method: "POST",
        body: JSON.stringify({ reason: r }),
      }),
    onSuccess: () => { invalidate(); setReasonOpen(false); router.back(); },
    onError: (e: Error) => Alert.alert("Failed", e.message),
  });

  const saveProof = useMutation({
    mutationFn: (proofPhotoUrl: string) =>
      customFetch(`/api/restaurants/${restaurantId}/delivery/assignments/${assignmentId}/proof`, {
        method: "POST",
        body: JSON.stringify({ proofPhotoUrl }),
      }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => Alert.alert("Failed", e.message),
  });

  async function uploadProofPhoto() {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      const useCamera = perm.granted;
      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (result.canceled || !result.assets?.[0]) return;
      setUploading(true);
      const asset = result.assets[0];
      const contentType = asset.mimeType ?? "image/jpeg";
      const blob = await (await fetch(asset.uri)).blob();
      const presign = await customFetch<{ uploadURL: string; objectPath: string }>(
        `/api/restaurants/${restaurantId}/storage/uploads/request-url`,
        { method: "POST", body: JSON.stringify({ name: `proof-${assignmentId}-${Date.now()}.jpg`, size: blob.size, contentType }) },
      );
      const put = await fetch(presign.uploadURL, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await customFetch(`/api/restaurants/${restaurantId}/storage/uploads/finalize`, {
        method: "POST", body: JSON.stringify({ objectPath: presign.objectPath }),
      });
      const fullUrl = `/api/restaurants/${restaurantId}/storage/objects${presign.objectPath.replace(/^\/objects/, "")}`;
      saveProof.mutate(fullUrl);
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Could not upload photo");
    } finally {
      setUploading(false);
    }
  }

  function submitReason() {
    const text = reason === "Other" ? customReason.trim() : reason;
    if (!text) return Alert.alert("Pick a reason", "Tell us why the delivery couldn't be completed.");
    markUnavailable.mutate(text);
  }

  if (isLoading || !a) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 16 }}>
        <Header onBack={() => router.back()} colors={colors} title="Loading…" />
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </View>
    );
  }

  const codAmt = Number(a.codAmount) || 0;
  const orderTotal = Number(a.order.totalAmount) || 0;
  const paid = a.order.paymentStatus === "paid";
  const address = a.order.deliveryAddress;
  const phone = a.order.customerPhone;
  const canEdit = a.status === "assigned" || a.status === "picked_up";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        onBack={() => router.back()}
        colors={colors}
        title={a.order.orderNumber}
        right={
          <View style={[styles.statusPill, { backgroundColor: statusBg(a.status) }]}>
            <Text style={[styles.statusText, { color: statusFg(a.status) }]}>{STATUS_LABEL[a.status]}</Text>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }}
        refreshControl={undefined}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.customer, { color: colors.foreground }]}>
            {a.order.customerName ?? "Customer"}
          </Text>
          {address && (
            <View style={styles.row}>
              <Ionicons name="location-outline" size={16} color={colors.mutedForeground} />
              <Text style={[styles.body, { color: colors.foreground, flex: 1 }]}>{address}</Text>
            </View>
          )}
          {a.order.notes && (
            <View style={styles.row}>
              <Ionicons name="document-text-outline" size={16} color={colors.mutedForeground} />
              <Text style={[styles.body, { color: colors.mutedForeground, flex: 1 }]}>{a.order.notes}</Text>
            </View>
          )}

          <View style={styles.actionsRow}>
            {phone && (
              <Pressable onPress={() => Linking.openURL(`tel:${phone}`).catch(() => {})}
                style={[styles.btn, { borderColor: colors.border }]}>
                <Ionicons name="call-outline" size={16} color={colors.foreground} />
                <Text style={[styles.btnText, { color: colors.foreground }]}>Call</Text>
              </Pressable>
            )}
            {address && (
              <Pressable
                onPress={() => {
                  const url = Platform.select({
                    ios: `maps:0,0?q=${encodeURIComponent(address)}`,
                    default: `https://maps.google.com/?q=${encodeURIComponent(address)}`,
                  })!;
                  Linking.openURL(url).catch(() => {});
                }}
                style={[styles.btn, { borderColor: colors.border }]}>
                <Ionicons name="navigate-outline" size={16} color={colors.foreground} />
                <Text style={[styles.btnText, { color: colors.foreground }]}>Open in Maps</Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Payment</Text>
          <View style={styles.amountsRow}>
            <View><Text style={styles.amtLabel}>Order total</Text>
              <Text style={[styles.amt, { color: colors.foreground }]}>₹{orderTotal.toFixed(2)}</Text>
            </View>
            <View><Text style={styles.amtLabel}>{paid ? "Status" : (codAmt > 0 ? "Cash to collect" : "Status")}</Text>
              <Text style={[styles.amt, { color: paid ? "#15803d" : (codAmt > 0 ? "#ea580c" : colors.foreground) }]}>
                {paid ? "Paid online" : (codAmt > 0 ? `₹${codAmt.toFixed(2)}` : "—")}
              </Text>
            </View>
          </View>
          {!paid && codAmt > 0 && (
            <Text style={{ color: a.codCollected ? "#15803d" : "#b45309", fontSize: 12, marginTop: 6 }}>
              {a.codCollected
                ? (a.codHandedIn ? "✓ Collected & handed in" : "✓ Collected — hand in at the Cash tab")
                : "Cash not collected yet"}
            </Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Timeline</Text>
          <TimelineRow label="Assigned" time={fmtTime(a.assignedAt)} done colors={colors} />
          <TimelineRow label="Picked up from restaurant" time={fmtTime(a.pickedUpAt)} done={!!a.pickedUpAt} colors={colors} />
          <TimelineRow label="Delivered" time={fmtTime(a.deliveredAt)} done={!!a.deliveredAt} colors={colors} />
          {a.status === "cancelled" && (
            <TimelineRow label={`Returned · ${a.unavailableReason ?? "cancelled"}`} time={fmtTime(a.cancelledAt)} done colors={colors} tint="#dc2626" />
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Proof of delivery</Text>
          {a.proofPhotoUrl ? (
            <Image source={{ uri: a.proofPhotoUrl }} style={styles.proofImg} resizeMode="cover" />
          ) : (
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No proof photo uploaded yet.</Text>
          )}
          {canEdit && (
            <Pressable
              onPress={uploadProofPhoto}
              disabled={uploading || saveProof.isPending}
              style={[styles.btn, { borderColor: colors.border, marginTop: 8, alignSelf: "flex-start" }]}>
              {uploading || saveProof.isPending ? (
                <ActivityIndicator size="small" color={colors.foreground} />
              ) : (
                <Ionicons name="camera-outline" size={16} color={colors.foreground} />
              )}
              <Text style={[styles.btnText, { color: colors.foreground }]}>
                {a.proofPhotoUrl ? "Replace photo" : "Take photo"}
              </Text>
            </Pressable>
          )}
        </View>

        {canEdit && (
          <View style={{ gap: 10 }}>
            {a.status === "assigned" && (
              <PrimaryBtn
                label="Pickup order from restaurant"
                icon="cube-outline"
                bg={colors.primary}
                onPress={() => updateStatus.mutate({ status: "picked_up" })}
                disabled={updateStatus.isPending}
              />
            )}
            {a.status === "picked_up" && !a.codCollected && codAmt > 0 && (
              <PrimaryBtn
                label={`Collect ₹${codAmt.toFixed(0)} cash`}
                icon="cash-outline"
                bg="#ea580c"
                onPress={() => markCod.mutate()}
                disabled={markCod.isPending}
              />
            )}
            {a.status === "picked_up" && (
              <PrimaryBtn
                label="Mark delivered"
                icon="checkmark-done-outline"
                bg="#16a34a"
                onPress={() => {
                  if (codAmt > 0 && !a.codCollected) {
                    Alert.alert(
                      "Cash not collected",
                      `This order is ₹${codAmt.toFixed(0)} COD. Mark delivered without collecting cash?`,
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Yes, delivered (no cash)", onPress: () => updateStatus.mutate({ status: "delivered", codCollected: false }) },
                      ],
                    );
                  } else {
                    updateStatus.mutate({ status: "delivered", codCollected: a.codCollected });
                  }
                }}
                disabled={updateStatus.isPending}
              />
            )}
            <Pressable
              onPress={() => setReasonOpen(true)}
              style={[styles.outlineBtn, { borderColor: "#dc2626" }]}>
              <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
              <Text style={[styles.btnText, { color: "#dc2626" }]}>Customer unavailable</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {reasonOpen && (
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReasonOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Why couldn't you deliver?</Text>
            {UNAVAILABLE_REASONS.map(r => (
              <Pressable key={r} onPress={() => setReason(r)} style={[styles.reasonRow, { borderColor: reason === r ? colors.primary : colors.border }]}>
                <Ionicons
                  name={reason === r ? "radio-button-on" : "radio-button-off"}
                  size={18}
                  color={reason === r ? colors.primary : colors.mutedForeground}
                />
                <Text style={{ color: colors.foreground, fontSize: 14 }}>{r}</Text>
              </Pressable>
            ))}
            {reason === "Other" && (
              <TextInput
                placeholder="Tell us what happened…"
                placeholderTextColor={colors.mutedForeground}
                value={customReason}
                onChangeText={setCustomReason}
                style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
                multiline
              />
            )}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Pressable onPress={() => setReasonOpen(false)} style={[styles.outlineBtn, { borderColor: colors.border, flex: 1 }]}>
                <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitReason}
                disabled={markUnavailable.isPending}
                style={[styles.outlineBtn, { borderColor: "#dc2626", backgroundColor: "#dc2626", flex: 2 }]}>
                <Text style={[styles.btnText, { color: "#fff" }]}>
                  {markUnavailable.isPending ? "Saving…" : "Return order"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function Header({ onBack, colors, title, right }: { onBack: () => void; colors: ReturnType<typeof useColors>; title: string; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  return (
    <View style={[styles.header, { paddingTop: isWeb ? 16 : insets.top + 8, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
      <Pressable onPress={onBack} hitSlop={10}>
        <Ionicons name="chevron-back" size={24} color={colors.foreground} />
      </Pressable>
      <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
      <View>{right}</View>
    </View>
  );
}

function PrimaryBtn({ label, icon, bg, onPress, disabled }: {
  label: string; icon: keyof typeof Ionicons.glyphMap; bg: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={[styles.primaryBtn, { backgroundColor: bg, opacity: disabled ? 0.6 : 1 }]}>
      <Ionicons name={icon} size={18} color="#fff" />
      <Text style={[styles.btnText, { color: "#fff", fontSize: 15 }]}>{label}</Text>
    </Pressable>
  );
}

function TimelineRow({ label, time, done, tint, colors }: {
  label: string; time: string; done: boolean; tint?: string; colors: ReturnType<typeof useColors>;
}) {
  const dotColor = tint ?? (done ? "#16a34a" : colors.border);
  return (
    <View style={styles.timelineRow}>
      <View style={[styles.timelineDot, { backgroundColor: dotColor }]} />
      <Text style={[styles.timelineLabel, { color: done ? colors.foreground : colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.timelineTime, { color: colors.mutedForeground }]}>{time}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", flex: 1 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  customer: { fontSize: 18, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  body: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  btnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12 },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  amountsRow: { flexDirection: "row", gap: 24 },
  amtLabel: { fontSize: 11, color: "#6b7280", fontFamily: "Inter_400Regular" },
  amt: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 2 },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  timelineDot: { width: 10, height: 10, borderRadius: 5 },
  timelineLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  timelineTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  proofImg: { width: "100%", height: 220, borderRadius: 10, backgroundColor: "#f1f5f9" },
  sheetWrap: { position: "absolute", inset: 0, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, borderWidth: 1, borderBottomWidth: 0, gap: 8 },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, minHeight: 70, fontSize: 14, textAlignVertical: "top" },
});
