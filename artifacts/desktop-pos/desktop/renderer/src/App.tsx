/**
 * Desktop POS shell.
 *
 * The renderer is intentionally thin: it embeds the existing web POS
 * (artifacts/restaurant-platform) in a sandboxed <webview>, and surrounds it
 * with desktop-only chrome:
 *   • Connection / outlet / counter setup gate (settings screen on first run).
 *   • Top bar with shift status, version, and update banner.
 *   • Printer settings panel (enumerate OS printers, assign by role, test).
 *   • Failed-prints retry tray.
 *
 * Backend-verified payments, cart math, KOTs, shifts, sound, calculator and
 * keyboard shortcuts already live in the web POS shell — we do not duplicate
 * them here. Desktop adds: silent ESC/POS printing, cash-drawer kick, local
 * cart safety on crash, auto-update, multi-window guard.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopSettings } from "../../main/types";

type Tab = "pos" | "settings" | "printers" | "failed";

interface UpdateState {
  status: "idle" | "checking" | "none" | "available" | "downloading" | "downloaded" | "error" | "disabled" | "no-feed";
  version?: string;
  percent?: number;
  message?: string;
}

const tab_btn: React.CSSProperties = {
  background: "transparent", border: 0, color: "#cbd5e1",
  padding: "8px 14px", cursor: "pointer", fontSize: 14, borderRadius: 6,
};
const tab_btn_active: React.CSSProperties = { ...tab_btn, background: "#1f2937", color: "#fff" };
const panel: React.CSSProperties = { padding: 24, overflow: "auto", height: "100%" };
const input: React.CSSProperties = {
  background: "#0f172a", border: "1px solid #334155", color: "#e5e7eb",
  padding: "8px 10px", borderRadius: 6, fontSize: 14, width: "100%",
};
const label: React.CSSProperties = { display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 4 };
const btn: React.CSSProperties = {
  background: "#2563eb", color: "#fff", border: 0, padding: "8px 14px",
  borderRadius: 6, cursor: "pointer", fontSize: 14,
};
const btn_ghost: React.CSSProperties = { ...btn, background: "#1f2937" };
const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 };

export function App() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [tab, setTab] = useState<Tab>("pos");
  const [version, setVersion] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const [printers, setPrinters] = useState<Array<{ name: string; isDefault: boolean }>>([]);
  const [failed, setFailed] = useState<Array<{ id: string; at: number; entry: unknown }>>([]);
  const webviewRef = useRef<HTMLElement & { src?: string; reload?: () => void; openDevTools?: () => void }>(null);

  // Bootstrap: load settings, version, printers, failed-print queue, and
  // subscribe to update events.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [s, v] = await Promise.all([
        window.tabletrack.settings.get(),
        window.tabletrack.app.version(),
      ]);
      if (!mounted) return;
      setSettings(s);
      setVersion(v.version);
      setPlatform(v.platform);
      try { setPrinters(await window.tabletrack.printers.list()); } catch { /* webContents not ready */ }
      try { setFailed((await window.tabletrack.failedPrints.list()) as typeof failed); } catch { /* noop */ }
      // First-run gate: if no API base URL is set OR no outlet/counter,
      // land on settings so the cashier configures the terminal before use.
      if (!s.apiBaseUrl || !s.defaultOutletId || !s.defaultCounterId) setTab("settings");
    })();
    const off = window.tabletrack.updates.onEvent((evt) => {
      setUpdate((cur) => {
        if (evt.type === "available") return { status: "available", version: evt.version };
        if (evt.type === "progress") return { status: "downloading", percent: evt.percent };
        if (evt.type === "downloaded") return { status: "downloaded", version: evt.version };
        if (evt.type === "error") return { status: "error", message: evt.message };
        if (evt.type === "none") return { status: "none" };
        return cur;
      });
    });
    return () => { mounted = false; off(); };
  }, []);

  const webviewSrc = useMemo(() => {
    if (!settings?.apiBaseUrl) return "about:blank";
    const base = settings.apiBaseUrl.replace(/\/+$/, "");
    const url = new URL(base + (settings.webPosPath || "/pos"));
    if (settings.defaultOutletId) url.searchParams.set("outlet", String(settings.defaultOutletId));
    if (settings.defaultCounterId) url.searchParams.set("counter", String(settings.defaultCounterId));
    if (settings.defaultOrderType) url.searchParams.set("order", settings.defaultOrderType);
    url.searchParams.set("shell", "desktop");
    url.searchParams.set("ver", version || "dev");
    return url.toString();
  }, [settings, version]);

  if (!settings) {
    return <div style={{ display: "grid", placeItems: "center", height: "100%" }}>Loading TableTrack POS…</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
      <TopBar
        tab={tab} setTab={setTab}
        version={version} platform={platform}
        update={update}
        onCheckUpdates={async () => {
          setUpdate({ status: "checking" });
          try {
            const r = await window.tabletrack.updates.check();
            setUpdate({ status: (r.status as UpdateState["status"]) ?? "idle", version: r.version });
          } catch (err) {
            setUpdate({ status: "error", message: (err as Error).message });
          }
        }}
        onReload={() => webviewRef.current?.reload?.()}
        failedCount={failed.length}
      />
      <div style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ display: tab === "pos" ? "block" : "none", height: "100%" }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <webview
            // @ts-expect-error — webview is a custom element exposed by Electron.
            ref={webviewRef}
            src={webviewSrc}
            partition="persist:tabletrack-pos"
            allowpopups="true"
            style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
          />
          {!settings.apiBaseUrl && (
            <EmptyState onConfigure={() => setTab("settings")} />
          )}
        </div>
        {tab === "settings" && <SettingsPanel settings={settings} onSave={async (patch) => setSettings(await window.tabletrack.settings.set(patch))} />}
        {tab === "printers" && <PrintersPanel
          settings={settings}
          printers={printers}
          onRefresh={async () => setPrinters(await window.tabletrack.printers.list())}
          onSave={async (patch) => setSettings(await window.tabletrack.settings.set(patch))}
        />}
        {tab === "failed" && <FailedPanel
          items={failed}
          onClear={async () => { await window.tabletrack.failedPrints.clear(); setFailed([]); }}
          onRefresh={async () => setFailed((await window.tabletrack.failedPrints.list()) as typeof failed)}
        />}
      </div>
    </div>
  );
}

