/**
 * WebAdminBridge — Manager-Office module pane that embeds the web admin
 * UI **inside** the desktop shell using Electron's `<webview>` tag. The
 * desktop and the web admin run against the same API base URL, so the
 * user's existing sign-in cookie is shared automatically via Electron's
 * default session — no second login.
 *
 * The bridge renders a top tab strip (primary + alternate sub-paths), a
 * back / reload / open-external toolbar, and a single embedded webview
 * that fills the rest of the pane. Users stay inside the Manager
 * workspace; nothing ever pops out to the OS browser unless they
 * explicitly click "Open externally".
 *
 * As native desktop IPC lands for each module (see `GAPS.md`), swap
 * `WebAdminBridge` for the real screen in `registry.tsx` — the shell
 * doesn't change.
 */
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Banner, Spinner, colors } from "../../ui/components";

interface Action {
  label: string;
  /** Path on the web admin (joined onto `apiBaseUrl`). */
  path: string;
  /** Short helper line under the action. */
  hint?: string;
}

interface Props {
  title: string;
  group: string;
  /** Short paragraph describing what this module does. */
  description: string;
  /** Bullet list rendered above the actions — what an operator can do. */
  capabilities?: string[];
  /** Primary deep-link actions. First one is the default tab. */
  actions: Action[];
  /** Optional muted note explaining the IPC gap, shown at the bottom. */
  ipcNote?: string;
}

// Local typing for the <webview> element — Electron exposes a few imperative
// methods on the DOM node that aren't in React's standard typings.
type WebViewEl = HTMLElement & {
  src: string;
  reload(): void;
  goBack(): void;
  canGoBack(): boolean;
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
};

export function WebAdminBridge({
  title, group, description, capabilities, actions, ipcNote,
}: Props) {
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<WebViewEl | null>(null);

  useEffect(() => {
    window.khanalagao?.settings?.get()
      .then(s => setApiBaseUrl(s.apiBaseUrl ?? null))
      .catch(() => setApiBaseUrl(null));
  }, []);

  const url = useMemo(() => {
    if (!apiBaseUrl || !actions[activeIdx]) return null;
    try {
      return new URL(actions[activeIdx].path, apiBaseUrl).toString();
    } catch {
      return null;
    }
  }, [apiBaseUrl, activeIdx, actions]);

  // Wire load / fail events on the webview element.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onStart = () => { setLoading(true); setError(null); };
    const onStop = () => setLoading(false);
    const onFail = (e: Event) => {
      const ev = e as Event & { errorDescription?: string };
      setLoading(false);
      setError(ev.errorDescription ?? "Failed to load the web admin page.");
    };
    el.addEventListener("did-start-loading", onStart);
    el.addEventListener("did-stop-loading", onStop);
    el.addEventListener("did-fail-load", onFail);
    return () => {
      el.removeEventListener("did-start-loading", onStart);
      el.removeEventListener("did-stop-loading", onStop);
      el.removeEventListener("did-fail-load", onFail);
    };
  }, [url]);

  const reload = () => ref.current?.reload();
  const back = () => { const el = ref.current; if (el?.canGoBack()) el.goBack(); };
  const openExternal = () => {
    if (url) void window.khanalagao?.app?.openExternal(url);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: colors.bg, color: colors.textPrimary, minHeight: 0 }}>
      {/* ─── Header (title + capabilities) ─── */}
      <div style={{
        padding: "14px 20px 10px", borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{ fontSize: 10, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
          {group}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{title}</h1>
          <span style={{ fontSize: 12, color: colors.textDim }}>{description}</span>
        </div>
        {capabilities && capabilities.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8,
          }}>
            {capabilities.slice(0, 6).map((c, i) => (
              <span key={i} style={{
                background: colors.panel, border: `1px solid ${colors.border}`,
                color: colors.textDim, fontSize: 11, padding: "3px 8px",
                borderRadius: 999,
              }}>{c}</span>
            ))}
          </div>
        )}
      </div>

      {/* ─── Tabs + browser toolbar ─── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px", borderBottom: `1px solid ${colors.border}`,
        background: colors.panel,
      }}>
        <button
          onClick={back}
          title="Back"
          style={iconBtn}
        >←</button>
        <button
          onClick={reload}
          title="Reload"
          style={iconBtn}
        >⟳</button>
        <div style={{ display: "flex", gap: 4, overflow: "auto", flex: 1 }}>
          {actions.map((a, i) => (
            <button
              key={a.path}
              onClick={() => setActiveIdx(i)}
              title={a.hint ?? a.path}
              style={{
                whiteSpace: "nowrap", padding: "6px 12px", borderRadius: 6,
                border: `1px solid ${activeIdx === i ? colors.brand : "transparent"}`,
                background: activeIdx === i ? "rgba(234,88,12,0.15)" : "transparent",
                color: activeIdx === i ? "#fed7aa" : colors.textDim,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >{a.label}</button>
          ))}
        </div>
        <button onClick={openExternal} disabled={!url} title="Open in OS browser" style={iconBtn}>↗</button>
      </div>

      {/* ─── Embedded webview (or fallback) ─── */}
      <div style={{ flex: 1, position: "relative", minHeight: 0, background: "#0f1521" }}>
        {!apiBaseUrl && (
          <div style={{ padding: 24 }}>
            <Banner kind="info">
              Connect the desktop to your server first — open <b>Settings → Connection</b>.
            </Banner>
          </div>
        )}
        {apiBaseUrl && url && (
          <>
            {/* `webview` is an Electron-only intrinsic — React's JSX types
                don't know it, so we render via createElement to bypass JSX
                element-type checking without disabling type checking
                elsewhere in the file. */}
            {createElement("webview", {
              ref: (el: WebViewEl | null) => { ref.current = el; },
              src: url,
              // No `partition` attribute → use Electron's default
              // session, which is the same session the renderer process
              // uses to talk to the API. The user's sign-in cookie is
              // therefore shared automatically — no second login.
              style: {
                position: "absolute", inset: 0, width: "100%", height: "100%",
                border: 0, background: colors.bg,
              },
            })}
            {loading && (
              <div style={{
                position: "absolute", top: 12, right: 12,
                background: colors.panelAlt, border: `1px solid ${colors.border}`,
                padding: "4px 10px", borderRadius: 999, display: "flex", alignItems: "center", gap: 6,
                fontSize: 11, color: colors.textDim,
              }}>
                <Spinner size={12} /> Loading…
              </div>
            )}
            {error && (
              <div style={{ position: "absolute", top: 16, left: 16, right: 16 }}>
                <Banner kind="error">
                  {error}. <button onClick={reload} style={{ background: "transparent", border: 0, color: "#fde68a", textDecoration: "underline", cursor: "pointer" }}>Retry</button>
                </Banner>
              </div>
            )}
          </>
        )}
      </div>

      {ipcNote && (
        <div style={{
          padding: "8px 16px", borderTop: `1px solid ${colors.border}`,
          fontSize: 11, color: colors.textMuted, background: colors.panel,
        }}>
          <b style={{ color: colors.textDim }}>Embedded · </b>{ipcNote}
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  background: colors.bg, border: `1px solid ${colors.border}`,
  color: colors.textPrimary, cursor: "pointer", fontSize: 14,
  display: "grid", placeItems: "center",
};
