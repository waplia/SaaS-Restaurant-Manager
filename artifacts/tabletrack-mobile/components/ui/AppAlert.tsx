import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, Platform, Alert as RNAlert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

type AlertTone = "default" | "destructive" | "success" | "warning";

export interface AlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void | Promise<void>;
}

interface AlertOptions {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  tone?: AlertTone;
  cancelable?: boolean;
  /** Called when the dialog is dismissed without a button press (backdrop / back). */
  onDismiss?: () => void;
}

interface AlertCtx {
  show: (opts: AlertOptions) => void;
  confirm: (
    title: string,
    message?: string,
    opts?: { confirmText?: string; cancelText?: string; destructive?: boolean },
  ) => Promise<boolean>;
}

const Ctx = createContext<AlertCtx | null>(null);

interface QueueItem extends AlertOptions {
  _id: number;
}

// Module-level imperative handler (set by <AppAlertProvider>). Declared
// here — *above* the provider — so the provider's effect can reference it
// without hitting the TDZ / hoisting issue seen in the React Native
// bundler when these were declared later in the file.
type Handler = (opts: AlertOptions) => void;
let __handler: Handler | null = null;
function __setAlertHandler(h: Handler | null) {
  __handler = h;
}

/**
 * Wrap the app once. Provides a themed Android/iOS-consistent alert dialog
 * that fully replaces React Native's platform `Alert.alert`. Uses the same
 * orange brand palette, Inter typography and `AppModal`-style card.
 */
export function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const seqRef = useRef(0);

  const show = useCallback((opts: AlertOptions) => {
    seqRef.current += 1;
    const item: QueueItem = { _id: seqRef.current, ...opts };
    setQueue((q) => [...q, item]);
  }, []);

  // Register the module-level imperative handler so `Alert.alert(...)`
  // imported from this module works anywhere (including outside the React
  // tree — e.g. utility modules, mutation onError callbacks). On unmount
  // we fall back to the native dialog rather than silently swallowing the
  // call.
  useEffect(() => {
    __setAlertHandler(show);
    return () => __setAlertHandler(null);
  }, [show]);

  const confirm = useCallback(
    (title: string, message?: string, opts?: { confirmText?: string; cancelText?: string; destructive?: boolean }) =>
      new Promise<boolean>((resolve) => {
        // Guard against double-resolution: backdrop/back dismiss AND button
        // press would both fire otherwise, leaving the awaiter in a
        // deterministic-but-wrong state.
        let settled = false;
        const settle = (v: boolean) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };
        show({
          title,
          message,
          tone: opts?.destructive ? "destructive" : "default",
          buttons: [
            { text: opts?.cancelText ?? "Cancel", style: "cancel", onPress: () => settle(false) },
            {
              text: opts?.confirmText ?? "OK",
              style: opts?.destructive ? "destructive" : "default",
              onPress: () => settle(true),
            },
          ],
          // Backdrop tap / Android back / `onRequestClose` all dismiss the
          // dialog without firing a button. Treat that as "cancel" so the
          // awaited Promise always resolves.
          onDismiss: () => settle(false),
        });
      }),
    [show],
  );

  const value = useMemo<AlertCtx>(() => ({ show, confirm }), [show, confirm]);

  const dismissTop = useCallback(() => {
    setQueue((q) => {
      const [head, ...rest] = q;
      // Fire the dismiss hook BEFORE removing the item from state so any
      // awaiter (e.g. confirm() promise) is settled before re-render.
      head?.onDismiss?.();
      return rest;
    });
  }, []);
  const top = queue[0];

  return (
    <Ctx.Provider value={value}>
      {children}
      <AlertDialog item={top} onDismiss={dismissTop} />
    </Ctx.Provider>
  );
}

