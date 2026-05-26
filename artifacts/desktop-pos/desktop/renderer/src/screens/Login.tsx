import { useState } from "react";
import type { User } from "../../../shared/ipc-contract";
import { Button, Input, Label, Banner, BrandHeader, FullscreenCenter, colors } from "../ui/components";

interface Props {
  apiBaseUrl: string;
  onSignedIn: (user: User) => void;
  onOpenSettings: () => void;
}

export function LoginScreen({ apiBaseUrl, onSignedIn, onOpenSettings }: Props) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier || !password) return;
    setBusy(true); setError(null);
    try {
      const r = await window.khanalagao.auth.login({
        identifier: identifier.trim(),
        password,
        rememberDevice: remember,
      });
      onSignedIn(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FullscreenCenter>
      <form onSubmit={submit} style={{
        width: 420,
        background: colors.panel,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 36,
      }}>
        <BrandHeader subtitle="Sign in to start your shift" />
        {error && <div style={{ marginBottom: 14 }}><Banner kind="error">{error}</Banner></div>}

        <div style={{ marginBottom: 14 }}>
          <Label>Email or phone</Label>
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="cashier@restaurant.com"
            autoFocus
            disabled={busy}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <Label>Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={busy}
          />
        </div>

        <label style={{
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 13, color: colors.textDim, marginBottom: 20, cursor: "pointer",
        }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember this device
        </label>

        <Button type="submit" disabled={busy || !identifier || !password} style={{ width: "100%" }}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        <div style={{
          marginTop: 24, paddingTop: 16,
          borderTop: `1px solid ${colors.border}`,
          fontSize: 12, color: colors.textMuted, textAlign: "center",
        }}>
          Connected to <span style={{ color: colors.textDim }}>{apiBaseUrl || "(not configured)"}</span>
          <button
            type="button"
            onClick={onOpenSettings}
            style={{
              background: "none", border: 0, color: colors.brand,
              cursor: "pointer", marginLeft: 8, fontSize: 12,
            }}
          >Change</button>
        </div>
      </form>
    </FullscreenCenter>
  );
}
