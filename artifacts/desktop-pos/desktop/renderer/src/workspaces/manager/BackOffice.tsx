/**
 * BackOffice — modern Manager-Office landing page that replaces the
 * legacy "wall of blue buttons" UI. Renders every back-office module as
 * a searchable, group-filterable tile grid. Each tile shows the module
 * name, group, and permission/module badges so admins can see at a
 * glance which roles / plans a tile requires.
 *
 * The tile list is derived from the visible nav items the shell passes
 * in — gating already happened upstream (the shell only emits items the
 * signed-in user can access), so the Back Office index always agrees
 * with the sidebar. Service modules (POS, Tables, Kitchen, QR) live on
 * the sidebar — this index hides them so it stays focused on
 * back-office work.
 */
import { useMemo, useState } from "react";
import type { NavItem } from "../types";
import { Input, colors } from "../../ui/components";
import { MANAGER_DEEP_LINKS } from "./registry";

interface Props {
  items: NavItem[];
  onNavigate: (key: string) => void;
}

interface Section {
  title: string;
  description: string;
  groups: string[];
}

/** Curated section ordering — keys present in `NavItem.group` get
 *  bucketed here. Any group not listed falls into the "Other" bucket
 *  so newly added items always appear instead of being silently lost. */
const SECTIONS: Section[] = [
  { title: "Restaurant setup", description: "Outlet, menu, tables, kitchens.", groups: ["Restaurant", "Catalog", "Menu", "Service", "Overview"] },
  { title: "People", description: "Staff, attendance, customers and loyalty.", groups: ["People", "Customers"] },
  { title: "Operations", description: "Inventory, purchasing, providers.", groups: ["Inventory", "Procurement", "Providers", "Channels"] },
  { title: "Finance", description: "Payments, expenses, taxes, settlements.", groups: ["Finance", "Payments"] },
  { title: "Growth", description: "Marketing, AI, campaigns.", groups: ["Growth", "Khana AI", "Insights"] },
  { title: "Reports", description: "Daily reports, exports, analytics.", groups: ["Reports"] },
  { title: "System", description: "Hardware, integrations, sync, logs.", groups: ["Hardware", "Settings", "System"] },
];

/** Service group keys hidden from the Back Office (they live on the
 *  sidebar already and aren't "back office" work). */
const HIDE_GROUPS = new Set<string>(["Service"]);

