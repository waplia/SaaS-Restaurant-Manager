import React from "react";
import { View, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/theme";
import { AppText, AppIcon } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import {
  cashierFetch,
  type PrinterRow,
  type DeviceRow,
} from "@/lib/cashierApi";

type Tone = "ok" | "warn" | "bad" | "off";

function tone(status: string | null | undefined, enabled = true): Tone {
  if (!enabled) return "off";
  const s = (status ?? "").toLowerCase();
  if (s === "online" || s === "ready" || s === "active") return "ok";
  if (s === "pairing" || s === "idle" || s === "unknown" || s === "") return "warn";
  return "bad";
}

function toneColors(t: Tone) {
  switch (t) {
    case "ok": return { bg: "#dcfce7", fg: "#166534", dot: "#16a34a" };
    case "warn": return { bg: "#fef9c3", fg: "#854d0e", dot: "#ca8a04" };
    case "bad": return { bg: "#fee2e2", fg: "#991b1b", dot: "#dc2626" };
    case "off": return { bg: "#f1f5f9", fg: "#475569", dot: "#94a3b8" };
  }
}

interface PillProps {
  icon: "print-outline" | "card-outline";
  label: string;
  detail: string;
  status: Tone;
  onPress?: () => void;
}

function StatusPill({ icon, label, detail, status, onPress }: PillProps) {
  const c = toneColors(status);
  const t = useTheme();
  const body = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: c.bg,
        borderWidth: 1,
        borderColor: t.colors.border,
        flexShrink: 1,
      }}
    >
      <AppIcon name={icon} size={14} color={c.fg} />
      <View style={{ flexShrink: 1 }}>
        <AppText variant="micro" style={{ color: c.fg, fontSize: 10, lineHeight: 12 }} numberOfLines={1}>
          {label}
        </AppText>
        <AppText variant="micro" style={{ color: c.fg, fontSize: 11, lineHeight: 13, fontFamily: t.fontFamily.semibold }} numberOfLines={1}>
          {detail}
        </AppText>
      </View>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.dot }} />
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, flexShrink: 1 })}>
      {body}
    </Pressable>
  );
}

/**
 * Live header strip showing receipt printer + EDC terminal status. Pulls
 * the real registry from /restaurants/:r/printers and /restaurants/:r/devices
 * — never mocked. Refetched on a short interval so a tech swapping cables
 * is reflected within ~15s.
 */
export function DeviceStatusStrip({ onPress }: { onPress?: () => void }) {
  const { restaurantId, accessToken, effectiveBranchId } = useAuth();
  const branchQ = effectiveBranchId ? `&branchId=${effectiveBranchId}` : "";

  const printersQuery = useQuery({
    queryKey: ["cashier-printers", restaurantId, effectiveBranchId],
    queryFn: () =>
      cashierFetch<PrinterRow[]>(
        accessToken,
        `/restaurants/${restaurantId}/printers?role=receipt${branchQ}`,
      ),
    enabled: !!accessToken && !!restaurantId,
    refetchInterval: 20_000,
  });

  const devicesQuery = useQuery({
    queryKey: ["cashier-devices-edc", restaurantId, effectiveBranchId],
    queryFn: () =>
      cashierFetch<DeviceRow[]>(
        accessToken,
        `/restaurants/${restaurantId}/devices?type=edc${branchQ}`,
      ),
    enabled: !!accessToken && !!restaurantId,
    refetchInterval: 20_000,
  });

  const printers = (printersQuery.data ?? []).filter((p) => p.enabled !== false);
  const defaultPrinter = printers.find((p) => p.isDefault) ?? printers[0] ?? null;
  const printerTone: Tone = !defaultPrinter
    ? "off"
    : tone(defaultPrinter.status, defaultPrinter.enabled !== false);
  const printerLabel = defaultPrinter
    ? defaultPrinter.name
    : printersQuery.isLoading ? "Checking…" : "Not configured";
  const printerStatus = defaultPrinter
    ? (defaultPrinter.status ?? "unknown").toString().toUpperCase()
    : "—";

  const edcDevices = devicesQuery.data ?? [];
  const activeEdc = edcDevices.find((d) => (d.status ?? "").toLowerCase() === "online")
    ?? edcDevices[0]
    ?? null;
  const edcTone: Tone = !activeEdc ? "off" : tone(activeEdc.status);
  const edcLabel = activeEdc
    ? activeEdc.name
    : devicesQuery.isLoading ? "Checking…" : "Not paired";
  const edcStatus = activeEdc
    ? (activeEdc.status ?? "unknown").toString().toUpperCase()
    : "—";

  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexShrink: 1,
      }}
    >
      <StatusPill
        icon="print-outline"
        label={`PRINTER · ${printerStatus}`}
        detail={printerLabel}
        status={printerTone}
        onPress={onPress}
      />
      <StatusPill
        icon="card-outline"
        label={`EDC · ${edcStatus}`}
        detail={edcLabel}
        status={edcTone}
        onPress={onPress}
      />
    </View>
  );
}
