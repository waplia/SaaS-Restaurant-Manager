import { useState } from "react";
import { Button, Input, Label, Banner, BrandHeader, FullscreenCenter, colors } from "../ui/components";

interface Props {
  initialUrl: string;
  version: string;
  platform: string;
  onSaved: (apiBaseUrl: string) => void;
  onClose?: () => void;
}

export function ConnectionSettingsScreen({ initialUrl, version, platform, onSaved, onClose }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const save = async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("Enter a full URL — e.g. https://app.tabletrack.in");
      return;
    }
    setBusy(true); setError(null); setInfo(null);
    try {
      const next = await window.khanalagao.settings.set({ apiBaseUrl: trimmed });
      setInfo("Saved.");
      onSaved(next.apiBaseUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FullscreenCenter>
      <div style={{
        width: 480,
        background: colors.panel,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 36,
      }}>
        <BrandHeader subtitle="Connection settings" />

        {error && <div style={{ marginBottom: 14 }}><Banner kind="error">{error}</Banner></div>}
        {info && <div style={{ marginBottom: 14 }}><Banner kind="info">{info}</Banner></div>}

        <div style={{ marginBottom: 18 }}>
          <Label>Server URL</Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://app.tabletrack.in"
            disabled={busy}
          />
          <div style={{ color: colors.textMuted, fontSize: 11, marginTop: 6 }}>
            Default: https://app.tabletrack.in. Use a custom URL only if your team runs a self-hosted server.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {onClose && <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>}
          <Button onClick={save} disabled={busy || !url} style={{ flex: 1 }}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>

        <div style={{
          marginTop: 24, paddingTop: 16,
          borderTop: `1px solid ${colors.border}`,
          fontSize: 11, color: colors.textMuted, textAlign: "center",
        }}>
          Khanalagao POS v{version} · {platform}
          <div style={{ marginTop: 4 }}>
            Other settings (printers, sounds, shortcuts) arrive in later phases.
          </div>
        </div>
      </div>
    </FullscreenCenter>
  );
}
