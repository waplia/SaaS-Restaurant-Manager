import { useEffect, useState } from "react";
import type { DesktopSettings } from "../../main/types";

interface Props {
  settings: DesktopSettings;
  version: string;
  onSave: (patch: Partial<DesktopSettings>) => Promise<void>;
  onLaunch: () => void;
  onClose?: () => void;
}

const PRINTER_SLOTS: Array<{ key: keyof DesktopSettings; label: string }> = [
  { key: "billPrinter",       label: "Bill printer" },
  { key: "kotPrinter",        label: "KOT printer" },
  { key: "kitchenPrinter",    label: "Kitchen printer" },
  { key: "barPrinter",        label: "Bar printer" },
  { key: "parcelPrinter",     label: "Parcel printer" },
  { key: "cashDrawerPrinter", label: "Cash-drawer printer (ESC/POS pulse)" },
];

export function SettingsPanel({ settings, version, onSave, onLaunch, onClose }: Props) {
  const [form, setForm] = useState<DesktopSettings>(settings);
  const [printers, setPrinters] = useState<Array<{ name: string; isDefault: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => { setForm(settings); }, [settings]);

  useEffect(() => {
    window.khanalagao.printers.list().then(setPrinters).catch(() => setPrinters([]));
  }, []);

  const update = (patch: Partial<DesktopSettings>) => setForm((f) => ({ ...f, ...patch }));

  const handleTest = async (name: string | null) => {
    if (!name) return setMsg("Pick a printer first.");
    setBusy(true);
    try { await window.khanalagao.printers.test(name); setMsg(`Test print sent to ${name}`); }
    catch (err) { setMsg(`Test failed: ${(err as Error).message}`); }
    finally { setBusy(false); }
  };

  const handleSave = async () => {
    setBusy(true);
    try { await onSave(form); setMsg("Saved."); }
    catch (err) { setMsg(`Save failed: ${(err as Error).message}`); }
    finally { setBusy(false); }
  };

  const handleCheckUpdates = async () => {
    setBusy(true);
    try {
      const r = await window.khanalagao.updates.check();
      setMsg(r.status === "no-feed"
        ? "No update server configured — running latest local build."
        : `Update check: ${r.status}${r.version ? ` (v${r.version})` : ""}`);
    } catch (err) { setMsg((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div style={wrap}>
      <div style={panel}>
        <header style={header}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>Desktop POS settings</h1>
            <p style={sub}>Configure once per terminal. Cashiers won't see this screen during a shift.</p>
          </div>
          {onClose && <button style={btnGhost} onClick={onClose}>Close ✕</button>}
        </header>

        <section style={section}>
          <h2 style={h2}>Connection</h2>
          <Field label="API base URL"
            hint="Your Khanalagao web URL — e.g. https://app.khanalagao.in">
            <input style={input} value={form.apiBaseUrl}
              onChange={(e) => update({ apiBaseUrl: e.target.value })} placeholder="https://app.khanalagao.in" />
          </Field>
          <Field label="Web POS path" hint="Loaded inside the terminal at launch.">
            <input style={input} value={form.webPosPath}
              onChange={(e) => update({ webPosPath: e.target.value })} placeholder="/pos" />
          </Field>
        </section>

        <section style={section}>
          <h2 style={h2}>Terminal behaviour</h2>
          <Row>
            <Toggle label="Start fullscreen on launch"
              checked={form.startFullscreen} onChange={(v) => update({ startFullscreen: v })} />
            <Toggle label="Auto-launch when this computer starts"
              checked={form.autoLaunch} onChange={(v) => update({ autoLaunch: v })} />
            <Toggle label="Keep screen awake"
              checked={form.keepScreenAwake} onChange={(v) => update({ keepScreenAwake: v })} />
          </Row>
          <Row>
            <Field label="Default order type">
              <select style={input} value={form.defaultOrderType}
                onChange={(e) => update({ defaultOrderType: e.target.value as DesktopSettings["defaultOrderType"] })}>
                <option value="dine_in">Dine-in</option>
                <option value="takeaway">Takeaway</option>
                <option value="delivery">Delivery</option>
              </select>
            </Field>
            <Field label="Default outlet ID (optional)">
              <input style={input} type="number" value={form.defaultOutletId ?? ""}
                onChange={(e) => update({ defaultOutletId: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Default counter ID (optional)">
              <input style={input} type="number" value={form.defaultCounterId ?? ""}
                onChange={(e) => update({ defaultCounterId: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </Row>
        </section>

        <section style={section}>
          <h2 style={h2}>Sound</h2>
          <Row>
            <Toggle label="Enable cashier sounds"
              checked={form.soundEnabled} onChange={(v) => update({ soundEnabled: v })} />
            <Toggle label="Auto-mute during shift" checked={form.muteShift} onChange={(v) => update({ muteShift: v })} />
            <Field label="Tone">
              <select style={input} value={form.soundTone} onChange={(e) => update({ soundTone: e.target.value as DesktopSettings["soundTone"] })}>
                <option value="default">Default</option>
                <option value="soft">Soft</option>
                <option value="classic">Classic</option>
              </select>
            </Field>
            <Field label={`Volume (${Math.round(form.soundVolume * 100)}%)`}>
              <input style={input} type="range" min={0} max={1} step={0.05} value={form.soundVolume}
                onChange={(e) => update({ soundVolume: Number(e.target.value) })} />
            </Field>
          </Row>
        </section>

        <section style={section}>
          <h2 style={h2}>Printers, drawer, scanner</h2>
          <p style={sub}>Detected {printers.length} OS printer{printers.length === 1 ? "" : "s"}. Each role can pick from the same list.</p>
          {PRINTER_SLOTS.map(({ key, label }) => {
            const current = (form[key] as string | null) ?? "";
            return (
              <Row key={String(key)}>
                <Field label={label}>
                  <select style={input} value={current}
                    onChange={(e) => update({ [key]: e.target.value || null } as unknown as Partial<DesktopSettings>)}>
                    <option value="">— Not assigned —</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>{p.name}{p.isDefault ? " (system default)" : ""}</option>
                    ))}
                  </select>
                </Field>
                <button style={btn} disabled={busy || !current} onClick={() => handleTest(current || null)}>Test print</button>
              </Row>
            );
          })}
          <Row>
            <Toggle label="Auto-print KOT" checked={form.autoPrintKot} onChange={(v) => update({ autoPrintKot: v })} />
            <Toggle label="Auto-print bill on verified payment" checked={form.autoPrintBill} onChange={(v) => update({ autoPrintBill: v })} />
            <Toggle label="Auto-open drawer after cash" checked={form.autoOpenDrawerOnCash} onChange={(v) => update({ autoOpenDrawerOnCash: v })} />
            <Toggle label="Enable barcode / QR scanner" checked={form.scannerEnabled} onChange={(v) => update({ scannerEnabled: v })} />
          </Row>
        </section>

        <section style={section}>
          <h2 style={h2}>Updates</h2>
          <Row>
            <Toggle label="Check for updates" checked={form.checkForUpdates} onChange={(v) => update({ checkForUpdates: v })} />
            <Field label="Update feed URL (electron-updater 'generic' provider)">
              <input style={input} value={form.updateFeedUrl ?? ""}
                placeholder="https://updates.khanalagao.in/desktop-pos/"
                onChange={(e) => update({ updateFeedUrl: e.target.value || null })} />
            </Field>
            <button style={btn} disabled={busy} onClick={handleCheckUpdates}>Check now</button>
          </Row>
          <p style={sub}>If no feed URL is configured the app shows the current version and does not poll. Running v{version}.</p>
        </section>

        <footer style={footer}>
          {msg && <span style={{ opacity: 0.85 }}>{msg}</span>}
          <div style={{ flex: 1 }} />
          <button style={btn} disabled={busy} onClick={handleSave}>Save</button>
          <button style={btnPrimary} disabled={busy} onClick={async () => { await handleSave(); onLaunch(); }}>
            Save & launch POS
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 220 }}>
      <span style={{ fontSize: 12, opacity: 0.85 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, opacity: 0.55 }}>{hint}</span>}
    </label>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", marginBottom: 12 }}>{children}</div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "8px 12px", background: "#1f2937", borderRadius: 8, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const wrap: React.CSSProperties = { padding: 24, height: "100vh", overflow: "auto", background: "#0b0f17" };
const panel: React.CSSProperties = { maxWidth: 1080, margin: "0 auto", background: "#111827", border: "1px solid #1f2937", borderRadius: 12, padding: 24 };
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 };
const sub: React.CSSProperties = { margin: "4px 0 0", opacity: 0.6, fontSize: 12 };
const section: React.CSSProperties = { borderTop: "1px solid #1f2937", paddingTop: 16, marginTop: 16 };
const h2: React.CSSProperties = { fontSize: 14, textTransform: "uppercase", letterSpacing: 1, opacity: 0.8, margin: "0 0 12px" };
const input: React.CSSProperties = { background: "#0b0f17", color: "#f4f5f7", border: "1px solid #374151", borderRadius: 6, padding: "8px 10px", fontSize: 13, width: "100%" };
const btn: React.CSSProperties = { background: "#1f2937", color: "#f4f5f7", border: "1px solid #374151", borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 13 };
const btnGhost: React.CSSProperties = { ...btn, background: "transparent" };
const btnPrimary: React.CSSProperties = { ...btn, background: "#ea580c", borderColor: "#ea580c" };
const footer: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", marginTop: 20, paddingTop: 16, borderTop: "1px solid #1f2937" };
