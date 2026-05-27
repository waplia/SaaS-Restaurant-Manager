import React, { useMemo } from "react";
import { Modal, View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppUpdateCheck } from "@/hooks/useAppUpdateCheck";
import { useColors } from "@/hooks/useColors";

/**
 * Floating update prompt mounted at the root of the app.
 *
 * Two flavours, in priority order:
 *  1. OTA update available (expo-updates) — small bottom banner with
 *     "Restart" that fetches + reloads the JS bundle.
 *  2. Store update available — full-screen-ish soft modal with
 *     "Update now" (opens App Store / Play Store) and "Later" / "Skip
 *     this version". Cashier/owner can dismiss to keep using the app.
 *
 * Both prompts are non-blocking by design — we never trap the user.
 */
export function UpdatePrompt(): React.ReactElement | null {
  const c = useColors();
  const { store, ota, openStore, applyOta, skipThisVersion, checking } = useAppUpdateCheck();
  const [otaBusy, setOtaBusy] = React.useState(false);
  const [storeOpen, setStoreOpen] = React.useState(true);

  // Re-show the store modal whenever a *new* latest version is detected
  // (e.g. user dismissed v1.2.0, we later detect v1.2.1).
  React.useEffect(() => {
    setStoreOpen(true);
  }, [store.latestVersion]);

  const showOta = ota.available && !store.updateAvailable;
  const showStore = store.updateAvailable && storeOpen;

  const onApplyOta = async () => {
    setOtaBusy(true);
    try {
      await applyOta();
    } finally {
      setOtaBusy(false);
    }
  };

  const styles = useMemo(() => makeStyles(c), [c]);

  if (Platform.OS === "web") return null;
  if (!showOta && !showStore) return null;

  return (
    <>
      {showStore ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setStoreOpen(false)}
          statusBarTranslucent
        >
          <View style={styles.backdrop}>
            <View style={styles.card}>
              <View style={styles.iconWrap}>
                <Ionicons name="cloud-download-outline" size={32} color={c.primary} />
              </View>
              <Text style={styles.title}>Update available</Text>
              <Text style={styles.body}>
                A newer version of KhanaLagao{store.latestVersion ? ` (${store.latestVersion})` : ""} is available on the {store.source === "ios" ? "App Store" : "Play Store"}.
                {store.currentVersion ? ` You're on ${store.currentVersion}.` : ""}
              </Text>
              <Pressable
                onPress={async () => {
                  await openStore();
                  setStoreOpen(false);
                }}
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.primaryBtnText}>Update now</Text>
              </Pressable>
              <Pressable
                onPress={() => setStoreOpen(false)}
                style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.secondaryBtnText}>Later</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  await skipThisVersion();
                  setStoreOpen(false);
                }}
                style={({ pressed }) => [styles.tertiaryBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.tertiaryBtnText}>Skip this version</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}

      {showOta ? (
        <View pointerEvents="box-none" style={styles.otaWrap}>
          <View style={styles.otaBanner}>
            <Ionicons name="refresh-circle" size={20} color={c.primary} />
            <Text style={styles.otaText} numberOfLines={2}>
              A small update is ready. Restart to apply.
            </Text>
            <Pressable
              onPress={onApplyOta}
              disabled={otaBusy}
              style={({ pressed }) => [styles.otaBtn, pressed && { opacity: 0.8 }]}
            >
              {otaBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.otaBtnText}>Restart</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}
      {checking ? null : null}
    </>
  );
}

type ColorTokens = ReturnType<typeof useColors>;
function makeStyles(c: ColorTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    card: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: c.card,
      borderRadius: 20,
      padding: 24,
      alignItems: "center",
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 12,
    },
    iconWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.primary + "22",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    title: {
      fontFamily: "Inter_700Bold",
      fontSize: 20,
      color: c.text,
      marginBottom: 8,
      textAlign: "center",
    },
    body: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: c.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
      marginBottom: 20,
    },
    primaryBtn: {
      width: "100%",
      backgroundColor: c.primary,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: "center",
      marginBottom: 8,
    },
    primaryBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#fff" },
    secondaryBtn: {
      width: "100%",
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: "center",
    },
    secondaryBtnText: { fontFamily: "Inter_500Medium", fontSize: 14, color: c.text },
    tertiaryBtn: {
      width: "100%",
      paddingVertical: 8,
      alignItems: "center",
    },
    tertiaryBtnText: { fontFamily: "Inter_400Regular", fontSize: 12, color: c.mutedForeground },
    otaWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 24,
      paddingHorizontal: 16,
      alignItems: "center",
    },
    otaBanner: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.card,
      borderRadius: 14,
      paddingVertical: 10,
      paddingHorizontal: 14,
      gap: 10,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
      maxWidth: 480,
      width: "100%",
    },
    otaText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, color: c.text },
    otaBtn: {
      backgroundColor: c.primary,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 10,
    },
    otaBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },
  });
}