function TopBar(props: {
  tab: Tab; setTab: (t: Tab) => void;
  version: string; platform: string;
  update: UpdateState;
  onCheckUpdates: () => void;
  onReload: () => void;
  failedCount: number;
}) {
  const u = props.update;
  const updateLabel = (() => {
    switch (u.status) {
      case "checking": return "Checking for updates…";
      case "available": return `Update available: ${u.version}`;
      case "downloading": return `Downloading… ${Math.round(u.percent ?? 0)}%`;
      case "downloaded": return `Update ready — restart to install`;
      case "error": return `Update error: ${u.message}`;
      case "no-feed": return "Auto-update not configured";
      case "disabled": return "Auto-update disabled";
      case "none": return "Up to date";
      default: return "";
    }
  })();
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
      background: "#111827", borderBottom: "1px solid #1f2937",
    }}>
      <div style={{ fontWeight: 700, marginRight: 12 }}>TableTrack POS</div>
      <button style={props.tab === "pos" ? tab_btn_active : tab_btn} onClick={() => props.setTab("pos")}>POS</button>
      <button style={props.tab === "settings" ? tab_btn_active : tab_btn} onClick={() => props.setTab("settings")}>Settings</button>
      <button style={props.tab === "printers" ? tab_btn_active : tab_btn} onClick={() => props.setTab("printers")}>Printers</button>
      <button style={props.tab === "failed" ? tab_btn_active : tab_btn} onClick={() => props.setTab("failed")}>
        Failed prints{props.failedCount ? ` (${props.failedCount})` : ""}
      </button>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: "#94a3b8" }}>{updateLabel}</span>
      <button style={btn_ghost} onClick={props.onCheckUpdates}>Check updates</button>
      <button style={btn_ghost} onClick={props.onReload}>Reload POS</button>
      <span style={{ fontSize: 12, color: "#64748b" }}>v{props.version} · {props.platform}</span>
    </div>
  );
}

