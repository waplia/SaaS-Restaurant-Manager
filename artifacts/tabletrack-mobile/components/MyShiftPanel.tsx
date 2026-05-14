import React, { useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

type Shift = { id: number; name: string; startTime: string; endTime: string };
type AttendanceRecord = {
  id: number;
  userId: number;
  status: string;
  clockIn: string;
  clockOut: string | null;
  workedMinutes: number | null;
  scheduledMinutes: number | null;
  lateMinutes: number | null;
  overtimeMinutes: number | null;
};
type MyActive = { open: AttendanceRecord | null; todayShift: Shift | null };

function apiUrl(path: string) {
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api${path}`;
}

async function authFetch(token: string | null, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

export function MyShiftPanel() {
  const colors = useColors();
  const { restaurantId, accessToken } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<MyActive>({
    queryKey: ["attendance-my-active", restaurantId],
    queryFn: () => authFetch(accessToken, `/restaurants/${restaurantId}/attendance/my-active`) as Promise<MyActive>,
    refetchInterval: 60_000,
    enabled: !!accessToken,
  });

  const punchIn = useMutation({
    mutationFn: () =>
      authFetch(accessToken, `/restaurants/${restaurantId}/attendance/punch-in`, {
        method: "POST",
        body: JSON.stringify({ source: "mobile" }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance-my-active"] }),
  });

  const punchOut = useMutation({
    mutationFn: () =>
      authFetch(accessToken, `/restaurants/${restaurantId}/attendance/punch-out`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance-my-active"] }),
  });

  const onPress = useCallback(() => {
    if (data?.open) punchOut.mutate();
    else punchIn.mutate();
  }, [data?.open, punchIn, punchOut]);

  if (isLoading) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const open = data?.open ?? null;
  const shift = data?.todayShift ?? null;
  const elapsed = open ? Date.now() - new Date(open.clockIn).getTime() : 0;
  const isActive = !!open;
  const isPending = punchIn.isPending || punchOut.isPending;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isActive ? "#fff7ed" : colors.card,
          borderColor: isActive ? "#fdba74" : colors.border,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Feather
          name={isActive ? "clock" : "log-in"}
          size={16}
          color={isActive ? "#c2410c" : colors.mutedForeground}
        />
        <Text
          style={[
            styles.label,
            { color: isActive ? "#9a3412" : colors.mutedForeground },
          ]}
        >
          {isActive ? "On the clock" : "My shift"}
        </Text>
      </View>
      {shift ? (
        <Text style={[styles.shiftName, { color: colors.foreground }]}>
          {shift.name} · {shift.startTime}–{shift.endTime}
        </Text>
      ) : (
        <Text style={[styles.shiftName, { color: colors.mutedForeground }]}>
          No shift scheduled today
        </Text>
      )}

      {isActive && open && (
        <Text style={[styles.elapsed, { color: "#c2410c" }]}>
          Started {fmtTime(open.clockIn)} · {fmtDuration(elapsed)}
          {open.lateMinutes ? ` · late ${open.lateMinutes}m` : ""}
        </Text>
      )}

      <TouchableOpacity
        onPress={onPress}
        disabled={isPending}
        style={[
          styles.button,
          {
            backgroundColor: isActive ? "#ea580c" : colors.primary,
            opacity: isPending ? 0.6 : 1,
          },
        ]}
      >
        {isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Feather name={isActive ? "log-out" : "log-in"} size={14} color="#fff" />
            <Text style={styles.buttonText}>{isActive ? "Punch out" : "Punch in"}</Text>
          </>
        )}
      </TouchableOpacity>

      {(punchIn.error || punchOut.error) && (
        <Text style={styles.error}>
          {(punchIn.error || punchOut.error)?.toString() ?? "Failed"}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginHorizontal: 16, marginTop: 12, gap: 6 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  shiftName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  elapsed: { fontSize: 12, fontFamily: "Inter_400Regular" },
  button: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  buttonText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 },
  error: { color: "#dc2626", fontSize: 11, marginTop: 4 },
});
