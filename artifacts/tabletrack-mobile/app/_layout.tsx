import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setBaseUrl } from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2 },
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
    case "ai_insight":
      return "/(owner)/khana-ai-chat";
    default:
      return "/(owner)/notifications";
  }
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(owner)" options={{ headerShown: false }} />
      <Stack.Screen name="(waiter)" options={{ headerShown: false }} />
      <Stack.Screen name="(customer)" options={{ headerShown: false }} />
      <Stack.Screen name="(delivery)" options={{ headerShown: false }} />
      <Stack.Screen name="new-order" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="notification-settings" options={{ headerShown: false, presentation: "card" }} />
      <Stack.Screen name="change-password" options={{ headerShown: false, presentation: "card" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
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
          <AuthProvider>
            <CartProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </CartProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
