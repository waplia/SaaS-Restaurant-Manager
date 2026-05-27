import React, { useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, Platform,
  ActivityIndicator, RefreshControl, TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { type Assignment, fmtTime } from "@/lib/delivery";

interface Handover {
  id: number;
  amount: string;
  notes: string | null;
  handedInAt: string;
  rider: { id: number; name: string };
}

export default function CashScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, accessToken, user } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";

  const [amountStr, setAmountStr] = useState("");
  const [mismatchOpen, setMismatchOpen] = useState(false);
  const [mismatchReason, setMismatchReason] = useState("");

  const { data: assignments, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["my-deliveries", restaurantId],
    queryFn: () => customFetch<Assignment[]>(`/api/restaurants/${restaurantId}/delivery/my`),
    refetchInterval: 30_000,
    enabled: !!accessToken,
  });

  const { data: handovers } = useQuery({
    queryKey: ["delivery-handovers-mine", restaurantId, user?.id],
    queryFn: () => customFetch<Handover[]>(`/api/restaurants/${restaurantId}/delivery/handovers`),
    enabled: !!accessToken && !!user?.id,
  });

  const list = Array.isArray(assignments) ? assignments : [];
  const pending = list.filter(a => a.codCollected && !a.codHandedIn);
  const expected = useMemo(
    () => pending.reduce((s, a) => s + (Number(a.codAmount) || 0), 0),
    [pending],
  );

  const myHandovers = (Array.isArray(handovers) ? handovers : []).filter(h => h.rider?.id === user?.id).slice(0, 10);

  const submit = useMutation({
    mutationFn: ({ amount, notes }: { amount: number; notes?: string }) =>
      customFetch(`/api/restaurants/${restaurantId}/delivery/handovers`, {
        method: "POST",
        body: JSON.stringify({ riderId: user!.id, amount, notes }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-deliveries", restaurantId] });
      qc.invalidateQueries({ queryKey: ["delivery-handovers-mine", restaurantId] });
      setAmountStr("");
      setMismatchOpen(false);
      setMismatchReason("");
      Alert.alert("Cash handed in", "The cashier has been notified.");
    },
    onError: (e: Error) => Alert.alert("Failed", e.message),
  });

  const enteredAmount = Number(amountStr) || 0;
  const diff = enteredAmount - expected;
  const hasMismatch = amountStr !== "" && Math.abs(diff) > 0.01;

  function handleSubmit() {
    if (!user?.id) return Alert.alert("Not signed in", "Sign in again to record cash.");
    const amount = enteredAmount > 0 ? enteredAmount : expected;
    if (amount <= 0) return Alert.alert("Nothing to hand in", "You don't have any collected cash to hand over.");
    if (hasMismatch) {
      setMismatchOpen(true);
      return;
    }
    submit.mutate({ amount });
  }

  function confirmMismatch() {
    if (!mismatchReason.trim()) return Alert.alert("Reason needed", "Add a short note explaining the mismatch.");
    submit.mutate({
      amount: enteredAmount,
      notes: `Mismatch ₹${diff.toFixed(2)} (expected ₹${expected.toFixed(2)}). ${mismatchReason.trim()}`,
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: isWeb ? 16 : insets.top + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Cash Handover</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Hand collected cash to the cashier and reconcile the day.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        {isLoading && <ActivityIndicator color={colors.primary} />}

        <View style={[styles.hero, { backgroundColor: "#fff7ed", borderColor: "#fed7aa" }]}>
          <Text style={[styles.heroLabel, { color: "#9a3412" }]}>Expected cash in hand</Text>
          <Text style={[styles.heroAmt, { color: "#9a3412" }]}>₹{expected.toFixed(2)}</Text>
          <Text style={[styles.heroSub, { color: "#9a3412" }]}>
            {pending.length} {pending.length === 1 ? "order" : "orders"} collected, not yet handed in
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Counted amount</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 6 }}>
            Type the cash you're actually handing in. Leave blank to use the expected amount.
          </Text>
          <View style={[styles.inputWrap, { borderColor: colors.border }]}>
            <Text style={[styles.inputPrefix, { color: colors.mutedForeground }]}>₹</Text>
            <TextInput
              value={amountStr}
              onChangeText={setAmountStr}
              placeholder={expected.toFixed(2)}
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>
          {hasMismatch && (
            <Text style={{ color: diff < 0 ? "#dc2626" : "#b45309", fontSize: 12, marginTop: 8 }}>
              {diff < 0
                ? `Short by ₹${Math.abs(diff).toFixed(2)} — you'll be asked for a reason.`
                : `Over by ₹${diff.toFixed(2)} — you'll be asked for a reason.`}
            </Text>
          )}
          <Pressable
            onPress={handleSubmit}
            disabled={submit.isPending}
            style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 12, opacity: submit.isPending ? 0.6 : 1 }]}
          >
            <Ionicons name="cash-outline" size={18} color="#fff" />
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              {submit.isPending ? "Recording…" : "Hand cash to cashier"}
            </Text>
          </Pressable>
        </View>

        {pending.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>What's in this handover</Text>
            {pending.map(a => (
              <View key={a.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>{a.order.orderNumber}</Text>
                  <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                    {a.order.customerName ?? "Customer"} · {fmtTime(a.deliveredAt ?? a.assignedAt)}
                  </Text>
                </View>
                <Text style={[styles.rowAmt, { color: colors.foreground }]}>₹{Number(a.codAmount).toFixed(2)}</Text>
              </View>
            ))}
          </View>
        )}

        {myHandovers.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Recent handovers</Text>
            {myHandovers.map(h => (
              <View key={h.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                    ₹{Number(h.amount).toFixed(2)}
                  </Text>
                  <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {new Date(h.handedInAt).toLocaleString()}
                    {h.notes ? ` · ${h.notes}` : ""}
                  </Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color="#16a34a" />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {mismatchOpen && (
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMismatchOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {diff < 0 ? "Cash is short" : "Cash is over"}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Expected ₹{expected.toFixed(2)} · counted ₹{enteredAmount.toFixed(2)}
              {"  "}
              (<Text style={{ color: diff < 0 ? "#dc2626" : "#b45309" }}>{diff < 0 ? "-" : "+"}₹{Math.abs(diff).toFixed(2)}</Text>)
            </Text>
            <TextInput
              placeholder="Why is the cash different? (e.g. tip kept by customer, change shortage)"
              placeholderTextColor={colors.mutedForeground}
              value={mismatchReason}
              onChangeText={setMismatchReason}
              style={[styles.inputBig, { borderColor: colors.border, color: colors.foreground }]}
              multiline
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Pressable onPress={() => setMismatchOpen(false)} style={[styles.outlineBtn, { borderColor: colors.border, flex: 1 }]}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmMismatch} disabled={submit.isPending}
                style={[styles.outlineBtn, { borderColor: colors.primary, backgroundColor: colors.primary, flex: 2 }]}>
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                  {submit.isPending ? "Saving…" : "Record with reason"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  hero: { borderWidth: 1, borderRadius: 14, padding: 16, alignItems: "flex-start" },
  heroLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  heroAmt: { fontSize: 36, fontFamily: "Inter_700Bold", marginTop: 4 },
  heroSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 48 },
  inputPrefix: { fontSize: 18, fontFamily: "Inter_500Medium", marginRight: 6 },
  input: { flex: 1, fontSize: 20, fontFamily: "Inter_600SemiBold" },
  inputBig: { borderWidth: 1, borderRadius: 10, padding: 10, minHeight: 70, fontSize: 14, textAlignVertical: "top", marginTop: 10 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10, borderBottomWidth: 1 },
  rowTitle: { fontSize: 14, fontFamily: "Inter_500Medium" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  rowAmt: { fontSize: 15, fontFamily: "Inter_700Bold" },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5 },
  sheetWrap: { position: "absolute", inset: 0, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, borderWidth: 1, borderBottomWidth: 0, gap: 6 },
});
