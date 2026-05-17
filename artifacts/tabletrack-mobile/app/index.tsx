import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { roleHomePath } from "@/lib/roles";

export default function IndexScreen() {
  const { user, isLoading } = useAuth();
  const colors = useColors();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    router.replace(roleHomePath(user.role) as never);
  }, [user, isLoading]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}
