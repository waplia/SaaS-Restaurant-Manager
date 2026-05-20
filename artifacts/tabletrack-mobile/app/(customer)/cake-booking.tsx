import React, { useState } from "react";
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator, Image, Platform,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { PhoneInput } from "@/components/PhoneInput";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

type Cake = { id: number; name: string; description: string | null; price: string; imageUrl: string | null };

export default function CakeBookingScreen() {
  const { restaurantId: rIdParam } = useLocalSearchParams<{ restaurantId: string }>();
  const restaurantId = Number(rIdParam) || 1;
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const baseUrl = `${getApiBaseUrl()}`;

  const cakesQ = useQuery<{ enabled: boolean; items: Cake[] }>({
    queryKey: ["public-cakes", restaurantId],
    queryFn: async () => {
      const r = await fetch(`${baseUrl}/api/public/restaurants/${restaurantId}/bakery/cakes`);
      if (!r.ok) throw new Error("Failed to load cakes");
      return r.json();
    },
  });

  const [selected, setSelected] = useState<Cake | null>(null);
  const [form, setForm] = useState({
    customerName: "", customerPhone: "", customerEmail: "",
    sizeLabel: "1 kg", flavor: "",
    quantity: "1",
    designNotes: "", referenceImageUrl: "",
    deliveryAt: "", deliveryAddress: "", isPickup: true,
    advanceAmount: "",
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a cake");
      if (!form.customerName || !form.customerPhone) throw new Error("Name and phone required");
      if (!form.deliveryAt) throw new Error("Delivery date required");
      const totalAmount = Number(selected.price) * (Number(form.quantity) || 1);
      const r = await fetch(`${baseUrl}/api/public/restaurants/${restaurantId}/bakery/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          quantity: Number(form.quantity) || 1,
          menuItemId: selected.id,
          cakeName: selected.name,
          totalAmount,
          advanceAmount: Number(form.advanceAmount) || Math.round(totalAmount * 0.3),
          deliveryAt: new Date(form.deliveryAt).toISOString(),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "Booking failed");
      }
      return r.json();
    },
    onSuccess: (b: { bookingNumber: string }) => {
      Alert.alert("Booking confirmed", `Your booking ${b.bookingNumber} has been received. We'll contact you shortly.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  if (cakesQ.isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!cakesQ.data?.enabled) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Ionicons name="cafe-outline" size={48} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, marginTop: 12, textAlign: "center" }}>Cake pre-orders are not available for this venue.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}>
      <Text style={[styles.h1, { color: colors.foreground }]}>Order a custom cake</Text>
      <Text style={[styles.muted, { color: colors.mutedForeground, marginBottom: 16 }]}>Pick a cake, share details and pay an advance to confirm.</Text>

      <Text style={[styles.h2, { color: colors.foreground }]}>Choose a cake</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
        {(Array.isArray(cakesQ.data?.items) ? cakesQ.data!.items : []).map(c => {
          const isSel = selected?.id === c.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => setSelected(c)}
              style={[styles.card, { backgroundColor: colors.card, borderColor: isSel ? colors.primary : colors.border }]}
            >
              {c.imageUrl ? <Image source={{ uri: c.imageUrl }} style={styles.cakeImg} /> : <View style={[styles.cakeImg, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}><Ionicons name="cafe" size={28} color={colors.mutedForeground} /></View>}
              <Text style={{ color: colors.foreground, fontWeight: "600", marginTop: 6 }} numberOfLines={1}>{c.name}</Text>
              <Text style={{ color: colors.primary, fontWeight: "700" }}>₹{Number(c.price).toFixed(0)}</Text>
            </Pressable>
          );
        })}
        {(Array.isArray(cakesQ.data?.items) ? cakesQ.data!.items : []).length === 0 && (
          <Text style={{ color: colors.mutedForeground }}>No cakes listed yet.</Text>
        )}
      </ScrollView>

      <Field label="Your name *" colors={colors}>
        <TextInput style={inputStyle(colors)} value={form.customerName} onChangeText={t => setForm(s => ({ ...s, customerName: t }))} />
      </Field>
      <Field label="Phone *" colors={colors}>
        <PhoneInput value={form.customerPhone} onChange={(v) => setForm(s => ({ ...s, customerPhone: v }))} />
      </Field>
      <Field label="Email" colors={colors}>
        <TextInput style={inputStyle(colors)} keyboardType="email-address" autoCapitalize="none" value={form.customerEmail} onChangeText={t => setForm(s => ({ ...s, customerEmail: t }))} />
      </Field>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="Size" colors={colors}><TextInput style={inputStyle(colors)} value={form.sizeLabel} onChangeText={t => setForm(s => ({ ...s, sizeLabel: t }))} placeholder="1 kg / 8 inch" placeholderTextColor={colors.mutedForeground} /></Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Flavor" colors={colors}><TextInput style={inputStyle(colors)} value={form.flavor} onChangeText={t => setForm(s => ({ ...s, flavor: t }))} placeholder="Chocolate" placeholderTextColor={colors.mutedForeground} /></Field>
        </View>
        <View style={{ width: 80 }}>
          <Field label="Qty" colors={colors}><TextInput style={inputStyle(colors)} keyboardType="number-pad" value={form.quantity} onChangeText={t => setForm(s => ({ ...s, quantity: t }))} /></Field>
        </View>
      </View>
      <Field label="Design notes (color, message, decorations)" colors={colors}>
        <TextInput style={[inputStyle(colors), { minHeight: 80, textAlignVertical: "top" }]} multiline value={form.designNotes} onChangeText={t => setForm(s => ({ ...s, designNotes: t }))} />
      </Field>
      <Field label="Reference image URL (optional)" colors={colors}>
        <TextInput style={inputStyle(colors)} autoCapitalize="none" value={form.referenceImageUrl} onChangeText={t => setForm(s => ({ ...s, referenceImageUrl: t }))} placeholder="https://…" placeholderTextColor={colors.mutedForeground} />
      </Field>
      <Field label="Pickup / Delivery date & time *" colors={colors}>
        <TextInput
          style={inputStyle(colors)}
          value={form.deliveryAt}
          onChangeText={t => setForm(s => ({ ...s, deliveryAt: t }))}
          placeholder={Platform.OS === "web" ? "YYYY-MM-DDTHH:MM" : "e.g. 2026-05-20 17:00"}
          placeholderTextColor={colors.mutedForeground}
        />
      </Field>
      <View style={{ flexDirection: "row", gap: 8, marginVertical: 8 }}>
        <Pressable onPress={() => setForm(s => ({ ...s, isPickup: true }))} style={[styles.toggle, { backgroundColor: form.isPickup ? colors.primary : colors.muted }]}>
          <Text style={{ color: form.isPickup ? colors.primaryForeground : colors.foreground }}>Pickup</Text>
        </Pressable>
        <Pressable onPress={() => setForm(s => ({ ...s, isPickup: false }))} style={[styles.toggle, { backgroundColor: !form.isPickup ? colors.primary : colors.muted }]}>
          <Text style={{ color: !form.isPickup ? colors.primaryForeground : colors.foreground }}>Delivery</Text>
        </Pressable>
      </View>
      {!form.isPickup && (
        <Field label="Delivery address" colors={colors}>
          <TextInput style={[inputStyle(colors), { minHeight: 60, textAlignVertical: "top" }]} multiline value={form.deliveryAddress} onChangeText={t => setForm(s => ({ ...s, deliveryAddress: t }))} />
        </Field>
      )}
      <Field label="Advance amount ₹ (default 30%)" colors={colors}>
        <TextInput style={inputStyle(colors)} keyboardType="numeric" value={form.advanceAmount} onChangeText={t => setForm(s => ({ ...s, advanceAmount: t }))} />
      </Field>

      {selected && (
        <View style={[styles.summary, { backgroundColor: colors.muted }]}>
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>{selected.name} × {form.quantity || 1}</Text>
          <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 18, marginTop: 2 }}>
            Total ₹{(Number(selected.price) * (Number(form.quantity) || 1)).toFixed(0)}
          </Text>
        </View>
      )}

      <Pressable
        style={[styles.cta, { backgroundColor: colors.primary, opacity: create.isPending || !selected ? 0.6 : 1 }]}
        onPress={() => create.mutate()}
        disabled={create.isPending || !selected}
      >
        {create.isPending
          ? <ActivityIndicator color={colors.primaryForeground} />
          : <Text style={{ color: colors.primaryForeground, fontWeight: "700", fontSize: 16 }}>Confirm pre-order</Text>}
      </Pressable>
    </ScrollView>
  );
}

function Field({ label, children, colors }: { label: string; children: React.ReactNode; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ marginVertical: 6 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 4 }}>{label}</Text>
      {children}
    </View>
  );
}

function inputStyle(colors: ReturnType<typeof useColors>) {
  return {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.card, color: colors.foreground,
  } as const;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  h1: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  h2: { fontSize: 14, fontWeight: "600", marginTop: 8 },
  muted: { fontSize: 13 },
  card: { padding: 8, borderRadius: 12, borderWidth: 2, marginRight: 8, width: 140 },
  cakeImg: { width: 124, height: 96, borderRadius: 8 },
  toggle: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  summary: { padding: 12, borderRadius: 8, marginTop: 12 },
  cta: { padding: 14, borderRadius: 8, alignItems: "center", marginTop: 16 },
});
