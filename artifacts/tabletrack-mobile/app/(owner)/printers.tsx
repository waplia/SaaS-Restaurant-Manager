import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View as RNView, ScrollView, StyleSheet, Pressable, RefreshControl, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { AppText } from "@/components/ui/AppText";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppInput } from "@/components/ui/AppInput";
import { AppSwitch } from "@/components/ui/AppSwitch";
import { AppEmptyState } from "@/components/ui/AppEmptyState";
import { getCapabilities, scanBluetooth, scanUsb, print, type ScannedPrinter } from "@/lib/printerAdapter";

type PrinterConnection = "bluetooth" | "usb" | "lan" | "browser" | "system";
type PrinterRole = "bill" | "kot" | "token" | "bar" | "kitchen";
type PrinterPaperSize = "58mm" | "80mm";

interface PrinterRecord {
  id: number;
  name: string;
  connectionType: PrinterConnection;
  role: PrinterRole;
  paperSize: PrinterPaperSize;
  connection: Record<string, unknown>;
  isDefault: boolean;
  autoPrint: boolean;
  enabled: boolean;
  copies: number;
  status: string;
  lastTestError: string | null;
  kitchenId: number | null;
}

interface PrintJobRecord {
  id: number;
  printType: string;
  printerId: number | null;
  status: string;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  invoiceNumber: string | null;
  kotNumber: string | null;
  orderId: number | null;
}

type ViewKey = "list" | "wizard" | "history" | "test";

const ROLE_LABEL: Record<PrinterRole, string> = {
  bill: "Bill", kot: "KOT", token: "Token", bar: "Bar", kitchen: "Kitchen",
};
const CONN_LABEL: Record<PrinterConnection, string> = {
  system: "AirPrint / Android Print",
  bluetooth: "Bluetooth",
  usb: "USB / OTG",
  lan: "LAN",
  browser: "Browser",
};

