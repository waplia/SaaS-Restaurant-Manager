import React, { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert,
  ActivityIndicator, Platform, RefreshControl, KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

type ExpenseCategory = { id: number; name: string; color: string; icon: string };
type Expense = {
  id: number; categoryId: number; amount: string; expenseDate: string;
  payee: string | null; paymentMethod: string | null; notes: string | null;
};
type ExpensesResponse = { data: Expense[]; total: number; totalAmount: string };

export default function MobileExpensesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { restaurantId } = useAuth();
  const qc = useQueryClient();

  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");

  const { data: cats = [] } = useQuery({
    queryKey: ["expense-categories", restaurantId],
    queryFn: () => customFetch<ExpenseCategory[]>(`/restaurants/${restaurantId}/expense-categories`),
  });

  const { data: recent, refetch, isRefetching } = useQuery({
    queryKey: ["expenses", restaurantId, "recent"],
    queryFn: () => customFetch<ExpensesResponse>(`/restaurants/${restaurantId}/expenses?limit=20`),
  });

  const createExpense = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/restaurants/${restaurantId}/expenses`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      setAmount(""); setPayee(""); setNotes(""); setCategoryId(null); setPaymentMethod("cash");
      qc.invalidateQueries({ queryKey: ["expenses"] });
      Alert.alert("Saved", "Expense recorded.");
    },
    onError: () => Alert.alert("Error", "Could not save expense."),
  });

  const handleSubmit = () => {
    if (!categoryId || !amount) {
      Alert.alert("Missing fields", "Please pick a category and enter an amount.");
      return;
    }
    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) {
      Alert.alert("Invalid amount", "Amount must be a positive number.");
      return;
    }
    createExpense.mutate({
      categoryId, amount: String(num),
      expenseDate: new Date().toISOString().slice(0, 10),
      payee: payee || undefined,
      paymentMethod,
      notes: notes || undefined,
    });
  };

  const totalToday = (recent?.data ?? [])
    .filter(e => e.expenseDate === new Date().toISOString().slice(0, 10))
    .reduce((s, e) => s + Number(e.amount), 0);

  const catMap = new Map(cats.map(c => [c.id, c]));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={[styles.root, { backgroundColor: colors.background }]}
        contentContainerStyle={[
          styles.content,
          { paddingTop: isWeb ? 67 + 16 : insets.top + 16, paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90 },
        ]}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Quick add</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Expenses</Text>
        </View>

        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Today</Text>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              ₹{totalToday.toLocaleString("en-IN")}
            </Text>
          </View>
          <Ionicons name="receipt-outline" size={28} color={colors.primary} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Record Expense</Text>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Category</Text>
          <View style={styles.chips}>
            {cats.map(c => {
              const active = categoryId === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => setCategoryId(c.id)}
                  style={[
                    styles.chip,
                    { borderColor: active ? c.color : colors.border, backgroundColor: active ? `${c.color}20` : "transparent" },
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: c.color }]} />
                  <Text style={[styles.chipText, { color: active ? c.color : colors.foreground }]}>{c.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Amount (₹)</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0.00"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Payee (optional)</Text>
          <TextInput
            value={payee}
            onChangeText={setPayee}
            placeholder="e.g. ABC Suppliers"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Payment Method</Text>
          <View style={styles.chips}>
            {["cash", "card", "upi", "bank transfer"].map(m => {
              const active = paymentMethod === m;
              return (
                <TouchableOpacity
                  key={m}
                  onPress={() => setPaymentMethod(m)}
                  style={[styles.chip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}20` : "transparent" }]}
                >
                  <Text style={[styles.chipText, { color: active ? colors.primary : colors.foreground, textTransform: "capitalize" }]}>{m}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Add a note…"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
            multiline
          />

          <TouchableOpacity
            onPress={handleSubmit}
            disabled={createExpense.isPending}
            style={[styles.button, { backgroundColor: colors.primary, opacity: createExpense.isPending ? 0.6 : 1 }]}
          >
            {createExpense.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Save Expense</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent</Text>
          {(recent?.data ?? []).slice(0, 10).map(e => {
            const cat = catMap.get(e.categoryId);
            return (
              <View key={e.id} style={[styles.expenseRow, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={[styles.dot, { backgroundColor: cat?.color ?? "#64748b" }]} />
                    <Text style={[styles.expenseCategory, { color: colors.foreground }]}>{cat?.name ?? "—"}</Text>
                  </View>
                  <Text style={[styles.expenseMeta, { color: colors.mutedForeground }]}>
                    {e.payee ?? "—"} · {e.expenseDate}
                  </Text>
                </View>
                <Text style={[styles.expenseAmount, { color: colors.foreground }]}>
                  ₹{Number(e.amount).toLocaleString("en-IN")}
                </Text>
              </View>
            );
          })}
          {(recent?.data ?? []).length === 0 && (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>No expenses yet</Text>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  header: { gap: 2 },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  statCard: { borderRadius: 14, borderWidth: 1, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statValue: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 2 },
  section: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  expenseRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1 },
  expenseCategory: { fontSize: 13, fontFamily: "Inter_500Medium" },
  expenseMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  expenseAmount: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  empty: { fontSize: 13, textAlign: "center", paddingVertical: 20 },
});
