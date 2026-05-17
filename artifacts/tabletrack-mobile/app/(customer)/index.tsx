import React, { useState, useRef } from "react";
import {
  View, Text, StyleSheet, Pressable, Platform, Alert, TextInput,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useCart } from "@/context/CartContext";

export default function QRScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { setTable } = useCart();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualMode, setManualMode] = useState(Platform.OS === "web");
  const [manualInput, setManualInput] = useState("");
  const isWeb = Platform.OS === "web";

  const handleBarcodeScan = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    try {
      const parsed = JSON.parse(data) as { restaurantId: number; tableId: number; token: string };
      if (parsed.restaurantId && parsed.tableId) {
        setTable(parsed.restaurantId, parsed.tableId, parsed.token ?? "");
        router.push(`/(customer)/menu?restaurantId=${parsed.restaurantId}&tableId=${parsed.tableId}&token=${parsed.token ?? ""}`);
      } else {
        Alert.alert("Invalid QR", "This QR code is not a valid KhanaLagao code.", [{ text: "OK", onPress: () => setScanned(false) }]);
      }
    } catch {
      Alert.alert("Invalid QR", "Could not read QR code.", [{ text: "OK", onPress: () => setScanned(false) }]);
    }
  };

  const handleManualSubmit = () => {
    // Accept either "tableId" or "restaurantId/tableId" so QR-less browsing
    // works on the web preview as well as for staff helping a customer enter
    // a code by hand. Falls back to restaurant 1 when only a table number is
    // typed (the established demo/default behavior).
    const trimmed = manualInput.trim();
    if (!trimmed) {
      Alert.alert("Enter a table", "Please enter a table number to continue.");
      return;
    }
    const parts = trimmed.split("/").map((p) => p.trim()).filter(Boolean);
    const restaurantId = parts.length >= 2 ? (parseInt(parts[0], 10) || 1) : 1;
    const tableId = parseInt(parts[parts.length - 1] || "1", 10) || 1;
    setTable(restaurantId, tableId, "demo");
    router.push(`/(customer)/menu?restaurantId=${restaurantId}&tableId=${tableId}&token=demo`);
  };

  if (manualMode || isWeb) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: isWeb ? 67 : insets.top }]}>
        <View style={styles.manualContent}>
          <View style={[styles.logoBox, { backgroundColor: colors.primary }]}>
            <Ionicons name="restaurant" size={36} color="#fff" />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>KhanaLagao</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {isWeb ? "Enter a table number to browse the menu" : "Enter a table number manually"}
          </Text>

          <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.muted }]}>
            <Ionicons name="grid-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={manualInput}
              onChangeText={setManualInput}
              placeholder="Table number (e.g. 5)"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
            />
          </View>

          <Pressable
            style={({ pressed }) => [styles.goBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            onPress={handleManualSubmit}
          >
            <Text style={styles.goBtnText}>View Menu</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </Pressable>

          {!isWeb && (
            <Pressable onPress={() => setManualMode(false)} style={styles.scanLink}>
              <Ionicons name="qr-code-outline" size={16} color={colors.primary} />
              <Text style={[styles.scanLinkText, { color: colors.primary }]}>Scan QR instead</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  if (!permission) {
    return <View style={[styles.root, { backgroundColor: colors.background }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32 }]}>
        <Ionicons name="camera-outline" size={48} color={colors.primary} />
        <Text style={[styles.permTitle, { color: colors.foreground }]}>Camera Access Needed</Text>
        <Text style={[styles.permSub, { color: colors.mutedForeground }]}>
          Allow camera access to scan table QR codes.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.goBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          onPress={requestPermission}
        >
          <Text style={styles.goBtnText}>Grant Access</Text>
        </Pressable>
        <Pressable onPress={() => setManualMode(true)} style={styles.scanLink}>
          <Text style={[styles.scanLinkText, { color: colors.primary }]}>Enter manually instead</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScan}
      />
      <View style={[styles.overlay, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.scanTitle}>Scan Table QR Code</Text>
      </View>
      <View style={styles.scanFrame}>
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />
      </View>
      {scanned && (
        <Pressable
          style={[styles.rescanBtn, { backgroundColor: colors.primary }]}
          onPress={() => setScanned(false)}
        >
          <Text style={styles.rescanText}>Tap to Scan Again</Text>
        </Pressable>
      )}
      <Pressable
        style={[styles.manualBtn, { bottom: insets.bottom + 20, backgroundColor: "rgba(0,0,0,0.6)" }]}
        onPress={() => setManualMode(true)}
      >
        <Ionicons name="keypad-outline" size={16} color="#fff" />
        <Text style={styles.manualBtnText}>Enter manually</Text>
      </Pressable>
    </View>
  );
}

const FRAME = 220;
const styles = StyleSheet.create({
  root: { flex: 1 },
  manualContent: { flex: 1, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", gap: 16 },
  logoBox: { width: 72, height: 72, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  inputWrap: {
    flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, gap: 8, width: "100%",
  },
  input: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular" },
  goBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, width: "100%",
  },
  goBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  scanLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  scanLinkText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  permTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center", marginTop: 16 },
  permSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center" },
  scanTitle: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  scanFrame: { position: "absolute", top: "50%", left: "50%", width: FRAME, height: FRAME, marginTop: -FRAME / 2, marginLeft: -FRAME / 2 },
  corner: { position: "absolute", width: 24, height: 24, borderColor: "#fff", borderWidth: 3 },
  topLeft: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  topRight: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  bottomLeft: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  bottomRight: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  rescanBtn: { position: "absolute", bottom: 120, alignSelf: "center", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  rescanText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  manualBtn: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  manualBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" },
});
