import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { useColors } from "@/hooks/useColors";

export function OfflineBanner() {
  const colors = useColors();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = NetInfo.addEventListener(s => setOffline(!(s.isConnected ?? true)));
    return () => sub();
  }, []);

  if (!offline) return null;
  return (
    <View style={[styles.banner, { backgroundColor: colors.warning }]}>
      <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
      <Text style={styles.text}>Offline — actions will sync when you reconnect.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  text: { color: "#fff", fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
});
