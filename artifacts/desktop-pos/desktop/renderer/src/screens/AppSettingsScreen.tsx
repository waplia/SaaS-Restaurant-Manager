/**
 * App settings — terminal-local preferences for the cashier.
 *
 * Persists to localStorage via the `useAppPrefs` hook. Some toggles (start
 * in POS, auto-launch, fullscreen, keep awake) are hints to the desktop
 * shell — the main process picks them up on next launch where supported.
 */
import { useEffect, useState } from "react";
import { Banner, Button, Card, Input, Label, colors } from "../ui/components";
import { useAppPrefs } from "../hooks/useAppPrefs";
import { useSounds } from "../hooks/useSounds";

interface Props {
  onSignOut?: () => void;
}

export function AppSettingsScreen({ onSignOut }: Props) {
  const { prefs, update, reset } = useAppPrefs();
  const sounds = useSounds();
  const [version, setVersion] = useState<string>("…");
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

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

  return (
    <div style={{ overflow: "auto", padding: 24, flex: 1 }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 22 }}>App settings</h2>
        <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
          Per-terminal preferences. Stored locally — nothing is sent to the server.
        </p>

        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Display</h3>
          <Row>
            <Label>Cashier name (shown on bill header)</Label>
            <Input value={prefs.cashierName} onChange={(e) => update({ cashierName: e.target.value })} placeholder="Cashier 1" />
          </Row>
          <Row>
            <Toggle
              label="Show item images on the menu grid"
              checked={prefs.showItemImages}
              onChange={(v) => update({ showItemImages: v })}
            />
          </Row>
          <Row>
            <Toggle
              label="Compact cart rows (dense)"
              checked={prefs.compactCart}
              onChange={(v) => update({ compactCart: v })}
            />
          </Row>
          <Row>
            <Label>Default menu layout</Label>
            <div style={{ display: "flex", gap: 8 }}>
              <Pill active={prefs.menuLayout === "image"} onClick={() => update({ menuLayout: "image" })}>Image cards</Pill>
              <Pill active={prefs.menuLayout === "compact"} onClick={() => update({ menuLayout: "compact" })}>Compact</Pill>
            </div>
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
            <Toggle
              label="Auto-print bill on payment success"
              checked={prefs.autoPrintBill}
              onChange={(v) => update({ autoPrintBill: v })}
            />
          </Row>
          <Row>
            <Toggle
              label="Auto-open cash drawer (cash only — wired in main process)"
              checked={prefs.autoOpenDrawer}
              onChange={(v) => update({ autoOpenDrawer: v })}
            />
          </Row>
        </Card>

        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Sound feedback</h3>
          <Row>
            <Toggle
              label="Sounds on action (add / remove / pay / error)"
              checked={sounds.prefs.enabled}
              onChange={(v) => sounds.update({ enabled: v })}
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
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Button variant="ghost" onClick={() => sounds.play("add")}>Test add</Button>
              <Button variant="ghost" onClick={() => sounds.play("pay")}>Test pay</Button>
              <Button variant="ghost" onClick={() => sounds.play("error")}>Test error</Button>
              <Button variant="ghost" onClick={() => sounds.play("kot")}>Test KOT</Button>
            </div>
          </Row>
        </Card>

        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Desktop app behaviour</h3>
          <p style={{ color: colors.textMuted, fontSize: 12, marginTop: 0 }}>
            Hints picked up by the Electron shell on next launch.
          </p>
          <Row>
            <Toggle
              label="Start directly on the POS screen"
              checked={prefs.startInPos} onChange={(v) => update({ startInPos: v })}
            />
          </Row>
          <Row>
            <Toggle
              label="Launch in full-screen / kiosk mode"
              checked={prefs.fullscreen} onChange={(v) => update({ fullscreen: v })}
            />
          </Row>
          <Row>
            <Toggle
              label="Auto-launch when the terminal boots"
              checked={prefs.autoLaunch} onChange={(v) => update({ autoLaunch: v })}
            />
          </Row>
          <Row>
            <Toggle
              label="Keep display awake during shift"
              checked={prefs.keepAwake} onChange={(v) => update({ keepAwake: v })}
            />
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
      }}
    >{children}</button>
  );
}
