import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import NetInfo from "@react-native-community/netinfo";

/**
 * Lightweight offline banner for the waiter app. Mirrors the web POS
 * offline pill so floor staff get the same visual signal when the
 * device drops connectivity. The mobile waiter flow currently writes
 * directly through the API client; full request-queue parity is left
 * to a follow-up task — this banner is the architectural seam for it.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setOnline(!!state.isConnected && state.isInternetReachable !== false);
    });
    return () => unsub();
  }, []);
  if (online) return null;
  return (
    <View style={{ backgroundColor: "#fee2e2", paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "#fecaca" }}>
      <Text style={{ color: "#991b1b", fontWeight: "600", fontSize: 12, textAlign: "center" }}>
        You're offline — new orders will sync once you reconnect.
      </Text>
    </View>
  );
}
