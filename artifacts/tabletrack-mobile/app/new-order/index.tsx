import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getRestaurant, getGetRestaurantQueryKey } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCart, type OrderTypeChoice } from "@/context/CartContext";
import { OrderTypeSelector } from "@/components/OrderTypeSelector";

export default function NewOrderTypeScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const { startOrder } = useCart();

  // Pull restaurant settings to know which extra order types are enabled.
  const settingsQ = useQuery({
    queryKey: getGetRestaurantQueryKey(restaurantId),
    queryFn: () => getRestaurant(restaurantId),
    enabled: !!restaurantId,
    staleTime: 5 * 60 * 1000,
  });
  const settings = (settingsQ.data ?? {}) as Record<string, unknown>;
  const enabled = {
    qr: !!settings.enableQrOrdering,
    curbside: !!settings.enableCurbside,
    pre_order: !!settings.enablePreorders,
  };

  const onChoose = (key: OrderTypeChoice) => {
    startOrder(key);
    if (key === "dine_in" || key === "qr") {
      router.push("/new-order/table" as never);
    } else if (key === "takeaway" || key === "delivery" || key === "curbside" || key === "pre_order") {
      router.push("/new-order/customer" as never);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, gap: 18 }}>
      <View>
        <Text style={[styles.h, { color: colors.foreground }]}>What kind of order?</Text>
        <Text style={[styles.s, { color: colors.mutedForeground }]}>Choose how the guest is ordering today.</Text>
      </View>
      <OrderTypeSelector enabled={enabled} onChoose={onChoose} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 22, fontFamily: "Inter_700Bold" },
  s: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
});
