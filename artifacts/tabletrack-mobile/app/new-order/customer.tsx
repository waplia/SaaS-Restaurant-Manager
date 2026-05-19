import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, TextInput, Pressable } from "react-native";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useCart } from "@/context/CartContext";

export default function CustomerEntryScreen() {
  const colors = useColors();
  const { cart, attachCustomer } = useCart();
  const isDelivery = cart.orderType === "delivery";
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  const canContinue = isDelivery ? (name.trim() && phone.trim() && address.trim()) : true;

  const onContinue = () => {
    attachCustomer({ name: name.trim() || undefined, phone: phone.trim() || undefined, address: address.trim() || undefined });
    router.push("/new-order/menu" as never);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {isDelivery ? "Delivery details" : "Customer (optional)"}
      </Text>
      <Field colors={colors} label="Name" value={name} onChange={setName} placeholder="Customer name" />
      <Field colors={colors} label="Phone" value={phone} onChange={setPhone} placeholder="10-digit phone" keyboardType="phone-pad" />
      {isDelivery ? (
        <Field colors={colors} label="Delivery address" value={address} onChange={setAddress} placeholder="Door / street / area" multiline />
      ) : null}
      <Pressable
        disabled={!canContinue}
        onPress={onContinue}
        style={[styles.btn, { backgroundColor: canContinue ? colors.primary : colors.muted }]}
      >
        <Text style={[styles.btnText, { color: canContinue ? "#fff" : colors.mutedForeground }]}>Continue</Text>
      </Pressable>
      {!isDelivery ? (
        <Pressable onPress={onContinue} style={{ alignItems: "center", paddingVertical: 8 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_500Medium" }}>Skip — walk-in</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function Field({ colors, label, value, onChange, placeholder, keyboardType, multiline }: {
  colors: ReturnType<typeof useColors>; label: string; value: string;
  onChange: (s: string) => void; placeholder: string;
  keyboardType?: "default" | "phone-pad"; multiline?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        style={[styles.input, multiline && { minHeight: 70, textAlignVertical: "top" }, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  input: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_500Medium" },
  btn: { paddingVertical: 14, borderRadius: 14, alignItems: "center", marginTop: 8 },
  btnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