function AlertDialog({ item, onDismiss }: { item?: QueueItem; onDismiss: () => void }) {
  const colors = useColors();
  if (!item) return null;

  const buttons: AlertButton[] = item.buttons && item.buttons.length > 0 ? item.buttons : [{ text: "OK" }];
  const cancelable = item.cancelable !== false;

  const iconForTone = (): { name: keyof typeof Ionicons.glyphMap; color: string; bg: string } => {
    switch (item.tone) {
      case "destructive":
        return { name: "alert-circle", color: "#dc2626", bg: "#fee2e2" };
      case "success":
        return { name: "checkmark-circle", color: "#16a34a", bg: "#dcfce7" };
      case "warning":
        return { name: "warning", color: "#d97706", bg: "#fef3c7" };
      default:
        return { name: "information-circle", color: colors.primary, bg: colors.primary + "1f" };
    }
  };
  const ico = iconForTone();

  const handlePress = async (btn: AlertButton) => {
    // Fire the button handler FIRST (synchronously kicking off any awaited
    // work like confirm()'s `settle(true)`), then dismiss. Doing it the
    // other way around causes `onDismiss` to settle the confirm() promise
    // with `false` *before* the button's handler can settle it with `true`.
    try {
      await btn.onPress?.();
    } catch {
      // swallow — alert UI shouldn't bubble button handler errors
    }
    onDismiss();
  };

  return (
    <Modal
      visible
      transparent
      animationType={Platform.OS === "ios" ? "fade" : "fade"}
      onRequestClose={() => cancelable && onDismiss()}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: "rgba(0,0,0,0.45)" }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => cancelable && onDismiss()} />
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: "#000",
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: ico.bg }]}>
            <Ionicons name={ico.name} size={28} color={ico.color} />
          </View>
          <View style={{ alignItems: "center", gap: 6 }}>
            <View style={styles.titleRow}>
              <Pressable disabled style={{ flex: 1 }}>
                <Title text={item.title} color={colors.foreground} />
              </Pressable>
            </View>
            {item.message ? <Body text={item.message} color={colors.mutedForeground} /> : null}
          </View>
          <View style={[styles.buttonRow, buttons.length > 2 ? styles.stacked : null]}>
            {buttons.map((b, i) => {
              const isDestructive = b.style === "destructive";
              const isCancel = b.style === "cancel";
              const bg = isDestructive ? "#dc2626" : isCancel ? "transparent" : colors.primary;
              const fg = isDestructive ? "#fff" : isCancel ? colors.mutedForeground : "#fff";
              const border = isCancel ? colors.border : "transparent";
              return (
                <Pressable
                  key={`${b.text}-${i}`}
                  onPress={() => handlePress(b)}
                  style={({ pressed }) => [
                    styles.btn,
                    {
                      backgroundColor: bg,
                      borderColor: border,
                      borderWidth: isCancel ? 1 : 0,
                      opacity: pressed ? 0.82 : 1,
                    },
                    buttons.length > 2 ? { width: "100%" } : { flex: 1 },
                  ]}
                >
                  <ButtonLabel text={b.text} color={fg} />
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Use plain RN <Text> so we don't need to depend on AppText/theme tokens —
// keeps the alert robust even before fonts/theme are ready.
function Title({ text, color }: { text: string; color: string }) {
  return (
    <Text style={[styles.title, { color }]} numberOfLines={3}>
      {text}
    </Text>
  );
}
function Body({ text, color }: { text: string; color: string }) {
  return (
    <Text style={[styles.body, { color }]}>
      {text}
    </Text>
  );
}
function ButtonLabel({ text, color }: { text: string; color: string }) {
  return (
    <Text style={[styles.btnText, { color }]} numberOfLines={1}>
      {text}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Module-level imperative API — drop-in replacement for React Native's
// `Alert` static. Lets callers do `Alert.alert(title, msg, buttons)` from
// anywhere without needing a hook. Wired up by <AppAlertProvider> via
// `__setAlertHandler` (declared near the top of this file). If no provider
// is mounted yet we fall back to the platform dialog so we never lose a
// message.
// ---------------------------------------------------------------------------

export const Alert = {
  alert(
    title: string,
    message?: string,
    buttons?: Array<{ text?: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void | Promise<void> }>,
    _options?: { cancelable?: boolean },
  ) {
    const mapped: AlertButton[] | undefined = buttons?.map((b) => ({
      text: b.text ?? "OK",
      style: b.style,
      onPress: b.onPress,
    }));
    const tone: AlertTone | undefined = mapped?.some((b) => b.style === "destructive") ? "destructive" : undefined;
    if (__handler) {
      __handler({ title, message, buttons: mapped, tone, cancelable: _options?.cancelable });
    } else {
      // Provider not mounted (cold start before _layout renders) — fall
      // back to the native dialog so the user still sees the message.
      RNAlert.alert(title, message, buttons as never, _options);
    }
  },
};

export function useAlert(): AlertCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAlert() must be used inside <AppAlertProvider>");
  return ctx;
}

/**
 * Drop-in replacement for `import { Alert } from 'react-native'`'s `Alert.alert`.
 * Use the returned function instead of `Alert.alert(...)`. Call from inside a
 * React component via `const alert = useAlertFn(); alert("Title", "Message")`.
 */
export function useAlertFn() {
  const { show } = useAlert();
  return useCallback(
    (title: string, message?: string, buttons?: AlertButton[]) => {
      const tone: AlertTone | undefined = buttons?.some((b) => b.style === "destructive") ? "destructive" : undefined;
      show({ title, message, buttons, tone });
    },
    [show],
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 22,
    padding: 22,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  titleRow: { flexDirection: "row", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  stacked: { flexDirection: "column" },
  btn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