function EmptyState({ onConfigure }: { onConfigure: () => void }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ marginBottom: 8 }}>Welcome to TableTrack POS</h2>
        <p style={{ color: "#94a3b8", marginBottom: 16 }}>
          Set the server URL, outlet and counter to start taking orders.
        </p>
        <button style={btn} onClick={onConfigure}>Open settings</button>
      </div>
    </div>
  );
}

function SettingsPanel({ settings, onSave }: { settings: DesktopSettings; onSave: (p: Partial<DesktopSettings>) => Promise<void> }) {
  const [draft, setDraft] = useState<DesktopSettings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const set = <K extends keyof DesktopSettings>(k: K, v: DesktopSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div style={panel}>
      <h2 style={{ marginTop: 0 }}>Terminal settings</h2>
      <div style={row}>
        <div>
          <label style={label}>Server URL (TableTrack API)</label>
          <input style={input} value={draft.apiBaseUrl} onChange={(e) => set("apiBaseUrl", e.target.value)} placeholder="https://app.tabletrack.in" />
        </div>
        <div>
          <label style={label}>Web POS path</label>
          <input style={input} value={draft.webPosPath} onChange={(e) => set("webPosPath", e.target.value)} placeholder="/pos" />
        </div>
      </div>
      <div style={row}>
        <div>
          <label style={label}>Default outlet ID</label>
          <input style={input} type="number" value={draft.defaultOutletId ?? ""}
            onChange={(e) => set("defaultOutletId", e.target.value ? Number(e.target.value) : null)} />
        </div>
        <div>
          <label style={label}>Default counter ID</label>
          <input style={input} type="number" value={draft.defaultCounterId ?? ""}
            onChange={(e) => set("defaultCounterId", e.target.value ? Number(e.target.value) : null)} />
        </div>
      </div>
      <div style={row}>
        <div>
          <label style={label}>Default order type</label>
          <select style={input as React.CSSProperties}
            value={draft.defaultOrderType}
            onChange={(e) => set("defaultOrderType", e.target.value as DesktopSettings["defaultOrderType"])}>
            <option value="dine_in">Dine-in</option>
            <option value="takeaway">Takeaway</option>
            <option value="delivery">Delivery</option>
          </select>
        </div>
        <div>
          <label style={label}>Auto-update feed URL (optional)</label>
          <input style={input} value={draft.updateFeedUrl ?? ""}
            placeholder="https://updates.tabletrack.in/desktop-pos/"
            onChange={(e) => set("updateFeedUrl", e.target.value || null)} />
        </div>
      </div>
      <fieldset style={{ border: "1px solid #1f2937", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <legend style={{ padding: "0 8px", color: "#cbd5e1" }}>Behaviour</legend>
        <Toggle label="Launch at login" v={draft.autoLaunch} on={(v) => set("autoLaunch", v)} />
        <Toggle label="Start fullscreen" v={draft.startFullscreen} on={(v) => set("startFullscreen", v)} />
        <Toggle label="Keep screen awake during shift" v={draft.keepScreenAwake} on={(v) => set("keepScreenAwake", v)} />
        <Toggle label="Check for updates automatically" v={draft.checkForUpdates} on={(v) => set("checkForUpdates", v)} />
        <Toggle label="Auto-print KOT on order send" v={draft.autoPrintKot} on={(v) => set("autoPrintKot", v)} />
        <Toggle label="Auto-print bill on settle" v={draft.autoPrintBill} on={(v) => set("autoPrintBill", v)} />
        <Toggle label="Auto-open cash drawer on cash payment" v={draft.autoOpenDrawerOnCash} on={(v) => set("autoOpenDrawerOnCash", v)} />
        <Toggle label="Sound enabled" v={draft.soundEnabled} on={(v) => set("soundEnabled", v)} />
        <Toggle label="Barcode/QR scanner (HID) enabled" v={draft.scannerEnabled} on={(v) => set("scannerEnabled", v)} />
      </fieldset>
      <button style={btn} onClick={() => onSave(draft)}>Save</button>
    </div>
  );
}

function Toggle({ label: l, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 14 }}>
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
      <span>{l}</span>
    </label>
  );
}

