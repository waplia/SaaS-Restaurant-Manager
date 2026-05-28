/**
 * SettingsHub — Manager-Office settings landing. Surfaces the desktop's
 * own connection + preferences (real, IPC-backed) and deep-links to the
 * web admin for the larger settings tree the desktop doesn't yet host
 * natively (outlet, branches, kitchens, printers config, templates,
 * accounting target, web push, sessions, …).
 */
import { useEffect, useState } from "react";
import type { ConnectionSettings } from "../../../../shared/ipc-contract";
import { Banner, Button, Input, colors } from "../../ui/components";
import { useAppPrefs } from "../../hooks/useAppPrefs";

interface Props {
  onNavigate?: (key: string) => void;
}

export function SettingsHub({ onNavigate }: Props) {
  const { prefs, update } = useAppPrefs();
  const [conn, setConn] = useState<ConnectionSettings | null>(null);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState<{ version: string; platform: string } | null>(null);

  useEffect(() => {
    void Promise.all([
      window.khanalagao.settings.get(),
      window.khanalagao.app.version().catch(() => null),
    ]).then(([c, v]) => {
      setConn(c); setUrl(c.apiBaseUrl); setVersion(v);
    }).catch(e => setErr((e as Error).message));
  }, []);

  const save = async () => {
    setSaving(true); setErr(null); setInfo(null);
    try {
      const next = await window.khanalagao.settings.set({ apiBaseUrl: url.trim() });
      setConn(next);
      setInfo("Saved — restart any open module to apply.");
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };

  const openWeb = (path: string) => {
    if (!conn?.apiBaseUrl) return;
    try {
      void window.khanalagao.app.openExternal(new URL(path, conn.apiBaseUrl).toString());
    } catch { /* ignore */ }
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, background: colors.bg, color: colors.textPrimary }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>Settings</h1>
        <div style={{ fontSize: 12, color: colors.textDim, marginBottom: 20 }}>
          Desktop-local settings live here. Tenant-wide configuration (outlet, taxes, kitchens,
          templates) opens the web admin.
        </div>

        {err && <Banner kind="error">{err}</Banner>}
        {info && <Banner kind="info">{info}</Banner>}

        <Card title="Connection">
          <label style={{ fontSize: 12, color: colors.textDim }}>API server</label>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://khanalagao.com" />
            <Button onClick={save} disabled={saving || !url.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8 }}>
            Build {version?.version ?? "—"} · {version?.platform ?? "—"}
          </div>
        </Card>

        <Card title="Appearance & density">
          <Row label="Theme">
            <Seg
              value={prefs.theme}
              options={[{ k: "dark", l: "Dark" }, { k: "light", l: "Light" }]}
              onChange={t => update({ theme: t as "dark" | "light" })}
            />
          </Row>
          <Row label="Density">
            <Seg
              value={prefs.density}
              options={[
                { k: "comfortable", l: "Comfortable" },
                { k: "compact", l: "Compact" },
                { k: "large-touch", l: "Large touch" },
              ]}
              onChange={d => update({ density: d as "comfortable" | "compact" | "large-touch" })}
            />
          </Row>
        </Card>

        <Card title="Desktop-local tools">
          <Tool label="Hardware (printers, drawer, scanner)" onClick={() => onNavigate?.("hardware")} />
          <Tool label="Sync queue & conflicts" onClick={() => onNavigate?.("sync")} />
          <Tool label="System & logs" onClick={() => onNavigate?.("system")} />
        </Card>

        <Card title="Open in web admin">
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 10 }}>
            These settings are still owned by the web admin — the desktop will host them natively in a future build.
          </div>
          <WebLink label="Outlet & branches" path="/settings" onClick={openWeb} disabled={!conn?.apiBaseUrl} />
          <WebLink label="Counters" path="/settings/counters" onClick={openWeb} disabled={!conn?.apiBaseUrl} />
          <WebLink label="Kitchens & stations" path="/settings/kitchens" onClick={openWeb} disabled={!conn?.apiBaseUrl} />
          <WebLink label="Bill & KOT templates" path="/settings/bill-templates" onClick={openWeb} disabled={!conn?.apiBaseUrl} />
          <WebLink label="Accounting target (Tally / Zoho)" path="/settings/accounting-target" onClick={openWeb} disabled={!conn?.apiBaseUrl} />
          <WebLink label="WhatsApp" path="/settings/whatsapp" onClick={openWeb} disabled={!conn?.apiBaseUrl} />
          <WebLink label="Web push" path="/settings/web-push" onClick={openWeb} disabled={!conn?.apiBaseUrl} />
          <WebLink label="Devices & sessions" path="/settings/sessions" onClick={openWeb} disabled={!conn?.apiBaseUrl} />
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: colors.panel, border: `1px solid ${colors.border}`,
      borderRadius: 12, padding: 18, marginBottom: 14,
    }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 0", borderTop: `1px solid ${colors.border}`,
    }}>
      <span style={{ fontSize: 13, color: colors.textDim }}>{label}</span>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: {
  value: T;
  options: Array<{ k: T; l: string }>;
  onChange: (k: T) => void;
}) {
  return (
    <div style={{ display: "inline-flex", background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 2 }}>
      {options.map(o => (
        <button
          key={o.k}
          onClick={() => onChange(o.k)}
          style={{
            background: value === o.k ? colors.brand : "transparent",
            color: value === o.k ? "#fff" : colors.textDim,
            border: 0, padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >{o.l}</button>
      ))}
    </div>
  );
}

function Tool({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        background: "transparent", border: 0, color: colors.textPrimary,
        padding: "10px 0", fontSize: 13, cursor: "pointer",
        borderTop: `1px solid ${colors.border}`,
      }}
    >{label} <span style={{ color: colors.brand, float: "right" }}>→</span></button>
  );
}

function WebLink({ label, path, onClick, disabled }: {
  label: string; path: string; onClick: (p: string) => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onClick(path)}
      disabled={disabled}
      style={{
        display: "block", width: "100%", textAlign: "left",
        background: "transparent", border: 0,
        color: disabled ? colors.textMuted : colors.textPrimary,
        padding: "8px 0", fontSize: 13, cursor: disabled ? "not-allowed" : "pointer",
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <span dangerouslySetInnerHTML={{ __html: label }} />
      <span style={{ color: colors.brand, float: "right" }}>↗</span>
    </button>
  );
}
