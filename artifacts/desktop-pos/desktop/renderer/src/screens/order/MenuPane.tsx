import { useMemo, useState } from "react";
import type { MenuCategory, MenuItem } from "../../../../shared/ipc-contract";
import { Input, Spinner, colors } from "../../ui/components";
import { fmtINR } from "./types";

interface Props {
  loading: boolean;
  categories: MenuCategory[];
  items: MenuItem[];
  selectedCategoryId: number | null;
  onSelectCategory: (id: number | null) => void;
  search: string;
  onSearch: (q: string) => void;
  vegFilter: "all" | "veg" | "non_veg";
  onVegFilter: (v: "all" | "veg" | "non_veg") => void;
  onPickItem: (item: MenuItem) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Persisted default from useAppPrefs. */
  layout?: "image" | "compact" | "fast";
  onLayoutChange?: (l: "image" | "compact" | "fast") => void;
  /** Show item images on the tiles (image layout only). */
  showImages?: boolean;
  /** menuItemId → in-cart quantity, used for the corner qty badge. */
  cartQtyByItemId?: Record<number, number>;
}

export function MenuPane(props: Props) {
  const {
    loading, categories, items, selectedCategoryId, onSelectCategory,
    search, onSearch, vegFilter, onVegFilter, onPickItem, searchInputRef,
    layout: layoutProp, onLayoutChange, showImages = true, cartQtyByItemId,
  } = props;

  const [localLayout, setLocalLayout] = useState<"image" | "compact" | "fast">("image");
  const layout = layoutProp ?? localLayout;
  function setLayout(l: "image" | "compact" | "fast") {
    if (onLayoutChange) onLayoutChange(l); else setLocalLayout(l);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(it => {
      if (selectedCategoryId != null && it.categoryId !== selectedCategoryId) return false;
      if (vegFilter === "veg" && !it.isVeg) return false;
      if (vegFilter === "non_veg" && it.isVeg) return false;
      if (q) {
        const hay = [
          it.name, it.description ?? "", it.sku ?? "", it.barcode ?? "",
          ...(it.aliases ?? []), ...(it.tags ?? []),
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, selectedCategoryId, vegFilter]);

  const gridCols = layout === "fast"
    ? "repeat(auto-fill, minmax(120px, 1fr))"
    : layout === "compact"
    ? "repeat(auto-fill, minmax(140px, 1fr))"
    : "repeat(auto-fill, minmax(170px, 1fr))";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "180px 1fr",
      height: "100%", minHeight: 0,
    }}>
      {/* Category rail */}
      <aside style={{
        borderRight: `1px solid ${colors.border}`,
        overflowY: "auto", padding: 8,
        background: colors.panel,
      }}>
        <CategoryChip
          label="All"
          count={items.length}
          selected={selectedCategoryId == null}
          onClick={() => onSelectCategory(null)}
        />
        {categories.map(c => (
          <CategoryChip
            key={c.id}
            label={c.name}
            count={items.filter(i => i.categoryId === c.id).length}
            selected={selectedCategoryId === c.id}
            onClick={() => onSelectCategory(c.id)}
          />
        ))}
      </aside>

      {/* Grid + search/filter */}
      <section style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{
          padding: 12, display: "flex", gap: 10, alignItems: "center",
          flexWrap: "wrap",
          borderBottom: `1px solid ${colors.border}`, background: colors.panel,
        }}>
          {/* Search must own its own row at narrow widths so the filter
              chips don't squeeze the input down to a sliver. min-width:0
              + a generous min-width:240 lets it grow when there's room
              and wrap below the chips when there isn't. */}
          <div style={{ flex: "1 1 240px", minWidth: 0, position: "relative" }}>
            <Input
              inputRef={searchInputRef}
              placeholder="Search menu, SKU or barcode… (press /)"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
            <span aria-hidden style={{
              position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              color: colors.textMuted, fontSize: 14, pointerEvents: "none",
            }}>⌕</span>
            {search && (
              <button
                onClick={() => onSearch("")}
                title="Clear search"
                style={{
                  position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                  background: "transparent", border: 0, color: colors.textDim,
                  cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "4px 8px",
                }}
              >×</button>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
            <FilterChip active={vegFilter === "all"} onClick={() => onVegFilter("all")}>All diet</FilterChip>
            <FilterChip active={vegFilter === "veg"} onClick={() => onVegFilter("veg")} color="#16a34a">🟢 Veg</FilterChip>
            <FilterChip active={vegFilter === "non_veg"} onClick={() => onVegFilter("non_veg")} color="#dc2626">🔴 Non-veg</FilterChip>
            <div style={{ width: 1, height: 22, background: colors.border, alignSelf: "center", margin: "0 2px" }} />
            <FilterChip active={layout === "image"} onClick={() => setLayout("image")}>🖼 Cards</FilterChip>
            <FilterChip active={layout === "compact"} onClick={() => setLayout("compact")}>≡ Compact</FilterChip>
            <FilterChip active={layout === "fast"} onClick={() => setLayout("fast")}>⚡ Fast bill</FilterChip>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {loading && (
            <div style={{ display: "grid", placeItems: "center", padding: 40 }}><Spinner /></div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ color: colors.textDim, textAlign: "center", padding: 40, fontSize: 14 }}>
              {search ? `No items match "${search}".` : "No items in this category."}
            </div>
          )}
          <div style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            gap: layout === "compact" ? 8 : 12,
          }}>
            {filtered.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                onClick={() => onPickItem(it)}
                layout={layout}
                showImage={showImages}
                cartQty={cartQtyByItemId?.[it.id] ?? 0}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CategoryChip({ label, count, selected, onClick }: {
  label: string; count: number; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        width: "100%", textAlign: "left", gap: 8,
        background: selected ? colors.brandSoft : "transparent",
        color: selected ? "#fff" : colors.textPrimary,
        border: 0, padding: "10px 12px", borderRadius: 6,
        marginBottom: 2, cursor: "pointer", fontSize: 13, fontWeight: 500,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{label}</span>
      <span style={{
        fontSize: 11, color: selected ? "#fed7aa" : colors.textMuted,
        background: selected ? "rgba(0,0,0,0.25)" : colors.bg,
        padding: "2px 6px", borderRadius: 999,
      }}>{count}</span>
    </button>
  );
}

function FilterChip({ active, onClick, children, color }: {
  active: boolean; onClick: () => void; children: React.ReactNode; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? (color ?? colors.brandSoft) : colors.panelAlt,
        color: active ? "#fff" : colors.textPrimary,
        border: 0, borderRadius: 6, padding: "8px 10px",
        fontSize: 12, fontWeight: 600, cursor: "pointer",
      }}
    >{children}</button>
  );
}

