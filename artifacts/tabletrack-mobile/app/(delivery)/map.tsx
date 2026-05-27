import React, { useMemo } from "react";
import {
  View, Text, ScrollView, StyleSheet, Pressable, Linking, Platform,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { type Assignment, STATUS_LABEL, statusDot, statusBg, statusFg, etaLabel } from "@/lib/delivery";

interface OrderCoords {
  latitude: number;
  longitude: number;
}

function getCoords(a: Assignment): OrderCoords | null {
  const lat = a.order.deliveryLat == null ? NaN : Number(a.order.deliveryLat);
  const lng = a.order.deliveryLng == null ? NaN : Number(a.order.deliveryLng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { latitude: lat, longitude: lng };
  return null;
}

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, accessToken } = useAuth();
  const isWeb = Platform.OS === "web";

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["my-deliveries", restaurantId],
    queryFn: () => customFetch<Assignment[]>(`/api/restaurants/${restaurantId}/delivery/my`),
    refetchInterval: 30_000,
    enabled: !!accessToken,
  });

  const assignments = (Array.isArray(data) ? data : []).filter(a =>
    a.status === "assigned" || a.status === "picked_up",
  );

  const pinned = useMemo(
    () => assignments
      .map(a => ({ a, coords: getCoords(a) }))
      .filter((x): x is { a: Assignment; coords: OrderCoords } => x.coords !== null),
    [assignments],
  );

  function openAllInMaps() {
    const addrs = assignments
      .map(a => a.order.deliveryAddress)
      .filter((s): s is string => !!s);
    if (addrs.length === 0) return;
    const url = `https://www.google.com/maps/dir/${addrs.map(encodeURIComponent).join("/")}`;
    Linking.openURL(url).catch(() => {});
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: isWeb ? 16 : insets.top + 8, borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Today's Route</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            {assignments.length} active {assignments.length === 1 ? "stop" : "stops"}
            {pinned.length > 0 ? ` · ${pinned.length} on map` : ""}
          </Text>
        </View>
        {assignments.length > 0 && (
          <Pressable onPress={openAllInMaps} style={[styles.headerBtn, { backgroundColor: colors.primary }]}>
            <Ionicons name="navigate-outline" size={16} color="#fff" />
            <Text style={{ color: "#fff", fontFamily: "Inter_500Medium", fontSize: 13 }}>Open route</Text>
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : assignments.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="map-outline" size={42} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No stops on the route</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Active deliveries will show up here with their stops in order.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.mapBox}>
            <MapPane pinned={pinned} colors={colors} />
            {pinned.length < assignments.length && (
              <View style={[styles.coordsBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="information-circle-outline" size={14} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 11, flex: 1 }} numberOfLines={2}>
                  {assignments.length - pinned.length} of {assignments.length} stops have no GPS coordinates yet — open them in Google Maps below.
                </Text>
              </View>
            )}
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          >
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              Stops in suggested order
            </Text>
            {assignments.map((a, i) => {
              const addr = a.order.deliveryAddress;
              const codAmt = Number(a.codAmount) || 0;
              const paid = a.order.paymentStatus === "paid";
              const eta = etaLabel(a);
              return (
                <Pressable
                  key={a.id}
                  onPress={() => router.push(`/(delivery)/${a.id}` as never)}
                  style={[styles.stopCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={[styles.stopBullet, { backgroundColor: statusDot(a.status) }]}>
                      <Text style={{ color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" }}>{i + 1}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: statusBg(a.status) }]}>
                      <Text style={[styles.statusText, { color: statusFg(a.status) }]}>{STATUS_LABEL[a.status]}</Text>
                    </View>
                    <View style={{ flex: 1 }} />
                    {!paid && codAmt > 0 && (
                      <Text style={{ color: "#ea580c", fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
                        COD ₹{codAmt.toFixed(0)}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.stopName, { color: colors.foreground }]} numberOfLines={1}>
                    {a.order.orderNumber} · {a.order.customerName ?? "Customer"}
                  </Text>
                  <Text style={[styles.stopAddr, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {addr ?? "No address on order"}
                  </Text>
                  {eta && (
                    <Text style={{
                      fontSize: 11, fontFamily: "Inter_500Medium",
                      color: eta.late ? "#dc2626" : colors.mutedForeground,
                    }}>{eta.text}</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function MapPane({ pinned, colors }: {
  pinned: { a: Assignment; coords: OrderCoords }[];
  colors: ReturnType<typeof useColors>;
}) {
  // react-native-maps doesn't render on web; we show a placeholder
  // with the pin list instead.
  if (Platform.OS === "web") {
    return (
      <View style={[styles.mapPlaceholder, { backgroundColor: colors.muted ?? "#f3f4f6", borderColor: colors.border }]}>
        <Ionicons name="map-outline" size={32} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
          Map preview is only available on the mobile app.
        </Text>
      </View>
    );
  }

  // Render real MapView on native. Loaded dynamically so that web bundles
  // don't try to evaluate native-only modules.
  let MapView: any, Marker: any, Polyline: any;
  try {
    const m = require("react-native-maps");
    MapView = m.default;
    Marker = m.Marker;
    Polyline = m.Polyline;
  } catch {
    return (
      <View style={[styles.mapPlaceholder, { backgroundColor: colors.muted ?? "#f3f4f6", borderColor: colors.border }]}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Map module not available.</Text>
      </View>
    );
  }

  // Auto-fit region around all pinned stops with a little padding.
  const region = pinned.length > 0
    ? (() => {
        const lats = pinned.map(p => p.coords.latitude);
        const lngs = pinned.map(p => p.coords.longitude);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const padLat = Math.max(0.01, (maxLat - minLat) * 0.4);
        const padLng = Math.max(0.01, (maxLng - minLng) * 0.4);
        return {
          latitude: (minLat + maxLat) / 2,
          longitude: (minLng + maxLng) / 2,
          latitudeDelta: (maxLat - minLat) + padLat * 2,
          longitudeDelta: (maxLng - minLng) + padLng * 2,
        };
      })()
    : { latitude: 12.9716, longitude: 77.5946, latitudeDelta: 0.4, longitudeDelta: 0.4 };

  const routeCoords = pinned.map(p => p.coords);

  return (
    <View style={{ flex: 1 }}>
      <MapView style={{ flex: 1 }} initialRegion={region}>
        {routeCoords.length >= 2 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={colors.primary}
            strokeWidth={3}
            lineDashPattern={[6, 4]}
          />
        )}
        {pinned.map(({ a, coords }, i) => (
          <Marker
            key={a.id}
            coordinate={coords}
            title={`${i + 1}. ${a.order.orderNumber}`}
            description={a.order.deliveryAddress ?? a.order.customerName ?? ""}
            pinColor={statusDot(a.status)}
            onCalloutPress={() => router.push(`/(delivery)/${a.id}` as never)}
          />
        ))}
      </MapView>
      {pinned.length === 0 && (
        <View style={[styles.mapOverlay, { backgroundColor: "rgba(255,255,255,0.92)" }]}>
          <Ionicons name="location-outline" size={28} color={colors.mutedForeground} />
          <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 6 }}>
            No GPS coordinates on today's orders
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center", marginTop: 2, paddingHorizontal: 24 }}>
            Use the list below to open each stop in Google Maps.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  headerBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  mapBox: { height: 260, position: "relative" },
  mapPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", borderBottomWidth: 1, gap: 4 },
  mapOverlay: {
    position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
    alignItems: "center", justifyContent: "center",
  },
  coordsBanner: {
    position: "absolute", left: 12, right: 12, bottom: 12,
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6 },
  stopCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  stopBullet: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  stopName: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  stopAddr: { fontSize: 12, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", padding: 32, gap: 6, marginTop: 40 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});
