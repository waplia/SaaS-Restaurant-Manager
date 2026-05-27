/**
 * App settings — terminal-local preferences for the cashier.
 *
 * Persists to localStorage via the `useAppPrefs` hook. Some toggles (start
 * in POS, auto-launch, fullscreen, keep awake) are hints to the desktop
 * shell — the main process picks them up on next launch where supported.
 */
import { useEffect, useState } from "react";
import { Banner, Button, Card, Input, Label, colors } from "../ui/components";
import { useAppPrefs, hashPin, type ThemeMode, type Density, type StaffRole } from "../hooks/useAppPrefs";
import { useSounds, type SoundKey, type TonePreset } from "../hooks/useSounds";
import { broadcastDisplay } from "./CustomerDisplay";

interface Props {
  onSignOut?: () => void;
}

const SOUND_EVENTS: Array<{ key: SoundKey; label: string }> = [
  { key: "add", label: "Add item" },
  { key: "remove", label: "Remove item" },
  { key: "pay", label: "Payment success" },
  { key: "error", label: "Error" },
  { key: "alert", label: "Alert / new QR order" },
  { key: "scan", label: "Scanner read" },
  { key: "hold", label: "Hold bill" },
  { key: "kot", label: "KOT sent" },
];
const TONE_PRESETS: TonePreset[] = ["default", "soft", "bold", "classic", "off"];
const THEME_OPTS: ThemeMode[] = ["dark", "light"];
const DENSITY_OPTS: Array<{ k: Density; label: string }> = [
  { k: "comfortable", label: "Comfortable" },
  { k: "compact", label: "Compact" },
  { k: "large-touch", label: "Large touch" },
];
const ROLE_OPTS: Array<{ k: StaffRole; label: string }> = [
  { k: "cashier", label: "Cashier" },
  { k: "waiter", label: "Waiter" },
  { k: "manager", label: "Manager" },
];

