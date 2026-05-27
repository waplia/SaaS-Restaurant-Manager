import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Ionicons, Feather } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setBaseUrl } from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppAlertProvider } from "@/components/ui/AppAlert";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import { useReactQueryRefreshBridge } from "@/hooks/useReactQueryRefreshBridge";

// Set base URL at module level so all API calls use the correct domain.
// Resolved from EXPO_PUBLIC_API_BASE_URL (preferred) with fallback to the
// Replit dev domain — see lib/apiBaseUrl.ts.
setBaseUrl(getApiBaseUrl());

SplashScreen.preventAutoHideAsync();

// Foreground notification display behaviour — show a banner + sound while
// the app is open so staff don't miss new orders / waiter calls / alerts.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowAlert: true,
  }),
});

// Android 8+ requires a notification channel per custom sound — the server
// picks the right channel via `channelId` in the push payload so each
// notification type plays the same chime as the web client
// (restaurant-platform/src/lib/notificationSound.ts). The .wav files live
// in assets/sounds/ and are bundled by the expo-notifications plugin
// declaration in app.json.
async function registerNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("new-order", {
      name: "New orders",
      description: "Triumphant chime for new incoming orders.",
      importance: Notifications.AndroidImportance.MAX,
      sound: "new_order.wav",
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#F97316",
    });
    await Notifications.setNotificationChannelAsync("notification", {
      name: "Alerts & requests",
      description:
        "Soft chime for waiter calls, kitchen alerts, approvals and other notifications.",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "notification.wav",
      vibrationPattern: [0, 200, 100, 200],
      lightColor: "#F97316",
    });
  } catch (err) {
    console.warn("[notifications] failed to register channels", err);
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep cached data for the gestural feel, but mark it stale almost
      // immediately so any focus/navigation event triggers a refetch.
      // Individual hooks can opt back into longer caching with their own
      // staleTime when freshness genuinely doesn't matter (menu items,
      // plan limits, etc).
      staleTime: 0,
      // RN doesn't fire window focus events natively; the refresh bridge
      // (hooks/useReactQueryRefreshBridge.ts) forwards AppState and
      // navigation focus into focusManager, so leave this default on.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 2,
    },
  },
});

// Deep-link a tapped notification to the right in-app screen. Payloads
// follow `{ data: { route?: string, type?: string } }` — when no explicit
// route is given we map known event types to sensible defaults.
function routeForNotification(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  if (typeof data.route === "string" && data.route.startsWith("/")) return data.route;
  const t = String(data.type ?? "");
  switch (t) {
    case "new_order":
    case "qr_order":
    case "order_ready":
      return "/(owner)/orders";
    case "waiter_request":
      return "/(owner)/waiter-requests";
    case "kitchen_delay":
      return "/(owner)/kitchen";
    case "low_stock":
      return "/(owner)/inventory";
    case "approval_request":
      return "/(owner)/approvals";
    case "support_ticket":
      return "/(owner)/support";
    case "negative_feedback":
      return "/(owner)/feedback";
    case "reservation_reminder":
      return "/(owner)/tables";
    case "guest_verification":
      // Held QR order awaiting waiter verification — deep-link to the
      // waiter tables tab where the held card glows + opens the sheet.
      return "/(waiter)/(tabs)";
    case "ai_insight":
      return "/(owner)/khana-ai-chat";
    default:
      return "/(owner)/notifications";
  }
}

function RefreshBridge() {
  // Lives inside QueryClientProvider so useQueryClient resolves correctly.
  useReactQueryRefreshBridge();
  return null;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="intro" options={{ headerShown: false, gestureEnabled: false, animation: "fade" }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="(owner)" options={{ headerShown: false }} />
      <Stack.Screen name="(waiter)" options={{ headerShown: false }} />
      <Stack.Screen name="(customer)" options={{ headerShown: false }} />
      <Stack.Screen name="(delivery)" options={{ headerShown: false }} />
      <Stack.Screen name="(chef)" options={{ headerShown: false }} />
      <Stack.Screen name="(cashier)" options={{ headerShown: false }} />
      <Stack.Screen name="(inventory)" options={{ headerShown: false }} />
      <Stack.Screen name="(marketing)" options={{ headerShown: false }} />
      <Stack.Screen name="(accountant)" options={{ headerShown: false }} />
      <Stack.Screen name="role-switch" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="outlet-select" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="profile" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="settings" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="support" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="notifications" options={{ headerShown: false, presentation: "card" }} />
      {/* Top-level shims that re-export owner screens so non-owner roles
          (cashier, etc.) can reach them from their own More menus without
          tripping the (owner)/_layout AuthGate. */}
      <Stack.Screen name="orders" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="tables" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="expenses" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="printers" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="new-order" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="running-order/[tableId]" options={{ headerShown: false }} />
      <Stack.Screen name="notification-settings" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="change-password" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="complete-profile" options={{ headerShown: false, presentation: "card" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Ionicons.font,
    ...Feather.font,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Listen for push notifications: foreground arrivals refresh react-query
  // caches, and taps deep-link the user into the right screen.
  useEffect(() => {
    if (Platform.OS === "web") return;
    // Register Android channels once at startup so custom sounds work for
    // every push regardless of which screen first triggers a notification.
    void registerNotificationChannels();
    const receivedSub = Notifications.addNotificationReceivedListener(() => {
      // Invalidate the most-watched dashboard queries so badges/counters
      // catch up immediately when an order/alert/notification arrives.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["live-orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      queryClient.invalidateQueries({ queryKey: ["ops-approvals-pending"] });
    });
    const safePush = (route: string) => {
      try {
        router.push(route as never);
      } catch (err) {
        // Navigator may not be mounted yet during cold start; log so it
        // shows up in dev / crash reporters instead of being swallowed.
        console.warn("[notifications] router.push failed for", route, err);
      }
    };
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const route = routeForNotification(data);
      if (route) safePush(route);
    });
    // Cold-start tap: if the app was opened via a notification, navigate
    // to its target route after first render.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        const data = response.notification.request.content.data as Record<string, unknown> | undefined;
        const route = routeForNotification(data);
        if (route) setTimeout(() => safePush(route), 600);
      })
      .catch((err) => {
        console.warn("[notifications] getLastNotificationResponseAsync failed", err);
      });
    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RefreshBridge />
          <AuthProvider>
            <CartProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <AppAlertProvider>
                    <StatusBar style="dark" translucent backgroundColor="transparent" />
                    <RootLayoutNav />
                    {/* Checks the App Store / Play Store on launch +
                        foreground for a newer version, and the
                        expo-updates channel for an OTA JS bundle. Renders
                        a dismissible modal / banner when something is
                        available; renders nothing on web or in dev. */}
                    <UpdatePrompt />
                  </AppAlertProvider>
                </KeyboardProvider>
              </GestureHandlerRootView>
            </CartProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