export default function PrintersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { restaurantId, user } = useAuth();
  const qc = useQueryClient();
  const canWrite = !!user && (user.role === "owner" || user.role === "manager" || user.isSuperAdmin);

  const [view, setView] = useState<ViewKey>("list");

  const printersQ = useQuery({
    queryKey: ["printers", restaurantId],
    queryFn: () => customFetch<PrinterRecord[]>(`/api/restaurants/${restaurantId}/printers`),
    enabled: !!restaurantId,
    refetchInterval: 30_000,
  });

  return (
    <RNView style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <RNView style={[s.header, { borderColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <AppText variant="h3" style={{ flex: 1, marginLeft: 8 }}>Printers</AppText>
        {canWrite && (
          <Pressable onPress={() => setView("wizard")} hitSlop={10}>
            <Ionicons name="add-circle" size={28} color={colors.primary} />
          </Pressable>
        )}
      </RNView>

      <RNView style={[s.tabs, { borderColor: colors.border }]}>
        {(["list", "history"] as const).map(v => (
          <Pressable key={v} onPress={() => setView(v)} style={[s.tab, view === v && { borderBottomColor: colors.primary }]}>
            <AppText variant="bodyMd" style={{ color: view === v ? colors.primary : colors.mutedForeground }}>
              {v === "list" ? "Printers" : "History"}
            </AppText>
          </Pressable>
        ))}
      </RNView>

      {view === "list" && (
        <PrinterList
          data={printersQ.data ?? []}
          loading={printersQ.isLoading}
          refetch={printersQ.refetch}
          isRefetching={printersQ.isRefetching}
          restaurantId={restaurantId}
          canWrite={canWrite}
          onAdd={() => setView("wizard")}
          onTestCenter={() => setView("test")}
          onChange={() => qc.invalidateQueries({ queryKey: ["printers", restaurantId] })}
        />
      )}
      {view === "wizard" && (
        <PrinterWizard
          restaurantId={restaurantId}
          onClose={() => { setView("list"); qc.invalidateQueries({ queryKey: ["printers", restaurantId] }); }}
        />
      )}
      {view === "history" && <PrintHistory restaurantId={restaurantId} />}
      {view === "test" && <TestCenter printers={printersQ.data ?? []} restaurantId={restaurantId} onClose={() => setView("list")} />}
    </RNView>
  );
}

// ─── List ────────────────────────────────────────────────────────────────
function PrinterList({
  data, loading, refetch, isRefetching, restaurantId, canWrite, onAdd, onTestCenter, onChange,
}: {
  data: PrinterRecord[]; loading: boolean; refetch: () => void; isRefetching: boolean;
  restaurantId: number; canWrite: boolean; onAdd: () => void; onTestCenter: () => void; onChange: () => void;
}) {
  const colors = useColors();
  const test = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/printers/${id}/test-print`, { method: "POST" }),
  });
  const del = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/printers/${id}`, { method: "DELETE" }),
    onSuccess: onChange,
  });
  const setDefault = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/restaurants/${restaurantId}/printers/${id}/set-default`, { method: "POST" }),
    onSuccess: onChange,
  });

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (data.length === 0) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <AppEmptyState
          title="No printers yet"
          description="Pair a Bluetooth or plug in a USB thermal printer to start printing bills, KOTs and tokens."
          icon="print"
          actionLabel={canWrite ? "Add a printer" : undefined}
          onAction={canWrite ? onAdd : undefined}
        />
      </ScrollView>
    );
  }
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <AppButton label="Test Center" leftIcon="play" variant="outline" onPress={onTestCenter} />
      {data.map(p => (
        <AppCard key={p.id} padding={16}>
          <RNView style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Ionicons name={iconForConn(p.connectionType)} size={26} color={colors.primary} />
            <RNView style={{ flex: 1 }}>
              <AppText variant="bodyMd">{p.name}</AppText>
              <AppText variant="label" style={{ color: colors.mutedForeground }}>
                {CONN_LABEL[p.connectionType]} · {p.paperSize} · {ROLE_LABEL[p.role]}
                {p.isDefault ? " · Default" : ""}
              </AppText>
              {p.lastTestError ? (
                <AppText variant="label" style={{ color: colors.destructive, marginTop: 2 }}>{p.lastTestError}</AppText>
              ) : null}
            </RNView>
            <StatusDot status={p.status} />
          </RNView>
          <RNView style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <AppButton size="sm" variant="outline" label="Test" leftIcon="play" onPress={async () => {
              try { await test.mutateAsync(p.id); Alert.alert("Queued", "Test print queued"); }
              catch (e) { Alert.alert("Failed", (e as Error).message); }
            }} />
            {canWrite && !p.isDefault && (
              <AppButton size="sm" variant="ghost" label="Set default" leftIcon="star"
                onPress={() => setDefault.mutate(p.id)} />
            )}
            {canWrite && (
              <AppButton size="sm" variant="ghost" label="Remove" leftIcon="trash"
                onPress={() => Alert.alert("Remove printer?", p.name, [
                  { text: "Cancel" },
                  { text: "Remove", style: "destructive", onPress: () => del.mutate(p.id) },
                ])}
              />
            )}
          </RNView>
        </AppCard>
      ))}
    </ScrollView>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors = useColors();
  const color = status === "connected" || status === "test_passed" ? "#10b981"
    : status === "test_failed" || status === "permission_required" ? "#f59e0b"
    : status === "offline" || status === "disconnected" ? "#94a3b8"
    : colors.border;
  return <RNView style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />;
}

function iconForConn(c: PrinterConnection): React.ComponentProps<typeof Ionicons>["name"] {
  if (c === "bluetooth") return "bluetooth";
  if (c === "usb") return "hardware-chip-outline";
  if (c === "lan") return "wifi";
  if (c === "system") return "print";
  return "globe-outline";
}

// ─── Wizard (6 steps) ────────────────────────────────────────────────────
interface WizardState {
  step: number;
  connectionType: PrinterConnection;
  selectedDevice: ScannedPrinter | null;
  manualAddress: string;
  manualVid: string;
  manualPid: string;
  manualHost: string;
  manualPort: string;
  paperSize: PrinterPaperSize;
  role: PrinterRole;
  name: string;
  copies: number;
  cutPaper: boolean;
  cashDrawerKick: boolean;
  buzzer: boolean;
  autoPrint: boolean;
  isDefault: boolean;
}
const INITIAL: WizardState = {
  // Default to "system" so Expo Go users get a path that actually works
  // out of the box (AirPrint / Android Print Service).
  step: 0, connectionType: "system", selectedDevice: null,
  manualAddress: "", manualVid: "", manualPid: "", manualHost: "", manualPort: "9100",
  paperSize: "80mm", role: "bill", name: "", copies: 1,
  cutPaper: true, cashDrawerKick: false, buzzer: false, autoPrint: false, isDefault: false,
};

function PrinterWizard({ restaurantId, onClose }: { restaurantId: number; onClose: () => void }) {
  const colors = useColors();
  const [w, setW] = useState<WizardState>(INITIAL);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<ScannedPrinter[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const capabilities = useMemo(() => getCapabilities(), []);

  const patch = (p: Partial<WizardState>) => setW(prev => ({ ...prev, ...p }));

  const doScan = useCallback(async () => {
    setScanning(true); setScanError(null); setDevices([]);
    try {
      const r = w.connectionType === "bluetooth" ? await scanBluetooth() : await scanUsb();
      if (!r.available) {
        setScanError(capabilities.reason ?? "Native scanning unavailable in this build. Enter device details manually below.");
      } else if (r.error) {
        setScanError(r.error);
      }
      setDevices(r.devices);
    } finally { setScanning(false); }
  }, [w.connectionType, capabilities.reason]);

  useEffect(() => {
    if (w.step === 1 && (w.connectionType === "bluetooth" || w.connectionType === "usb")) {
      void doScan();
    }
  }, [w.step, w.connectionType, doScan]);

  const save = useMutation({
    mutationFn: async () => {
      const connection: Record<string, unknown> =
        w.connectionType === "bluetooth"
          ? { address: w.selectedDevice?.address ?? w.manualAddress, deviceName: w.selectedDevice?.name }
          : w.connectionType === "usb"
            ? { vendorId: w.selectedDevice?.vendorId ?? w.manualVid, productId: w.selectedDevice?.productId ?? w.manualPid, deviceName: w.selectedDevice?.name }
            : w.connectionType === "lan"
              ? { host: w.manualHost, port: Number(w.manualPort) || 9100 }
              : w.connectionType === "system"
                ? { deviceName: w.name || "System printer" }
                : {};
      return customFetch<PrinterRecord>(`/api/restaurants/${restaurantId}/printers`, {
        method: "POST",
        body: JSON.stringify({
          name: w.name || (w.selectedDevice?.name ?? `${ROLE_LABEL[w.role]} printer`),
          connectionType: w.connectionType,
          role: w.role,
          paperSize: w.paperSize,
          copies: w.copies,
          charactersPerLine: w.paperSize === "58mm" ? 32 : 48,
          cutPaper: w.cutPaper,
          cashDrawerKick: w.cashDrawerKick,
          buzzer: w.buzzer,
          autoPrint: w.autoPrint,
          isDefault: w.isDefault,
          connection,
        }),
      });
    },
    onSuccess: () => { Alert.alert("Saved", "Printer added."); onClose(); },
    onError: (e) => Alert.alert("Save failed", (e as Error).message),
  });

  // 6-step setup per spec: type → discover → paper → role → test print → save.
  // Options live inline on the Save step (was its own step before, but the
  // dedicated Test step replaces it so the count stays at 6).
  const STEPS = ["Connection", "Discover", "Paper", "Role", "Test", "Save"];

  const buildConnection = useCallback((): Record<string, unknown> => {
    if (w.connectionType === "bluetooth") {
      return { address: w.selectedDevice?.address ?? w.manualAddress, deviceName: w.selectedDevice?.name };
    }
    if (w.connectionType === "usb") {
      return { vendorId: w.selectedDevice?.vendorId ?? w.manualVid, productId: w.selectedDevice?.productId ?? w.manualPid, deviceName: w.selectedDevice?.name };
    }
    if (w.connectionType === "lan") {
      return { host: w.manualHost, port: Number(w.manualPort) || 9100 };
    }
    if (w.connectionType === "system") {
      return { deviceName: w.name || "System printer" };
    }
    return {};
  }, [w]);

  // Minimal ESC/POS bytes that any thermal printer will accept: init +
  // "TableTrack test print\n\n\n" + cut. Kept here so the wizard doesn't
  // need a saved printer to run a real test against the selected hardware.
  const TEST_PAYLOAD_B64 = "G0AKVGFibGVUcmFjayB0ZXN0IHByaW50CgoKHWlB";
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; fellBack?: boolean; transportUsed?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const runTest = useCallback(async () => {
    setTesting(true); setTestResult(null);
    try {
      const conn = buildConnection();
      const r = await print({
        type: w.connectionType,
        address: typeof conn.address === "string" ? conn.address : undefined,
        vendorId: typeof conn.vendorId === "string" ? conn.vendorId : undefined,
        productId: typeof conn.productId === "string" ? conn.productId : undefined,
        host: typeof conn.host === "string" ? conn.host : undefined,
        port: typeof conn.port === "number" ? conn.port : undefined,
        deviceName: typeof conn.deviceName === "string" ? conn.deviceName : w.name || undefined,
      }, TEST_PAYLOAD_B64);
      setTestResult(r);
    } finally { setTesting(false); }
  }, [buildConnection, w.connectionType]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <RNView style={{ flexDirection: "row", gap: 4 }}>
        {STEPS.map((label, i) => (
          <RNView key={i} style={[s.stepDot, { backgroundColor: i <= w.step ? colors.primary : colors.border }]}>
            <AppText variant="label" style={{ color: "#fff" }}>{i + 1}</AppText>
          </RNView>
        ))}
      </RNView>
      <AppText variant="h3">Step {w.step + 1} · {STEPS[w.step]}</AppText>

      {w.step === 0 && (
        <>
          <AppText variant="body">How does this printer connect?</AppText>
          {(Object.keys(CONN_LABEL) as PrinterConnection[]).map(c => (
            <Pressable key={c} onPress={() => patch({ connectionType: c })}>
              <AppCard padding={16} style={{ borderWidth: 2, borderColor: w.connectionType === c ? colors.primary : "transparent" }}>
                <RNView style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Ionicons name={iconForConn(c)} size={24} color={colors.primary} />
                  <AppText variant="bodyMd" style={{ flex: 1 }}>{CONN_LABEL[c]}</AppText>
                  {w.connectionType === c && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                </RNView>
              </AppCard>
            </Pressable>
          ))}
        </>
      )}

      {w.step === 1 && (
        <>
          {w.connectionType === "bluetooth" || w.connectionType === "usb" ? (
            <>
              <RNView style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <AppText variant="bodyMd" style={{ flex: 1 }}>Discovering devices…</AppText>
                <AppButton size="sm" variant="outline" label={scanning ? "Scanning" : "Rescan"} onPress={doScan} loading={scanning} />
              </RNView>
              {scanError ? (
                <AppCard padding={16} background={colors.warningSoft}>
                  <AppText variant="label">{scanError}</AppText>
                </AppCard>
              ) : null}
              {devices.map((d, i) => (
                <Pressable key={d.id || d.address || i} onPress={() => patch({ selectedDevice: d })}>
                  <AppCard padding={16} style={{ borderWidth: 2, borderColor: w.selectedDevice === d ? colors.primary : "transparent" }}>
                    <AppText variant="bodyMd">{d.name || "Unknown device"}</AppText>
                    <AppText variant="label" style={{ color: colors.mutedForeground }}>
                      {d.address || `${d.vendorId}:${d.productId}`}
                      {d.paired ? " · paired" : ""}
                    </AppText>
                  </AppCard>
                </Pressable>
              ))}
              <AppText variant="label" style={{ color: colors.mutedForeground, marginTop: 8 }}>
                Or enter manually:
              </AppText>
              {w.connectionType === "bluetooth" ? (
                <AppInput placeholder="MAC address (00:11:22:33:44:55)" value={w.manualAddress} onChangeText={v => patch({ manualAddress: v })} />
              ) : (
                <>
                  <AppInput placeholder="Vendor ID (e.g. 0x04b8)" value={w.manualVid} onChangeText={v => patch({ manualVid: v })} />
                  <AppInput placeholder="Product ID" value={w.manualPid} onChangeText={v => patch({ manualPid: v })} />
                </>
              )}
            </>
          ) : w.connectionType === "lan" ? (
            <>
              <AppInput placeholder="Printer IP / host" value={w.manualHost} onChangeText={v => patch({ manualHost: v })} />
              <AppInput placeholder="Port (default 9100)" value={w.manualPort} onChangeText={v => patch({ manualPort: v })} keyboardType="numeric" />
              <AppText variant="label" style={{ color: colors.mutedForeground }}>
                LAN printing is handled by the desktop print bridge.
              </AppText>
            </>
          ) : w.connectionType === "system" ? (
            <AppCard padding={16} background={colors.infoSoft ?? colors.muted}>
              <AppText variant="bodyMd" style={{ fontWeight: "600", marginBottom: 6 }}>No setup needed</AppText>
              <AppText variant="label" style={{ color: colors.mutedForeground }}>
                Tapping Test or Print will open the iOS / Android print sheet, where you can pick any AirPrint or Android Print-compatible printer on your network.
              </AppText>
            </AppCard>
          ) : (
            <AppText variant="body">Browser printer uses the device's native print dialog.</AppText>
          )}
        </>
      )}

      {w.step === 2 && (
        <>
          <AppText variant="body">Paper size</AppText>
          {(["80mm", "58mm"] as PrinterPaperSize[]).map(p => (
            <Pressable key={p} onPress={() => patch({ paperSize: p })}>
              <AppCard padding={16} style={{ borderWidth: 2, borderColor: w.paperSize === p ? colors.primary : "transparent" }}>
                <AppText variant="bodyMd">{p} ({p === "58mm" ? "32" : "48"} chars/line)</AppText>
              </AppCard>
            </Pressable>
          ))}
        </>
      )}

      {w.step === 3 && (
        <>
          <AppText variant="body">What does this printer print?</AppText>
          {(Object.keys(ROLE_LABEL) as PrinterRole[]).map(r => (
            <Pressable key={r} onPress={() => patch({ role: r })}>
              <AppCard padding={16} style={{ borderWidth: 2, borderColor: w.role === r ? colors.primary : "transparent" }}>
                <AppText variant="bodyMd">{ROLE_LABEL[r]}</AppText>
              </AppCard>
            </Pressable>
          ))}
        </>
      )}

      {w.step === 4 && (
        <>
          <AppText variant="body">Run a quick test print to confirm the printer is reachable before saving.</AppText>
          <AppButton
            label={testing ? "Sending test…" : testResult?.ok ? "Test passed — print again" : "Run test print"}
            onPress={runTest}
            loading={testing}
            leftIcon="print"
          />
          {testResult && (
            <AppCard padding={16} background={testResult.ok ? colors.card : colors.warningSoft}>
              <AppText variant="bodyMd">
                {testResult.ok
                  ? testResult.fellBack
                    ? "Printed via the system print sheet (AirPrint / Android Print)."
                    : "Test print sent successfully."
                  : "Test print failed."}
              </AppText>
              {testResult.ok && testResult.fellBack && (
                <AppText variant="label" style={{ color: colors.mutedForeground, marginTop: 4 }}>
                  The Bluetooth/USB thermal driver isn't available right now, so we routed the page through the OS print sheet instead.
                </AppText>
              )}
              {testResult.error && (
                <AppText variant="label" style={{ color: colors.mutedForeground, marginTop: 4 }}>
                  {testResult.error}
                </AppText>
              )}
              {!testResult.ok && (
                <AppText variant="label" style={{ marginTop: 8 }}>
                  You can still continue — the desktop print bridge or another worker may handle this printer.
                </AppText>
              )}
            </AppCard>
          )}
        </>
      )}

      {w.step === 5 && (
        <>
          <AppInput placeholder="Display name (e.g. Counter Bill Printer)" value={w.name} onChangeText={v => patch({ name: v })} />
          <AppInput placeholder="Copies (1-10)" value={String(w.copies)} keyboardType="numeric"
            onChangeText={v => patch({ copies: Math.max(1, Math.min(10, Number(v) || 1)) })} />
          <Row label="Cut paper" value={w.cutPaper} onChange={v => patch({ cutPaper: v })} />
          <Row label="Open cash drawer" value={w.cashDrawerKick} onChange={v => patch({ cashDrawerKick: v })} />
          <Row label="Buzzer on print" value={w.buzzer} onChange={v => patch({ buzzer: v })} />
          <Row label="Auto-print on event" value={w.autoPrint} onChange={v => patch({ autoPrint: v })} />
          <Row label="Set as default for role" value={w.isDefault} onChange={v => patch({ isDefault: v })} />
          <AppCard padding={16}>
            <AppText variant="bodyMd">{w.name || "(unnamed)"}</AppText>
            <AppText variant="label" style={{ color: colors.mutedForeground }}>
              {CONN_LABEL[w.connectionType]} · {w.paperSize} · {ROLE_LABEL[w.role]}
            </AppText>
            <AppText variant="label" style={{ marginTop: 8 }}>
              Test: {testResult?.ok ? "passed" : testResult ? "failed" : "not run"}
            </AppText>
          </AppCard>
        </>
      )}

      <RNView style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <AppButton label="Cancel" variant="ghost" onPress={onClose} />
        {w.step > 0 && (
          <AppButton label="Back" variant="outline" onPress={() => patch({ step: w.step - 1 })} />
        )}
        <RNView style={{ flex: 1 }} />
        {w.step < STEPS.length - 1 ? (
          <AppButton
            label="Next"
            // Gate advancing past the Test step until the user has at least
            // attempted a test print — matches the spec's "test print before
            // save" requirement while still allowing a failed test to proceed
            // (some workflows use the desktop bridge, not the mobile adapter).
            onPress={() => {
              if (w.step === 4 && !testResult) {
                Alert.alert("Run a test first", "Tap “Run test print” before continuing, or use Back to change settings.");
                return;
              }
              patch({ step: w.step + 1 });
            }}
          />
        ) : (
          <AppButton label={save.isPending ? "Saving…" : "Save printer"} onPress={() => save.mutate()} loading={save.isPending} />
        )}
      </RNView>
    </ScrollView>
  );
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <RNView style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8 }}>
      <AppText variant="body" style={{ flex: 1 }}>{label}</AppText>
      <AppSwitch value={value} onValueChange={onChange} />
    </RNView>
  );
}

// ─── Print history ──────────────────────────────────────────────────────
function PrintHistory({ restaurantId }: { restaurantId: number }) {
  const colors = useColors();
  const jobsQ = useQuery({
    queryKey: ["print-jobs", restaurantId],
    queryFn: () => customFetch<PrintJobRecord[]>(`/api/restaurants/${restaurantId}/print-jobs?limit=100`),
    refetchInterval: 15_000,
  });
  const retry = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/print-jobs/${id}/retry`, { method: "POST" }),
    onSuccess: () => jobsQ.refetch(),
  });
  const reprint = useMutation({
    mutationFn: (id: number) => customFetch(`/api/restaurants/${restaurantId}/print-jobs/${id}/reprint`, { method: "POST" }),
    onSuccess: () => jobsQ.refetch(),
  });

  if (jobsQ.isLoading) return <ActivityIndicator style={{ marginTop: 40 }} />;
  const jobs = jobsQ.data ?? [];
  if (jobs.length === 0) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <AppEmptyState title="No print jobs yet" description="Bills and KOTs you print will show up here." icon="time" />
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}
      refreshControl={<RefreshControl refreshing={jobsQ.isRefetching} onRefresh={jobsQ.refetch} />}
    >
      {jobs.map(j => (
        <AppCard key={j.id} padding={16}>
          <RNView style={{ flexDirection: "row", alignItems: "center" }}>
            <RNView style={{ flex: 1 }}>
              <AppText variant="bodyMd">
                {j.printType} · {j.invoiceNumber || j.kotNumber || (j.orderId ? `Order #${j.orderId}` : `Job #${j.id}`)}
              </AppText>
              <AppText variant="label" style={{ color: colors.mutedForeground }}>
                {new Date(j.createdAt).toLocaleString()} · {j.retryCount}/{j.maxRetries} retries
              </AppText>
              {j.error ? <AppText variant="label" style={{ color: colors.destructive }}>{j.error}</AppText> : null}
            </RNView>
            <AppText variant="label" style={{
              color: j.status === "printed" ? "#10b981"
                : j.status === "failed" ? colors.destructive
                : colors.mutedForeground,
            }}>{j.status}</AppText>
          </RNView>
          <RNView style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {(j.status === "failed" || j.status === "retrying") && (
              <AppButton size="sm" variant="outline" label="Retry" leftIcon="refresh" onPress={() => retry.mutate(j.id)} />
            )}
            {(j.status === "printed" || j.status === "failed") && (
              <AppButton size="sm" variant="ghost" label="Reprint" leftIcon="print" onPress={() => reprint.mutate(j.id)} />
            )}
          </RNView>
        </AppCard>
      ))}
    </ScrollView>
  );
}