export function AppSettingsScreen({ onSignOut }: Props) {
  const { prefs, update, reset } = useAppPrefs();
  const sounds = useSounds();
  const [version, setVersion] = useState<string>("…");
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // PIN management ------------------------------------------------------
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  useEffect(() => {
    window.khanalagao.app.version().then(v => setVersion(v.version ?? "—")).catch(() => setVersion("—"));
  }, []);

  async function checkUpdate() {
    setChecking(true); setUpdateMsg(null);
    try {
      const r = await window.khanalagao.updates.check();
      setUpdateMsg(`${r.status}${r.version ? ` · ${r.version}` : ""}`);
    } catch (e) {
      setUpdateMsg(`Check failed: ${(e as Error).message}`);
    } finally { setChecking(false); }
  }

  async function secureLogout() {
    if (!window.confirm("Sign out and wipe local cache? Pending unsynced changes will be discarded.")) return;
    try { await window.khanalagao.local.reset(); } catch { /* ignore */ }
    if (onSignOut) onSignOut();
  }

  async function savePin() {
    setPinMsg(null);
    if (!/^\d{4,8}$/.test(pin1)) { setPinMsg("PIN must be 4–8 digits."); return; }
    if (pin1 !== pin2) { setPinMsg("PINs do not match."); return; }
    const hash = await hashPin(pin1);
    update({ lockPinHash: hash });
    setPin1(""); setPin2(""); setPinMsg("PIN saved — used to unlock and to authorise discounts/voids.");
  }
  function clearPin() {
    if (!window.confirm("Remove the PIN? Anyone with access to the terminal will be able to unlock it and approve discounts/voids.")) return;
    update({ lockPinHash: "" });
    setPinMsg("PIN cleared.");
  }

  function launchDisplay() {
    const w = window.open("#display=customer", "kpCustomerDisplay", "popup=yes,width=1280,height=720");
    if (!w) window.alert("Browser blocked the popup — allow popups for this app.");
    else broadcastDisplay({ status: "idle", tagline: prefs.customerDisplayTagline });
  }

  return (
    <div style={{ overflow: "auto", padding: 24, flex: 1 }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 22 }}>App settings</h2>
        <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
          Per-terminal preferences. Stored locally — nothing is sent to the server.
        </p>

        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Appearance & role</h3>
          <Row>
            <Label>Theme</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {THEME_OPTS.map(t => (
                <Pill key={t} active={prefs.theme === t} onClick={() => update({ theme: t })}>{t}</Pill>
              ))}
            </div>
          </Row>
          <Row>
            <Label>Density</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {DENSITY_OPTS.map(d => (
                <Pill key={d.k} active={prefs.density === d.k} onClick={() => update({ density: d.k })}>{d.label}</Pill>
              ))}
            </div>
          </Row>
          <Row>
            <Label>Operating role (drives nav & destructive-action gates)</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {ROLE_OPTS.map(r => (
                <Pill key={r.k} active={prefs.role === r.k} onClick={() => update({ role: r.k })}>{r.label}</Pill>
              ))}
            </div>
          </Row>
          <Row>
            <Label>Cashier name (shown on bill header)</Label>
            <Input value={prefs.cashierName} onChange={(e) => update({ cashierName: e.target.value })} placeholder="Cashier 1" />
          </Row>
          <Row>
            <Toggle label="Show item images on the menu grid" checked={prefs.showItemImages} onChange={(v) => update({ showItemImages: v })} />
          </Row>
          <Row>
            <Toggle label="Compact cart rows (dense)" checked={prefs.compactCart} onChange={(v) => update({ compactCart: v })} />
          </Row>
          <Row>
            <Label>Default menu layout</Label>
            <div style={{ display: "flex", gap: 8 }}>
              <Pill active={prefs.menuLayout === "image"} onClick={() => update({ menuLayout: "image" })}>Image cards</Pill>
              <Pill active={prefs.menuLayout === "compact"} onClick={() => update({ menuLayout: "compact" })}>Compact</Pill>
              <Pill active={prefs.menuLayout === "fast"} onClick={() => update({ menuLayout: "fast" })}>Fast bill</Pill>
            </div>
          </Row>
        </Card>

        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Security — terminal PIN</h3>
          <p style={{ color: colors.textMuted, fontSize: 12, marginTop: 0 }}>
            4–8 digits. Required to unlock when locked and to authorise discounts, comps and voids.
          </p>
          <Row>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Input type="password" inputMode="numeric" placeholder="New PIN" value={pin1} onChange={e => setPin1(e.target.value.replace(/\D+/g, "").slice(0, 8))} />
              <Input type="password" inputMode="numeric" placeholder="Confirm PIN" value={pin2} onChange={e => setPin2(e.target.value.replace(/\D+/g, "").slice(0, 8))} />
            </div>
          </Row>
          <Row>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={savePin} disabled={!pin1 || !pin2}>{prefs.lockPinHash ? "Replace PIN" : "Save PIN"}</Button>
              {prefs.lockPinHash && <Button variant="ghost" onClick={clearPin}>Clear PIN</Button>}
              <span style={{ alignSelf: "center", fontSize: 12, color: prefs.lockPinHash ? colors.success : "#fbbf24" }}>
                {prefs.lockPinHash ? "PIN is set" : "No PIN — manager actions are unprotected"}
              </span>
            </div>
            {pinMsg && <div style={{ marginTop: 8 }}><Banner kind="info">{pinMsg}</Banner></div>}
          </Row>
          <Row>
            <Toggle
              label="Warn before quitting / reloading (unsaved cart protection)"
              checked={prefs.warnBeforeExit}
              onChange={(v) => update({ warnBeforeExit: v })}
            />
          </Row>
        </Card>

        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Customer-facing display</h3>
          <Row>
            <Toggle
              label="Enable second-screen customer display"
              checked={prefs.customerDisplay}
              onChange={v => update({ customerDisplay: v })}
            />
          </Row>
          <Row>
            <Label>Idle tagline</Label>
            <Input
              value={prefs.customerDisplayTagline}
              onChange={e => update({ customerDisplayTagline: e.target.value })}
              placeholder="Welcome — Thank you for dining with us"
            />
          </Row>
          <Row>
            <Button onClick={launchDisplay}>⇗ Launch display window</Button>
          </Row>
        </Card>

        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Payment defaults</h3>
          <Row>
            <Label>Default tender</Label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["cash", "upi", "card"] as const).map(k => (
                <Pill key={k} active={prefs.defaultTender === k} onClick={() => update({ defaultTender: k })}>{k.toUpperCase()}</Pill>
              ))}
            </div>
          </Row>
          <Row>
            <Toggle label="Auto-print bill on payment success" checked={prefs.autoPrintBill} onChange={(v) => update({ autoPrintBill: v })} />
          </Row>
          <Row>
            <Toggle label="Auto-open cash drawer (cash only — wired in main process)" checked={prefs.autoOpenDrawer} onChange={(v) => update({ autoOpenDrawer: v })} />
          </Row>
        </Card>

        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Sound feedback</h3>
          <Row>
            <Toggle
              label="Sounds on action"
              checked={sounds.prefs.enabled}
              onChange={(v) => sounds.update({ enabled: v })}
            />
          </Row>
          <Row>
            <Toggle
              label="Mute all sounds for this shift"
              checked={sounds.prefs.muteForShift}
              onChange={(v) => sounds.update({ muteForShift: v })}
            />
          </Row>
          <Row>
            <Label>Volume · {Math.round(sounds.prefs.volume * 100)}%</Label>
            <input
              type="range" min={0} max={1} step={0.05}
              value={sounds.prefs.volume}
              onChange={(e) => sounds.update({ volume: Number(e.target.value) })}
              style={{ width: "100%" }}
            />
          </Row>
          <Row>
            <Label>Per-event tones</Label>
            <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
              {SOUND_EVENTS.map(ev => (
                <div key={ev.key} style={{
                  display: "grid", gridTemplateColumns: "150px 1fr auto", gap: 8, alignItems: "center",
                }}>
                  <span style={{ fontSize: 12, color: colors.textDim }}>{ev.label}</span>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {TONE_PRESETS.map(p => (
                      <Pill
                        key={p}
                        active={sounds.prefs.tones[ev.key] === p}
                        onClick={() => sounds.update({ tones: { ...sounds.prefs.tones, [ev.key]: p } })}
                      >{p}</Pill>
                    ))}
                  </div>
                  <Button variant="ghost" onClick={() => sounds.play(ev.key)} style={{ padding: "4px 10px", fontSize: 12 }}>Test</Button>
                </div>
              ))}
            </div>
          </Row>
        </Card>

        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Desktop app behaviour</h3>
          <p style={{ color: colors.textMuted, fontSize: 12, marginTop: 0 }}>
            Hints picked up by the Electron shell on next launch.
          </p>
          <Row>
            <Toggle label="Start directly on the POS screen" checked={prefs.startInPos} onChange={(v) => update({ startInPos: v })} />
          </Row>
          <Row>
            <Toggle label="Launch in full-screen / kiosk mode" checked={prefs.fullscreen} onChange={(v) => update({ fullscreen: v })} />
          </Row>
          <Row>
            <Toggle label="Auto-launch when the terminal boots" checked={prefs.autoLaunch} onChange={(v) => update({ autoLaunch: v })} />
          </Row>
          <Row>
            <Toggle label="Keep display awake during shift" checked={prefs.keepAwake} onChange={(v) => update({ keepAwake: v })} />
          </Row>
        </Card>

        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>About this build</h3>
          <Row>
            <div style={{ fontSize: 13 }}>
              <div>Version: <b>{version}</b></div>
              <div style={{ color: colors.textDim, marginTop: 4 }}>Khanalagao POS · Desktop terminal</div>
            </div>
          </Row>
          <Row>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" disabled={checking} onClick={checkUpdate}>
                {checking ? "Checking…" : "Check for updates"}
              </Button>
            </div>
            {updateMsg && <div style={{ marginTop: 8 }}><Banner kind="info">{updateMsg}</Banner></div>}
          </Row>
        </Card>

        <Card>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Reset / sign out</h3>
          <Row>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" onClick={reset}>Reset preferences to defaults</Button>
              {onSignOut && (
                <Button variant="danger" onClick={secureLogout}>Secure sign out (wipe local cache)</Button>
              )}
            </div>
          </Row>
        </Card>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 12 }}>{children}</div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? colors.brand : colors.panelAlt,
        color: active ? "#fff" : colors.textPrimary,
        border: 0, padding: "6px 12px", borderRadius: 6,
        fontSize: 12, fontWeight: 600, cursor: "pointer",
        textTransform: "capitalize",
      }}
    >{children}</button>
  );
}
