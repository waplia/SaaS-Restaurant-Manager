import { useState } from "react";
import type { SelectionState, User } from "../../../shared/ipc-contract";
import { Button, Input, Label, Banner, BrandHeader, FullscreenCenter, colors } from "../ui/components";

interface Props {
  selection: SelectionState;
  user: User;
  onOpened: () => void;
  onBack: () => void;
}

export function ShiftOpenScreen({ selection, user, onOpened, onBack }: Props) {
  const [openingCash, setOpeningCash] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(openingCash);
    if (Number.isNaN(amount) || amount < 0) { setError("Enter a valid opening cash amount."); return; }
    setBusy(true); setError(null);
    try {
      await window.khanalagao.shifts.open({ openingCash: amount, notes: notes.trim() || undefined });
      onOpened();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FullscreenCenter>
      <form onSubmit={submit} style={{
        width: 440,
        background: colors.panel,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 36,
      }}>
        <BrandHeader subtitle="Open your shift" />

        <div style={{
          background: colors.bg, border: `1px solid ${colors.border}`,
          borderRadius: 8, padding: 12, marginBottom: 18, fontSize: 13, color: colors.textDim,
        }}>
          <div><b style={{ color: colors.textPrimary }}>{user.name}</b></div>
          <div>{selection.branchName} · Counter: {selection.counterName}</div>
        </div>

        {error && <div style={{ marginBottom: 14 }}><Banner kind="error">{error}</Banner></div>}

        <div style={{ marginBottom: 14 }}>
          <Label>Opening cash (₹)</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="100"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
            placeholder="0"
            autoFocus
            disabled={busy}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <Label>Notes (optional)</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. handed over from morning shift"
            disabled={busy}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>← Back</Button>
          <Button type="submit" disabled={busy} style={{ flex: 1 }}>
            {busy ? "Opening shift…" : "Open shift"}
          </Button>
        </div>
      </form>
    </FullscreenCenter>
  );
}