export function BackOffice({ items, onNavigate }: Props) {
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);

  // Hide the index itself + service modules (they have their own home).
  const usable = useMemo(() => items.filter(it =>
    it.key !== "backoffice" && !HIDE_GROUPS.has(it.group)
  ), [items]);

  const groups = useMemo(() => {
    const set = new Set(usable.map(i => i.group));
    return Array.from(set);
  }, [usable]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return usable.filter(it => {
      if (groupFilter && it.group !== groupFilter) return false;
      if (!needle) return true;
      const hay = [it.label, it.group, ...(it.aliases ?? [])].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [usable, q, groupFilter]);

  // Bucket the filtered list into sections; orphans fall into "Other".
  const used = new Set<string>();
  const bucket: Array<{ section: Section; rows: NavItem[] }> = SECTIONS.map(section => {
    const rows = filtered.filter(it => section.groups.includes(it.group));
    rows.forEach(r => used.add(r.key));
    return { section, rows };
  }).filter(b => b.rows.length > 0);
  const orphans = filtered.filter(it => !used.has(it.key));
  if (orphans.length > 0) {
    bucket.push({
      section: { title: "Other", description: "Additional modules.", groups: [] },
      rows: orphans,
    });
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, background: colors.bg, color: colors.textPrimary }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700 }}>Back office</h1>
        <p style={{ margin: "0 0 18px", color: colors.textDim, fontSize: 14, maxWidth: 760, lineHeight: 1.6 }}>
          One place to reach every Manager-Office surface. Service modules (POS, Tables,
          Kitchen, QR) live on the sidebar — this index covers setup, growth and
          back-office work. Use search or filter by group.
        </p>

        {/* ─── Search + group filter ─── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px", minWidth: 240, maxWidth: 420 }}>
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search modules…"
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Chip active={groupFilter === null} onClick={() => setGroupFilter(null)}>
              All ({usable.length})
            </Chip>
            {groups.map(g => {
              const n = usable.filter(i => i.group === g).length;
              return (
                <Chip key={g} active={groupFilter === g} onClick={() => setGroupFilter(g)}>
                  {g} <span style={{ opacity: 0.6 }}>({n})</span>
                </Chip>
              );
            })}
          </div>
        </div>

        {bucket.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: colors.textMuted }}>
            Nothing matches.
          </div>
        )}

        {bucket.map(({ section, rows }) => (
          <section key={section.title} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: colors.textDim }}>
                {section.title}
              </h2>
              <div style={{ fontSize: 11, color: colors.textMuted }}>{section.description}</div>
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 10,
            }}>
              {rows.map(it => (
                <button
                  key={it.key}
                  onClick={() => onNavigate(it.key)}
                  style={{
                    textAlign: "left", padding: 14,
                    background: colors.panel, border: `1px solid ${colors.border}`,
                    borderRadius: 10, color: colors.textPrimary, cursor: "pointer",
                    display: "flex", flexDirection: "column", gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{
                      width: 34, height: 34, borderRadius: 9,
                      background: `linear-gradient(135deg, ${colors.brand} 0%, ${colors.brandHover} 100%)`,
                      color: "#fff", display: "grid", placeItems: "center", fontSize: 16,
                      boxShadow: `0 2px 8px ${colors.brand}33`,
                    }}>{it.icon ?? "•"}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{it.label}</div>
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{it.group}</div>
                    </span>
                    <span style={{ color: colors.brand, fontSize: 14 }}>→</span>
                  </div>
                  {(it.requiredPermissions?.length || it.requiredModules?.length || it.requiredFeature) && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(it.requiredPermissions ?? []).map(p => (
                        <Badge key={p} kind="perm">{p}</Badge>
                      ))}
                      {(it.requiredModules ?? []).map(m => (
                        <Badge key={m} kind="module">plan:{m}</Badge>
                      ))}
                      {it.requiredFeature && (
                        <Badge kind="module">plan:{it.requiredFeature}</Badge>
                      )}
                    </div>
                  )}
                  {/*
                   * Surface every legacy sub-screen that lives behind
                   * this module as a discoverable chip. Clicking the
                   * card opens the module's WebAdminBridge tab strip,
                   * which navigates straight to the sub-path; we show
                   * the chips here so the Back Office index lists the
                   * full legacy option matrix, not just the top-level
                   * modules.
                   */}
                  {MANAGER_DEEP_LINKS[it.key]?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {MANAGER_DEEP_LINKS[it.key].slice(0, 8).map(a => (
                        <span key={a.label} style={{
                          fontSize: 10, padding: "1px 7px", borderRadius: 6,
                          background: colors.bg, color: colors.textMuted,
                          border: `1px solid ${colors.border}`,
                        }}>{a.label}</span>
                      ))}
                      {MANAGER_DEEP_LINKS[it.key].length > 8 && (
                        <span style={{ fontSize: 10, color: colors.textMuted }}>
                          +{MANAGER_DEEP_LINKS[it.key].length - 8} more
                        </span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? colors.brand : colors.panel,
        color: active ? "#fff" : colors.textDim,
        border: `1px solid ${active ? colors.brand : colors.border}`,
        borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 600,
        cursor: "pointer",
      }}
    >{children}</button>
  );
}

function Badge({ kind, children }: { kind: "perm" | "module"; children: React.ReactNode }) {
  const palette = kind === "perm"
    ? { bg: "rgba(59,130,246,0.12)", color: "#93c5fd", border: "rgba(59,130,246,0.32)" }
    : { bg: "rgba(168,85,247,0.12)", color: "#d8b4fe", border: "rgba(168,85,247,0.32)" };
  return (
    <span style={{
      background: palette.bg, color: palette.color,
      border: `1px solid ${palette.border}`,
      fontSize: 10, padding: "1px 7px", borderRadius: 999, fontFamily: "monospace",
    }}>{children}</span>
  );
}
