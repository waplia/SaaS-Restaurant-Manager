import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, TextInput, ScrollView, Alert, Platform } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

type LeavePolicy = {
  id: number; leaveType: string; label: string; isPaid: boolean;
  entitlementDays: number; isActive: boolean;
};
type LeaveBalance = {
  id: number; leaveType: string; year: number; opening: string; used: string;
};
type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
type LeaveRequest = {
  id: number; userId: number; leaveType: string;
  fromDate: string; toDate: string; halfDay: boolean;
  totalDays: string; reason: string | null; status: LeaveStatus;
  decisionNote: string | null; createdAt: string;
};

function apiUrl(path: string) {
  return `${getApiBaseUrl()}/api${path}`;
}
async function authFetch(token: string | null, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_COLORS: Record<LeaveStatus, { bg: string; fg: string }> = {
  pending: { bg: "#fef3c7", fg: "#92400e" },
  approved: { bg: "#dcfce7", fg: "#166534" },
  rejected: { bg: "#fee2e2", fg: "#991b1b" },
  cancelled: { bg: "#f3f4f6", fg: "#4b5563" },
};

export function LeaveSection() {
  const colors = useColors();
  const { restaurantId, accessToken } = useAuth();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: requests = [], isLoading } = useQuery<LeaveRequest[]>({
    queryKey: ["leave-requests-mine", restaurantId],
    queryFn: () => authFetch(accessToken, `/restaurants/${restaurantId}/leave-requests`) as Promise<LeaveRequest[]>,
    enabled: !!restaurantId && !!accessToken,
  });

  const { data: balances = [] } = useQuery<LeaveBalance[]>({
    queryKey: ["leave-balances-mine", restaurantId, new Date().getFullYear()],
    queryFn: () => authFetch(accessToken, `/restaurants/${restaurantId}/leave-balances?year=${new Date().getFullYear()}`) as Promise<LeaveBalance[]>,
    enabled: !!restaurantId && !!accessToken,
  });

  const cancel = useMutation({
    mutationFn: (id: number) =>
      authFetch(accessToken, `/restaurants/${restaurantId}/leave-requests/${id}/cancel`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests-mine"] });
      qc.invalidateQueries({ queryKey: ["leave-balances-mine"] });
    },
  });

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: colors.foreground }]}>My Leaves</Text>
        <TouchableOpacity
          onPress={() => setShowForm(true)}
          style={[styles.requestBtn, { backgroundColor: colors.primary }]}
        >
          <Feather name="plus" size={14} color="#fff" />
          <Text style={styles.requestBtnText}>Request</Text>
        </TouchableOpacity>
      </View>

      {balances.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.balanceRow}>
          {balances.map(b => {
            const opening = Number(b.opening);
            const used = Number(b.used);
            const remaining = Math.max(0, opening - used);
            return (
              <View key={b.id} style={[styles.balanceCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Text style={[styles.balanceType, { color: colors.mutedForeground }]}>{b.leaveType}</Text>
                <Text style={[styles.balanceValue, { color: colors.foreground }]}>{remaining}<Text style={{ fontSize: 12, color: colors.mutedForeground }}> / {opening}</Text></Text>
                <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>remaining</Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      {isLoading && <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary} />}
      {!isLoading && requests.length === 0 && (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>No leave requests yet</Text>
      )}

      {requests.map(r => {
        const sc = STATUS_COLORS[r.status];
        const canCancel = r.status === "pending" || r.status === "approved";
        return (
          <View key={r.id} style={[styles.requestRow, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <View style={styles.requestTopRow}>
                <Text style={[styles.requestType, { color: colors.foreground }]}>{r.leaveType}</Text>
                <View style={[styles.pill, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.pillText, { color: sc.fg }]}>{r.status}</Text>
                </View>
              </View>
              <Text style={[styles.requestDates, { color: colors.mutedForeground }]}>
                {fmtDate(r.fromDate)} → {fmtDate(r.toDate)}
                {r.halfDay ? " · half day" : ""}
                {" · "}{r.totalDays} day{Number(r.totalDays) === 1 ? "" : "s"}
              </Text>
              {r.reason && <Text style={[styles.requestReason, { color: colors.mutedForeground }]} numberOfLines={2}>"{r.reason}"</Text>}
              {r.decisionNote && <Text style={[styles.requestReason, { color: colors.mutedForeground }]} numberOfLines={2}>Note: {r.decisionNote}</Text>}
            </View>
            {canCancel && (
              <TouchableOpacity
                onPress={() => {
                  const doCancel = () => cancel.mutate(r.id);
                  if (Platform.OS === "web") { if (confirm("Cancel this request?")) doCancel(); }
                  else Alert.alert("Cancel request", "Are you sure?", [
                    { text: "No", style: "cancel" },
                    { text: "Yes", style: "destructive", onPress: doCancel },
                  ]);
                }}
                style={styles.cancelBtn}
              >
                <Feather name="x" size={16} color={colors.destructive} />
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      <RequestLeaveModal
        visible={showForm}
        onClose={() => setShowForm(false)}
      />
    </View>
  );
}

function RequestLeaveModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const { restaurantId, accessToken } = useAuth();
  const qc = useQueryClient();

  const { data: policies = [] } = useQuery<LeavePolicy[]>({
    queryKey: ["leave-policies-mobile", restaurantId],
    queryFn: () => authFetch(accessToken, `/restaurants/${restaurantId}/leave-policies`) as Promise<LeavePolicy[]>,
    enabled: visible && !!restaurantId && !!accessToken,
  });
  const activePolicies = policies.filter(p => p.isActive);

  const [leaveType, setLeaveType] = useState("");
  const [fromDate, setFromDate] = useState(isoToday());
  const [toDate, setToDate] = useState(isoToday());
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");

  React.useEffect(() => {
    if (visible && activePolicies.length > 0 && !leaveType) {
      setLeaveType(activePolicies[0].leaveType);
    }
  }, [visible, activePolicies, leaveType]);

  const submit = useMutation({
    mutationFn: (body: object) =>
      authFetch(accessToken, `/restaurants/${restaurantId}/leave-requests`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests-mine"] });
      qc.invalidateQueries({ queryKey: ["leave-balances-mine"] });
      setReason("");
      onClose();
    },
    onError: (err: Error) => {
      Alert.alert("Failed", err.message);
    },
  });

  const handleSubmit = () => {
    if (!leaveType) { Alert.alert("Pick a leave type"); return; }
    submit.mutate({
      leaveType,
      fromDate,
      toDate: halfDay ? fromDate : toDate,
      halfDay,
      reason: reason || undefined,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.modalOverlay]}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Request Leave</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={20} color={colors.mutedForeground} /></TouchableOpacity>
          </View>

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {activePolicies.length === 0 && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>No active leave types</Text>}
            {activePolicies.map(p => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setLeaveType(p.leaveType)}
                style={[
                  styles.typeChip,
                  { borderColor: colors.border },
                  leaveType === p.leaveType && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
              >
                <Text style={[
                  styles.typeChipText,
                  { color: colors.foreground },
                  leaveType === p.leaveType && { color: "#fff" },
                ]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>From</Text>
          <TextInput
            value={fromDate}
            onChangeText={setFromDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
          />

          {!halfDay && (
            <>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>To</Text>
              <TextInput
                value={toDate}
                onChangeText={setToDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { borderColor: colors.border, color: colors.foreground }]}
              />
            </>
          )}

          <TouchableOpacity
            onPress={() => setHalfDay(h => !h)}
            style={styles.halfDayRow}
          >
            <View style={[styles.checkbox, { borderColor: colors.border }, halfDay && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              {halfDay && <Feather name="check" size={12} color="#fff" />}
            </View>
            <Text style={[styles.halfDayText, { color: colors.foreground }]}>Half day (single date)</Text>
          </TouchableOpacity>

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Reason (optional)</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. family event"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.input, styles.textarea, { borderColor: colors.border, color: colors.foreground }]}
          />

          <View style={styles.modalActions}>
            <TouchableOpacity onPress={onClose} style={[styles.actionBtn, { borderColor: colors.border }]}>
              <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={submit.isPending}
              style={[styles.actionBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              {submit.isPending ? <ActivityIndicator color="#fff" /> : <Text style={[styles.actionBtnText, { color: "#fff" }]}>Submit</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  requestBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  requestBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  balanceRow: { marginVertical: 4 },
  balanceCard: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, minWidth: 90 },
  balanceType: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "Inter_500Medium" },
  balanceValue: { fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 2 },
  balanceLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  empty: { textAlign: "center", paddingVertical: 18, fontSize: 13, fontFamily: "Inter_400Regular" },
  requestRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10, borderTopWidth: 1 },
  requestTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  requestType: { fontSize: 13, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  requestDates: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  requestReason: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, fontStyle: "italic" },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  pillText: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  cancelBtn: { padding: 6 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  modalCard: { borderRadius: 16, borderWidth: 1, padding: 18 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 12 },
  textarea: { minHeight: 60, textAlignVertical: "top" },
  typeChip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6 },
  typeChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  halfDayRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  halfDayText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  actionBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, minWidth: 90, alignItems: "center" },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
