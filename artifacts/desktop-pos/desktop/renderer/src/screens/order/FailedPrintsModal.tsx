/**
 * Failed-prints inline modal — invoked from the topbar badge so the
 * cashier doesn't have to jump to Hardware to retry a job mid-service.
 */
import { useCallback, useEffect, useState } from "react";
import type { FailedPrintEntry } from "../../../../shared/ipc-contract";
import { Banner, Button, Spinner, colors } from "../../ui/components";
import { Modal } from "./Modals";

interface Props {
  onClose: () => void;
  online: boolean;
  onJumpToHardware?: () => void;
}

export function FailedPrintsModal({ onClose, online, onJumpToHardware }: Props) {
  const [items, setItems] = useState<FailedPrintEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await window.khanalagao.failedPrints.list();
      setItems(r);
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.khanalagao.failedPrints.onChanged(refresh);
    return () => { off(); };
  }, [refresh]);

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(c => c === m ? null : c), 2500); };

  async function retry(id: string) {
    setBusy(`retry_${id}`);
    try { await window.khanalagao.failedPrints.retry(id); flash("Retried."); void refresh(); }
    catch (e) { flash(`Retry failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }
  async function discard(id: string) {
    setBusy(`discard_${id}`);
    try { await window.khanalagao.failedPrints.discard(id); void refresh(); }
    catch (e) { flash(`Discard failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }
  async function clearAll() {
    if (!window.confirm("Clear all failed print jobs?")) return;
    setBusy("clear");
    try { await window.khanalagao.failedPrints.clear(); void refresh(); }
    finally { setBusy(null); }
  }

  return (
    <Modal title="Failed print queue" onClose={onClose} width={680}>
      {err && <div style={{ marginBottom: 10 }}><Banner kind="error">{err}</Banner></div>}
      {toast && <div style={{ marginBottom: 10 }}><Banner kind="info">{toast}</Banner></div>}
      {!items && <div style={{ display: "grid", placeItems: "center", padding: 30 }}><Spinner size={24} /></div>}

      {items && items.length === 0 && (
        <div style={{ color: colors.textDim, padding: 30, textAlign: "center" }}>
          All caught up — no failed jobs.
        </div>
      )}

      {items && items.length > 0 && (
        <>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 10,
          }}>
            <span style={{ fontSize: 12, color: colors.textDim }}>
              {items.length} job{items.length === 1 ? "" : "s"} need attention
            </span>
            <Button variant="ghost" disabled={busy === "clear"} onClick={clearAll}>Clear all</Button>
          </div>
          <div style={{ display: "grid", gap: 6, maxHeight: 420, overflowY: "auto" }}>
            {items.slice().reverse().map((entry) => (
              <div key={entry.id} style={{
                border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10,
                display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center",
                background: colors.bg,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{entry.summary}</div>
                  <div style={{ fontSize: 11, color: colors.textDim }}>
                    {new Date(entry.at).toLocaleString()}
                    {entry.printerName ? ` · ${entry.printerName}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: colors.danger, marginTop: 2, wordBreak: "break-word" }}>
                    {entry.error}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  disabled={!online || busy === `retry_${entry.id}`}
                  onClick={() => void retry(entry.id)}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >{busy === `retry_${entry.id}` ? "…" : "Retry"}</Button>
                <Button
                  variant="ghost"
                  disabled={busy === `discard_${entry.id}`}
                  onClick={() => void discard(entry.id)}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >Discard</Button>
              </div>
            ))}
          </div>
        </>
      )}

      {onJumpToHardware && (
        <div style={{ marginTop: 14, textAlign: "right" }}>
          <Button variant="ghost" onClick={onJumpToHardware}>Open hardware settings →</Button>
        </div>
      )}
    </Modal>
  );
}