function PrintersPanel(props: {
  settings: DesktopSettings;
  printers: Array<{ name: string; isDefault: boolean }>;
  onRefresh: () => void;
  onSave: (p: Partial<DesktopSettings>) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");
  const roles: Array<{ key: keyof DesktopSettings; label: string }> = [
    { key: "billPrinter", label: "Bill / receipt printer" },
    { key: "kotPrinter", label: "KOT printer (default)" },
    { key: "kitchenPrinter", label: "Kitchen station printer" },
    { key: "barPrinter", label: "Bar station printer" },
    { key: "parcelPrinter", label: "Parcel / takeaway printer" },
    { key: "cashDrawerPrinter", label: "Cash drawer (via printer)" },
  ];
  return (
    <div style={panel}>
      <h2 style={{ marginTop: 0 }}>Printers</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={btn_ghost} onClick={props.onRefresh}>Refresh list</button>
        <span style={{ color: "#94a3b8", fontSize: 13, alignSelf: "center" }}>
          {props.printers.length} OS printer{props.printers.length === 1 ? "" : "s"} detected
        </span>
      </div>
      {roles.map((r) => (
        <div key={r.key} style={{ marginBottom: 14 }}>
          <label style={label}>{r.label}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              style={input as React.CSSProperties}
              value={(props.settings[r.key] as string | null) ?? ""}
              onChange={(e) => props.onSave({ [r.key]: e.target.value || null } as Partial<DesktopSettings>)}>
              <option value="">— Not assigned —</option>
              {props.printers.map((p) => (
                <option key={p.name} value={p.name}>{p.name}{p.isDefault ? " (default)" : ""}</option>
              ))}
            </select>
            <button
              style={btn_ghost}
              disabled={!props.settings[r.key] || busy === r.key}
              onClick={async () => {
                const name = props.settings[r.key] as string | null;
                if (!name) return;
                setBusy(r.key as string); setMsg("");
                try {
                  await window.tabletrack.printers.test(name);
                  setMsg(`Test sent to ${name}.`);
                } catch (err) {
                  setMsg(`Failed: ${(err as Error).message}`);
                } finally { setBusy(null); }
              }}
            >{busy === r.key ? "Printing…" : "Test"}</button>
            {r.key === "cashDrawerPrinter" && (
              <button style={btn_ghost} onClick={async () => {
                try { await window.tabletrack.drawer.open(); setMsg("Drawer pulse sent."); }
                catch (err) { setMsg(`Failed: ${(err as Error).message}`); }
              }}>Kick drawer</button>
            )}
          </div>
        </div>
      ))}
      {msg && <div style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>{msg}</div>}
    </div>
  );
}

function FailedPanel(props: {
  items: Array<{ id: string; at: number; entry: unknown }>;
  onClear: () => void;
  onRefresh: () => void;
}) {
  return (
    <div style={panel}>
      <h2 style={{ marginTop: 0 }}>Failed prints</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={btn_ghost} onClick={props.onRefresh}>Refresh</button>
        <button style={btn_ghost} onClick={props.onClear} disabled={!props.items.length}>Clear queue</button>
      </div>
      {!props.items.length && <p style={{ color: "#94a3b8" }}>No failed prints recorded.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {props.items.map((it) => (
          <li key={it.id} style={{ border: "1px solid #1f2937", borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{new Date(it.at).toLocaleString()}</div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>{JSON.stringify(it.entry, null, 2)}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
