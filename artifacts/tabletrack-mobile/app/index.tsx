import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function IndexScreen() {
  const { user, isLoading } = useAuth();
  const colors = useColors();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    const role = user.role;
    if (role === "owner" || role === "super_admin") {
      router.replace("/(owner)");
    } else if (role === "waiter") {
      router.replace("/(waiter)/(tabs)");
    } else if (role === "kitchen") {
      router.replace("/(waiter)/(tabs)/notifications");
    } else if (role === "customer") {
      router.replace("/(customer)");
    } else {
      router.replace("/(owner)");
    }
  }, [user, isLoading]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}
