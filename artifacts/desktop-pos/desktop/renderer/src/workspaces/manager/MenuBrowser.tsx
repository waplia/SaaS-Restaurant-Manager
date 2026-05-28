/**
 * MenuBrowser — desktop-native, read-only menu explorer for the Manager
 * Office. The desktop IPC currently exposes `menu:list` (categories +
 * items) and `menu:modifiers` (per-item groups) but does NOT expose any
 * menu-write endpoints, so this surface is intentionally read-only and
 * deep-links to the web admin for create / edit. When mutation IPC
 * lands, swap the action buttons here without touching the shell.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MenuCategory, MenuItem, ModifierGroup,
} from "../../../../shared/ipc-contract";
import { Banner, Input, Spinner, colors } from "../../ui/components";

function fmtINR(n: number): string {
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `₹${Math.round(n).toLocaleString()}`;
  }
}

export function MenuBrowser() {
  const [bundle, setBundle] = useState<{ categories: MenuCategory[]; items: MenuItem[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [catId, setCatId] = useState<number | "all">("all");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [mods, setMods] = useState<ModifierGroup[] | null>(null);
  const [modsLoading, setModsLoading] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await window.khanalagao.menu.list({});
      setBundle(data);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.khanalagao?.settings?.get().then(s => setApiBaseUrl(s.apiBaseUrl ?? null)).catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!selected) { setMods(null); return; }
    setModsLoading(true);
    window.khanalagao.menu.modifiers({ menuItemId: selected.id })
      .then(g => setMods(g))
      .catch(() => setMods([]))
      .finally(() => setModsLoading(false));
  }, [selected]);

  const filtered = useMemo(() => {
    const items = bundle?.items ?? [];
    const needle = q.trim().toLowerCase();
    return items.filter(it => {
      if (catId !== "all" && it.categoryId !== catId) return false;
      if (!needle) return true;
      const hay = [it.name, it.description, it.sku, it.barcode, ...(it.aliases ?? []), ...(it.tags ?? [])]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [bundle, q, catId]);

  const openEditor = (path: string) => {
    if (!apiBaseUrl) return;
    try {
      void window.khanalagao.app.openExternal(new URL(path, apiBaseUrl).toString());
    } catch { /* ignore */ }
  };

  if (!bundle && !err) {
    return <div style={{ flex: 1, display: "grid", placeItems: "center" }}><Spinner size={26} /></div>;
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: colors.bg, color: colors.textPrimary, overflow: "hidden" }}>
      <div style={{
        padding: "16px 20px", borderBottom: `1px solid ${colors.border}`,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Menu</h1>
          <div style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>
            {bundle ? `${bundle.items.length} items · ${bundle.categories.length} categories` : ""}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ minWidth: 240, flex: "0 1 320px" }}>
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search items, SKUs, barcodes…"
          />
        </div>
        <button
          onClick={() => openEditor("/menu")}
          disabled={!apiBaseUrl}
          style={{
            background: colors.brand, color: "#fff", border: 0, borderRadius: 8,
            padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: apiBaseUrl ? "pointer" : "not-allowed",
            opacity: apiBaseUrl ? 1 : 0.5,
          }}
        >Edit in web admin ↗</button>
      </div>

      {err && <div style={{ padding: 16 }}><Banner kind="error">{err}</Banner></div>}

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "200px 1fr 320px", minHeight: 0 }}>
        {/* Categories */}
        <aside style={{ borderRight: `1px solid ${colors.border}`, overflow: "auto" }}>
          <CatRow active={catId === "all"} onClick={() => setCatId("all")}>
            All items ({bundle?.items.length ?? 0})
          </CatRow>
          {(bundle?.categories ?? []).map(c => {
            const count = (bundle?.items ?? []).filter(i => i.categoryId === c.id).length;
            return (
              <CatRow key={c.id} active={catId === c.id} onClick={() => setCatId(c.id)}>
                {c.name} <span style={{ color: colors.textMuted, fontWeight: 400 }}>({count})</span>
              </CatRow>
            );
          })}
        </aside>

        {/* Items grid */}
        <main style={{ overflow: "auto", padding: 16 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: colors.textMuted }}>
              No menu items match.
            </div>
          ) : (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 10,
            }}>
              {filtered.map(it => (
                <button
                  key={it.id}
                  onClick={() => setSelected(it)}
                  style={{
                    textAlign: "left",
                    background: selected?.id === it.id ? colors.panelAlt : colors.panel,
                    border: `1px solid ${selected?.id === it.id ? colors.brand : colors.border}`,
                    borderRadius: 10, padding: 12, cursor: "pointer",
                    color: colors.textPrimary,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    {it.isVeg != null && (
                      <span style={{
                        width: 12, height: 12, border: `1px solid ${it.isVeg ? colors.success : colors.danger}`,
                        display: "inline-grid", placeItems: "center", borderRadius: 2,
                      }}>
                        <span style={{
                          width: 6, height: 6, borderRadius: 999,
                          background: it.isVeg ? colors.success : colors.danger,
                        }} />
                      </span>
                    )}
                    {it.isBestseller && (
                      <span style={{
                        background: "rgba(234,179,8,0.16)", color: "#fde68a",
                        fontSize: 10, padding: "1px 6px", borderRadius: 999, fontWeight: 700,
                      }}>★ Best</span>
                    )}
                    {it.isAvailable === false && (
                      <span style={{
                        background: "rgba(220,38,38,0.16)", color: "#fca5a5",
                        fontSize: 10, padding: "1px 6px", borderRadius: 999, fontWeight: 700,
                      }}>86'd</span>
                    )}
                    {it.lowStock && (
                      <span style={{
                        background: "rgba(234,179,8,0.16)", color: "#fde68a",
                        fontSize: 10, padding: "1px 6px", borderRadius: 999, fontWeight: 700,
                      }}>Low</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{it.name}</div>
                  <div style={{ fontSize: 12, color: colors.textDim, fontVariantNumeric: "tabular-nums" }}>
                    {fmtINR(Number(it.price))}
                    {it.hasModifiers && <span style={{ marginLeft: 6, color: colors.textMuted }}>· mods</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </main>

        {/* Detail */}
        <aside style={{ borderLeft: `1px solid ${colors.border}`, overflow: "auto", padding: 16 }}>
          {!selected ? (
            <div style={{ color: colors.textMuted, fontSize: 13 }}>
              Select an item to see modifiers, SKU and tags.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
                Item · #{selected.id}
              </div>
              <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{selected.name}</h2>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
                {fmtINR(Number(selected.price))}
              </div>
              {selected.description && (
                <p style={{ margin: "0 0 12px", fontSize: 12, color: colors.textDim, lineHeight: 1.5 }}>
                  {selected.description}
                </p>
              )}
              <DetailRow label="Category">{
                (bundle?.categories ?? []).find(c => c.id === selected.categoryId)?.name ?? "—"
              }</DetailRow>
              <DetailRow label="SKU">{selected.sku ?? "—"}</DetailRow>
              <DetailRow label="Barcode">{selected.barcode ?? "—"}</DetailRow>
              <DetailRow label="Prep time">{selected.preparationTime ? `${selected.preparationTime} min` : "—"}</DetailRow>
              <DetailRow label="Tags">{(selected.tags ?? []).join(", ") || "—"}</DetailRow>

              <div style={{ marginTop: 16, fontSize: 12, color: colors.textDim, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
                Modifier groups
              </div>
              {modsLoading ? (
                <div style={{ padding: 12 }}><Spinner size={16} /></div>
              ) : (mods ?? []).length === 0 ? (
                <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>None</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  {(mods ?? []).map(g => (
                    <div key={g.id} style={{
                      background: colors.panel, border: `1px solid ${colors.border}`,
                      borderRadius: 8, padding: 10,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {g.name}{g.isRequired && <span style={{ color: colors.danger, marginLeft: 4 }}>*</span>}
                      </div>
                      <div style={{ fontSize: 11, color: colors.textMuted }}>
                        {g.minSelections ?? 0}–{g.maxSelections ?? "any"} · {g.modifiers?.length ?? 0} options
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => openEditor(`/menu?item=${selected.id}`)}
                disabled={!apiBaseUrl}
                style={{
                  marginTop: 16, width: "100%",
                  background: colors.panelAlt, color: colors.textPrimary,
                  border: `1px solid ${colors.border}`, borderRadius: 8,
                  padding: "8px 12px", fontSize: 12, fontWeight: 600,
                  cursor: apiBaseUrl ? "pointer" : "not-allowed",
                  opacity: apiBaseUrl ? 1 : 0.5,
                }}
              >Edit this item ↗</button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function CatRow({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        background: active ? colors.panelAlt : "transparent",
        borderLeft: `3px solid ${active ? colors.brand : "transparent"}`,
        border: 0, color: active ? colors.textPrimary : colors.textDim,
        padding: "10px 14px", fontSize: 13, cursor: "pointer", fontWeight: active ? 600 : 500,
      }}
    >{children}</button>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${colors.border}`, fontSize: 12 }}>
      <span style={{ color: colors.textDim }}>{label}</span>
      <span style={{ color: colors.textPrimary, fontWeight: 500, textAlign: "right" }}>{children}</span>
    </div>
  );
}