// ─── Test Center ─────────────────────────────────────────────────────────
function TestCenter({ printers, restaurantId, onClose }: { printers: PrinterRecord[]; restaurantId: number; onClose: () => void }) {
  const colors = useColors();
  const [busyId, setBusyId] = useState<number | null>(null);

  const queueTest = async (p: PrinterRecord) => {
    setBusyId(p.id);
    try {
      await customFetch(`/api/restaurants/${restaurantId}/printers/${p.id}/test-print`, { method: "POST" });
      // Try direct print on this device too — useful if the local mobile is the printer host.
      const r = await print(
        {
          type: p.connectionType,
          address: String(p.connection?.address ?? ""),
          vendorId: String(p.connection?.vendorId ?? ""),
          productId: String(p.connection?.productId ?? ""),
          deviceName: typeof p.connection?.deviceName === "string" ? p.connection.deviceName : p.name,
          host: String(p.connection?.host ?? ""),
          port: Number(p.connection?.port ?? 9100),
        },
        // Tiny payload: a few line-feeds. Real ESC/POS rendering happens on whichever
        // device claims the job from the queue.
        "GwAbACAAIABURVNUIFBSSU5UCgoKCgoK",
      );
      await customFetch(`/api/restaurants/${restaurantId}/printers/${p.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: r.ok ? "test_passed" : "test_failed", error: r.error ?? null }),
      });
      Alert.alert(r.ok ? "Test queued + printed" : "Test queued (native print failed)", r.error ?? "");
    } catch (e) {
      Alert.alert("Failed", (e as Error).message);
    } finally { setBusyId(null); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <RNView style={{ flexDirection: "row", alignItems: "center" }}>
        <AppText variant="h3" style={{ flex: 1 }}>Test Center</AppText>
        <AppButton variant="ghost" label="Done" onPress={onClose} />
      </RNView>
      <AppText variant="label" style={{ color: colors.mutedForeground }}>
        Sends a test print and reports the result back to the server.
      </AppText>
      {printers.map(p => (
        <AppCard key={p.id} padding={16}>
          <RNView style={{ flexDirection: "row", alignItems: "center" }}>
            <RNView style={{ flex: 1 }}>
              <AppText variant="bodyMd">{p.name}</AppText>
              <AppText variant="label" style={{ color: colors.mutedForeground }}>
                {CONN_LABEL[p.connectionType]} · {p.paperSize}
              </AppText>
            </RNView>
            <AppButton size="sm" label="Test" onPress={() => queueTest(p)} loading={busyId === p.id} />
          </RNView>
        </AppCard>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1 },
  tabs: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: "transparent" },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
