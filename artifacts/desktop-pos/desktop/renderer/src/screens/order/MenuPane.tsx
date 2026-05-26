import { useMemo } from "react";
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
}

export function MenuPane(props: Props) {
  const {
    loading, categories, items, selectedCategoryId, onSelectCategory,
    search, onSearch, vegFilter, onVegFilter, onPickItem, searchInputRef,
  } = props;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(it => {
      if (selectedCategoryId != null && it.categoryId !== selectedCategoryId) return false;
      if (vegFilter === "veg" && !it.isVeg) return false;
      if (vegFilter === "non_veg" && it.isVeg) return false;
      if (q && !it.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, selectedCategoryId, vegFilter]);

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
          borderBottom: `1px solid ${colors.border}`, background: colors.panel,
        }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Input
              inputRef={searchInputRef}
              placeholder="Search menu… (press / to focus)"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          <FilterChip active={vegFilter === "all"} onClick={() => onVegFilter("all")}>All</FilterChip>
          <FilterChip active={vegFilter === "veg"} onClick={() => onVegFilter("veg")} color="#16a34a">🟢 Veg</FilterChip>
          <FilterChip active={vegFilter === "non_veg"} onClick={() => onVegFilter("non_veg")} color="#dc2626">🔴 Non-veg</FilterChip>
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
            gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
            gap: 12,
          }}>
            {filtered.map((it) => (
              <ItemCard key={it.id} item={it} onClick={() => onPickItem(it)} />
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
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        width: "100%", textAlign: "left",
        background: selected ? colors.brandSoft : "transparent",
        color: selected ? "#fff" : colors.textPrimary,
        border: 0, padding: "10px 12px", borderRadius: 6,
        marginBottom: 2, cursor: "pointer", fontSize: 13, fontWeight: 500,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
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

function ItemCard({ item, onClick }: { item: MenuItem; onClick: () => void }) {
  const disabled = item.isAvailable === false;
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "Item is 86'd" : item.name}
      style={{
        textAlign: "left", border: `1px solid ${colors.border}`,
        background: disabled ? colors.bg : colors.panel,
        color: disabled ? colors.textMuted : colors.textPrimary,
        borderRadius: 10, padding: 12, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1, display: "flex", flexDirection: "column", gap: 6,
        minHeight: 96,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{item.name}</div>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.brand }}>
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
