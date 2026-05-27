/**
 * Manager-PIN gate. Used to authorise destructive actions (void, comp,
 * cash drawer kick, role-locked nav). Validates against the locally
 * stored hash from useAppPrefs.lockPinHash. When no PIN is set the
 * gate still asks for confirmation so the prompt is never silently
 * bypassed.
 */
import { useState } from "react";
import { Banner, Button, Input, colors } from "../ui/components";
import { Modal } from "./order/Modals";
import { hashPin, getAppPrefs } from "../hooks/useAppPrefs";

interface Props {
  title?: string;
  reason: string;
  onCancel: () => void;
  onAllow: () => void;
}

export function ManagerPinModal({ title = "Manager authorisation", reason, onCancel, onAllow }: Props) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const expected = getAppPrefs().lockPinHash;

  async function submit() {
    setBusy(true); setErr(null);
    try {
      if (!expected) {
        if (!window.confirm(`No manager PIN is configured. Proceed with ${reason}?`)) {
          onCancel(); return;
        }
        onAllow(); return;
      }
      const got = await hashPin(pin);
      if (got === expected) { onAllow(); return; }
      setErr("Wrong PIN — try again.");
    } finally { setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onCancel} width={380}>
      <div style={{ fontSize: 13, color: colors.textDim, marginBottom: 12 }}>{reason}</div>
      {err && <div style={{ marginBottom: 10 }}><Banner kind="error">{err}</Banner></div>}
      <Input
        autoFocus
        type="password"
        inputMode="numeric"
        placeholder="Enter PIN"
        value={pin}
        onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
        onKeyDown={e => { if (e.key === "Enter") void submit(); }}
      />
      <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? "Checking…" : "Authorise"}</Button>
      </div>
      {!expected && (
        <div style={{ marginTop: 10, fontSize: 11, color: colors.textMuted }}>
          Tip: configure a manager PIN under App settings → Security.
        </div>
      )}
    </Modal>
  );
}
