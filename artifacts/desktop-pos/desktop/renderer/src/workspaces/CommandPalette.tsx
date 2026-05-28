/**
 * Command palette (Ctrl+K / Cmd+K).
 *
 * Fuzzy search over the active workspace's nav items, recents and
 * favorites. Permission-/module-gated identically to the left rail, so
 * a user can never "find their way" into a screen they can't see.
 * Keyboard first: ↑/↓ to navigate, Enter to open, Esc to dismiss.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { colors } from "../ui/components";
import type { NavItem, AccessContext } from "./types";
import { hasAllModules, hasAnyPermission } from "./roles";

interface Props {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  access: AccessContext;
  favorites: string[];
  recents: string[];
  onPick: (item: NavItem) => void;
  /** Optional label shown in the empty-search hint. */
  workspaceLabel?: string;
}

interface Row {
  item: NavItem;
  rank: number;
  badge?: "favorite" | "recent";
}

function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 700 - (t.length - q.length);
  const idx = t.indexOf(q);
  if (idx >= 0) return 500 - idx;
  // Subsequence fallback.
  let ti = 0, score = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const found = t.indexOf(c, ti);
    if (found < 0) return -1;
    score += 10 - Math.min(9, found - ti);
    ti = found + 1;
  }
  return score;
}

function matchScore(item: NavItem, query: string): number {
  if (!query) return 0;
  const candidates = [item.label, item.group, ...(item.aliases ?? [])];
  let best = -1;
  for (const c of candidates) {
    const s = fuzzyScore(query, c);
    if (s > best) best = s;
  }
  return best;
}

export function CommandPalette({
  open, onClose, items, access, favorites, recents, onPick, workspaceLabel,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Filter to items the user can see — same gates as the left rail.
  const visible = useMemo(() => items.filter(it =>
    hasAnyPermission(access, it.requiredPermissions) && hasAllModules(access, it.requiredModules)
  ), [items, access]);

  const rows: Row[] = useMemo(() => {
    if (query.trim()) {
      const q = query.trim();
      const scored: Row[] = [];
      for (const item of visible) {
        const rank = matchScore(item, q);
        if (rank >= 0) scored.push({ item, rank });
      }
      scored.sort((a, b) => b.rank - a.rank);
      return scored.slice(0, 30);
    }
    // No query — show favorites first, then recents, then the rest by group.
    const byKey = new Map(visible.map(i => [i.key, i] as const));
    const result: Row[] = [];
    const seen = new Set<string>();
    for (const k of favorites) {
      const it = byKey.get(k);
      if (it && !seen.has(k)) { result.push({ item: it, rank: 0, badge: "favorite" }); seen.add(k); }
    }
    for (const k of recents) {
      const it = byKey.get(k);
      if (it && !seen.has(k)) { result.push({ item: it, rank: 0, badge: "recent" }); seen.add(k); }
    }
    for (const it of visible) {
      if (!seen.has(it.key)) result.push({ item: it, rank: 0 });
    }
    return result.slice(0, 30);
  }, [visible, query, favorites, recents]);

  useEffect(() => {
    if (open) {
      setQuery(""); setSelected(0);
      // Focus on next tick so the modal mount finishes first.
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => { setSelected(0); }, [query]);

  if (!open) return null;

  const pick = (idx: number) => {
    const row = rows[idx];
    if (!row) return;
    onPick(row.item);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(rows.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected(s => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(selected); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        background: "rgba(3,7,15,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "10vh",
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        onKeyDown={onKey}
        style={{
          width: "min(640px, 92vw)",
          background: colors.panel,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
          overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 16px",
          borderBottom: `1px solid ${colors.border}`,
        }}>
          <span style={{ color: colors.textMuted, fontSize: 16 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={workspaceLabel ? `Search ${workspaceLabel}…` : "Search…"}
            style={{
              flex: 1, background: "transparent", border: 0, outline: 0,
              color: colors.textPrimary, fontSize: 15,
            }}
          />
          <kbd style={{
            background: colors.panelAlt, padding: "2px 6px", borderRadius: 4,
            border: `1px solid ${colors.borderStrong}`,
            fontFamily: "monospace", fontSize: 10, color: colors.textDim,
          }}>Esc</kbd>
        </div>

        <div style={{ maxHeight: 380, overflowY: "auto", padding: "6px 0" }}>
          {rows.length === 0 && (
            <div style={{ padding: "28px 16px", textAlign: "center", color: colors.textMuted, fontSize: 13 }}>
              No matches.
            </div>
          )}
          {rows.map((row, i) => {
            const active = i === selected;
            return (
              <button
                key={row.item.key}
                onMouseEnter={() => setSelected(i)}
                onClick={() => pick(i)}
                style={{
                  width: "100%", textAlign: "left",
                  background: active ? colors.panelAlt : "transparent",
                  border: 0, padding: "10px 16px",
                  display: "flex", alignItems: "center", gap: 10,
                  color: colors.textPrimary, fontSize: 13, cursor: "pointer",
                  borderLeft: `3px solid ${active ? colors.brand : "transparent"}`,
                }}
              >
                <span style={{
                  width: 22, height: 22, display: "grid", placeItems: "center",
                  color: active ? colors.brand : colors.textDim,
                }}>{row.item.icon ?? "•"}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{row.item.label}</span>
                {row.badge === "favorite" && (
                  <span style={{ fontSize: 11, color: "#fbbf24" }}>★ Pinned</span>
                )}
                {row.badge === "recent" && (
                  <span style={{ fontSize: 11, color: colors.textMuted }}>Recent</span>
                )}
                <span style={{ fontSize: 11, color: colors.textMuted }}>{row.item.group}</span>
                {row.item.comingSoon && (
                  <span style={{
                    fontSize: 10, color: "#fed7aa",
                    background: "rgba(234,88,12,0.15)", border: "1px solid rgba(234,88,12,0.35)",
                    padding: "1px 6px", borderRadius: 999,
                  }}>Soon</span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{
          padding: "8px 14px", borderTop: `1px solid ${colors.border}`,
          fontSize: 11, color: colors.textMuted, display: "flex", gap: 14,
        }}>
          <span><b>↑↓</b> navigate</span>
          <span><b>↵</b> open</span>
          <span><b>Esc</b> close</span>
          <span style={{ marginLeft: "auto" }}>{rows.length} item{rows.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
