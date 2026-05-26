import { useEffect, useState } from "react";
import type { SelectionState } from "../../../shared/ipc-contract";
import { Button, Input, Label, Banner, BrandHeader, FullscreenCenter, colors } from "../ui/components";

interface Props {
  selection: SelectionState;
  onPicked: (selection: SelectionState) => void;
  onBack: () => void;
}

export function CounterPickerScreen({ selection, onPicked, onBack }: Props) {
  const [name, setName] = useState<string>(selection.counterName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.khanalagao.selection.suggestCounterName()
      .then((r) => {
        if (cancelled) return;
        if (!name) setName(r.existingName ?? r.suggestion);
      })
      .catch(() => { /* fall back to whatever's in state */ })
      .finally(() => { if (!cancelled) setLoadingSuggestion(false); });
    return () => { cancelled = true; };
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError("Give this counter a name (e.g. Counter 1, Front Cash)"); return; }
    setBusy(true); setError(null);
    try {
      const next = await window.khanalagao.selection.registerLocalCounter({ counterName: trimmed });
      onPicked(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FullscreenCenter>
      <form onSubmit={save} style={{
        width: 480,
        background: colors.panel,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: 36,
      }}>
        <BrandHeader subtitle={`Name this counter at ${selection.branchName ?? "this outlet"}`} />

        {error && <div style={{ marginBottom: 14 }}><Banner kind="error">{error}</Banner></div>}

        <div style={{ marginBottom: 16 }}>
          <Label>Counter name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Counter 1"
            disabled={busy || loadingSuggestion}
            autoFocus
            maxLength={60}
          />
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 8, lineHeight: 1.5 }}>
            This name identifies this workstation in reports, KOTs, and Z-reports.
            Each cash drawer / counter at your outlet should run its own desktop
            install with a different name (e.g. "Counter 1", "Bar Counter", "Front Cash").
          </div>
        </div>

        <Button type="submit" disabled={busy || !name.trim()} style={{ width: "100%" }}>
          {busy ? "Saving…" : selection.counterId ? "Update counter name" : "Use this workstation as a counter"}
        </Button>

        <div style={{ marginTop: 18, textAlign: "center" }}>
          <Button variant="ghost" type="button" onClick={onBack} disabled={busy}>← Change outlet</Button>
        </div>
      </form>
    </FullscreenCenter>
  );
}