function ItemCard({ item, onClick, layout, showImage, cartQty }: {
  item: MenuItem; onClick: () => void;
  layout: "image" | "compact" | "fast"; showImage: boolean; cartQty: number;
}) {
  const disabled = item.isAvailable === false;
  const compact = layout === "compact" || layout === "fast";
  const img = layout === "image" && showImage ? item.imageUrl : null;

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "Item is 86'd" : item.name}
      style={{
        position: "relative",
        textAlign: "left", border: `1px solid ${colors.border}`,
        background: disabled ? colors.bg : colors.panel,
        color: disabled ? colors.textMuted : colors.textPrimary,
        borderRadius: 10, padding: compact ? 8 : 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        display: "flex", flexDirection: "column", gap: 6,
        minHeight: compact ? 64 : 96,
        overflow: "hidden",
      }}
    >
      {cartQty > 0 && (
        <span style={{
          position: "absolute", top: 6, left: 6, zIndex: 1,
          background: colors.brand, color: "#fff",
          padding: "2px 7px", borderRadius: 999,
          fontSize: 11, fontWeight: 800, lineHeight: 1.2,
          boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
        }}>×{cartQty}</span>
      )}

      {item.isBestseller && (
        <span title="Best-seller" style={{
          position: "absolute", top: 6, right: 6, zIndex: 1,
          background: "#facc15", color: "#1a1300",
          padding: "2px 6px", borderRadius: 999,
          fontSize: 10, fontWeight: 800, lineHeight: 1.2,
          boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
        }}>★ Top</span>
      )}

      {item.lowStock && (
        <span title="Low stock — restock soon" style={{
          position: "absolute", bottom: 6, right: 6, zIndex: 1,
          background: "rgba(220,38,38,0.92)", color: "#fff",
          padding: "2px 6px", borderRadius: 4,
          fontSize: 10, fontWeight: 700, lineHeight: 1.2,
        }}>Low</span>
      )}

      {/* Image area in Cards layout: a real photo when we have one,
          otherwise a tasteful initial-letter placeholder so the card
          doesn't look like a broken/loading state. Compact + Fast
          layouts skip the image area entirely. */}
      {layout === "image" && (
        img ? (
          <div style={{
            width: "100%", aspectRatio: "4 / 3", marginBottom: 4,
            borderRadius: 6, overflow: "hidden",
            background: colors.panelAlt,
            backgroundImage: `url("${img}")`,
            backgroundSize: "cover", backgroundPosition: "center",
          }} />
        ) : (
          <div style={{
            width: "100%", aspectRatio: "4 / 3", marginBottom: 4,
            borderRadius: 6, overflow: "hidden",
            background: `linear-gradient(135deg, ${colors.panelAlt}, ${colors.bg})`,
            display: "grid", placeItems: "center",
            color: colors.textMuted, fontSize: 38, fontWeight: 800,
            letterSpacing: -1, textTransform: "uppercase",
          }}>
            {(item.name?.trim()?.[0] ?? "·")}
          </div>
        )
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
        <div style={{
          fontSize: compact ? 12 : 14, fontWeight: 600,
          lineHeight: 1.2, overflow: "hidden",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>{item.name}</div>
        <div style={{
          width: 12, height: 12, border: `1.5px solid ${item.isVeg ? "#16a34a" : "#dc2626"}`,
          borderRadius: 2, display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: item.isVeg ? "#16a34a" : "#dc2626",
          }} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", gap: 6 }}>
        <span style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color: colors.brand }}>
          {fmtINR(Number(item.price))}
        </span>
        {item.hasModifiers && (
          <span style={{
            fontSize: 10, color: item.hasRequiredModifiers ? "#fca5a5" : colors.textDim,
            background: item.hasRequiredModifiers ? "rgba(220,38,38,0.15)" : colors.bg,
            padding: "2px 6px", borderRadius: 999,
          }}>
            {item.hasRequiredModifiers ? "Customize *" : "Customize"}
          </span>
        )}
        {disabled && (
          <span style={{ fontSize: 10, color: colors.danger, fontWeight: 700 }}>86'd</span>
        )}
      </div>
    </button>
  );
}
