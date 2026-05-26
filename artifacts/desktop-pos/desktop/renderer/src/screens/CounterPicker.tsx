import { useEffect, useState } from "react";
import type { SelectionState, Terminal } from "../../../shared/ipc-contract";
import { Button, Card, Banner, BrandHeader, FullscreenCenter, Spinner, colors } from "../ui/components";

interface Props {
  selection: SelectionState;
  onPicked: (selection: SelectionState) => void;
  onBack: () => void;
}

export function CounterPickerScreen({ selection, onPicked, onBack }: Props) {
  const [terminals, setTerminals] = useState<Terminal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selection.restaurantId) return;
    window.khanalagao.terminals.list({
      restaurantId: selection.restaurantId,
      branchId: selection.branchId ?? undefined,
    })
      .then(setTerminals)
      .catch((err) => setError((err as Error).message));
  }, [selection.restaurantId, selection.branchId]);

  const pick = async (t: Terminal) => {
    setBusy(true); setError(null);
    try {
      const next = await window.khanalagao.selection.setCounter({ counterId: t.id, counterName: t.name });
      onPicked(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FullscreenCenter>
      <div style={{ width: "min(960px, 95vw)" }}>
        <BrandHeader subtitle={`Pick your counter at ${selection.branchName ?? "this outlet"}`} />
        {error && <div style={{ marginBottom: 16 }}><Banner kind="error">{error}</Banner></div>}

        {!terminals && <div style={{ display: "grid", placeItems: "center", padding: 40 }}><Spinner /></div>}

        {terminals && (
          <div style={{
            display: "grid", gap: 16,
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}>
            {terminals.length === 0 && (
              <div style={{ color: colors.textDim, gridColumn: "1 / -1", textAlign: "center", padding: 40 }}>
                No counters configured for this outlet. Ask your manager to add one.
              </div>
            )}
            {terminals.map((t) => (
              <Card key={t.id} onClick={() => !busy && pick(t)} selected={selection.counterId === t.id}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{t.name}</div>
                <div style={{ color: colors.textDim, fontSize: 12, marginTop: 6, display: "flex", gap: 8 }}>
                  {t.type && <span>{t.type}</span>}
                  {t.status && <span>· {t.status}</span>}
                </div>
              </Card>
            ))}
          </div>
        )}

        <div style={{ marginTop: 20, textAlign: "center" }}>
          <Button variant="ghost" onClick={onBack} disabled={busy}>← Change outlet</Button>
        </div>
      </div>
    </FullscreenCenter>
  );
}
