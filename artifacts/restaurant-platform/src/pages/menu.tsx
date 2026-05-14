import { useState, useRef } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useMenus, useMenuCategories, useMenuItems,
  useCreateMenu, useUpdateMenu, useDeleteMenu,
  useCreateCategory, useUpdateCategory, useDeleteCategory,
  useCreateMenuItem, useUpdateMenuItem, useDeleteMenuItem,
  useModifierGroups, useModifiers, useCreateModifierGroup, useCreateModifier,
  useKitchens, useBulkAssignKitchen,
} from "@/lib/hooks";
import type { Kitchen } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, Search, Pencil, Trash2, ChevronRight, Download, Upload,
  UtensilsCrossed, Settings2, X, Check, Tag, Clock, Flame, Leaf,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Menu, MenuCategory, MenuItem, ModifierGroup, Modifier } from "@/lib/types";

const RESTAURANT_ID = 1;

function VegBadge({ isVeg }: { isVeg: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center justify-center w-4 h-4 rounded border text-[9px] font-bold flex-shrink-0",
      isVeg ? "border-green-500 text-green-600" : "border-red-500 text-red-600"
    )}>●</span>
  );
}

const DAY_LABELS: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

function ModifierGroupPanel({ itemId }: { itemId: number }) {
  const { data: groups = [] } = useModifierGroups(itemId);
  const createGroup = useCreateModifierGroup(itemId);
  const [showAdd, setShowAdd] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", isRequired: false, minSelections: 0, maxSelections: 1 });
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);
  const { toast } = useToast();

  const handleAddGroup = async () => {
    if (!groupForm.name) return;
    try {
      await createGroup.mutateAsync(groupForm);
      setGroupForm({ name: "", isRequired: false, minSelections: 0, maxSelections: 1 });
      setShowAdd(false);
      toast({ title: "Modifier group added" });
    } catch {
      toast({ title: "Failed to add group", variant: "destructive" });
    }
  };

  return (
    <div className="mt-4 border border-dashed border-border rounded-lg p-3 bg-muted/20">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Modifier Groups</p>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="w-3 h-3 mr-1" /> Add Group
        </Button>
      </div>

      {showAdd && (
        <div className="mb-3 p-2 bg-card border border-border rounded-md space-y-2">
          <Input placeholder="Group name (e.g. Size, Extras)" value={groupForm.name} onChange={e => setGroupForm(p => ({ ...p, name: e.target.value }))} className="h-7 text-xs" />
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={groupForm.isRequired} onChange={e => setGroupForm(p => ({ ...p, isRequired: e.target.checked }))} />
              Required
            </label>
            <span>Min:</span>
            <Input type="number" value={groupForm.minSelections} onChange={e => setGroupForm(p => ({ ...p, minSelections: Number(e.target.value) }))} className="h-6 w-12 text-xs" />
            <span>Max:</span>
            <Input type="number" value={groupForm.maxSelections} onChange={e => setGroupForm(p => ({ ...p, maxSelections: Number(e.target.value) }))} className="h-6 w-12 text-xs" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-6 text-xs flex-1" onClick={handleAddGroup} disabled={createGroup.isPending}>Save</Button>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {groups.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground text-center py-2">No modifier groups yet</p>
      )}

      {groups.map((g: ModifierGroup) => (
        <ModifierGroupRow key={g.id} group={g} isExpanded={expandedGroup === g.id} onToggle={() => setExpandedGroup(expandedGroup === g.id ? null : g.id)} />
      ))}
    </div>
  );
}

function ModifierGroupRow({ group, isExpanded, onToggle }: { group: ModifierGroup; isExpanded: boolean; onToggle: () => void }) {
  const { data: modifiers = [] } = useModifiers(isExpanded ? group.id : undefined);
  const createModifier = useCreateModifier(group.id);
  const [showAdd, setShowAdd] = useState(false);
  const [modForm, setModForm] = useState({ name: "", price: "0", isDefault: false });
  const { toast } = useToast();

  const handleAddModifier = async () => {
    if (!modForm.name) return;
    try {
      await createModifier.mutateAsync(modForm);
      setModForm({ name: "", price: "0", isDefault: false });
      setShowAdd(false);
    } catch {
      toast({ title: "Failed to add modifier", variant: "destructive" });
    }
  };

  return (
    <div className="mb-1 border border-border rounded-md overflow-hidden">
      <button className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors text-left" onClick={onToggle}>
        <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
        <span className="text-xs font-medium flex-1">{group.name}</span>
        {group.isRequired && <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Required</span>}
        <span className="text-[10px] text-muted-foreground">{group.minSelections}–{group.maxSelections}</span>
      </button>

      {isExpanded && (
        <div className="p-2 space-y-1">
          {modifiers.map((m: Modifier) => (
            <div key={m.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-muted/20">
              <span>{m.name}</span>
              <div className="flex items-center gap-2">
                {m.isDefault && <span className="text-[9px] text-muted-foreground">default</span>}
                <span className="font-medium">₹{m.price}</span>
              </div>
            </div>
          ))}

          {showAdd ? (
            <div className="flex gap-1 mt-1">
              <Input placeholder="Option name" value={modForm.name} onChange={e => setModForm(p => ({ ...p, name: e.target.value }))} className="h-6 text-xs flex-1" />
              <Input placeholder="₹0" value={modForm.price} onChange={e => setModForm(p => ({ ...p, price: e.target.value }))} className="h-6 text-xs w-14" />
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleAddModifier}><Check className="w-3 h-3" /></Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowAdd(false)}><X className="w-3 h-3" /></Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="h-5 text-[10px] w-full" onClick={() => setShowAdd(true)}>
              <Plus className="w-2.5 h-2.5 mr-1" /> Add option
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

type ItemForm = {
  name: string;
  price: string;
  description: string;
  categoryId: string;
  isVeg: boolean;
  preparationTime: string;
  imageUrl: string;
  calories: string;
  tags: string;
  kitchenId: string;
};

const EMPTY_ITEM_FORM: ItemForm = {
  name: "", price: "", description: "", categoryId: "", isVeg: true,
  preparationTime: "15", imageUrl: "", calories: "", tags: "", kitchenId: "",
};

export default function MenuPage() {
  const { toast } = useToast();
  const { data: menus = [] } = useMenus();
  const [selectedMenuId, setSelectedMenuId] = useState<number | undefined>();
  const [selectedCatId, setSelectedCatId] = useState<number | undefined>();
  const [search, setSearch] = useState("");

  const activeMenuId = selectedMenuId ?? menus[0]?.id;
  const { data: categories = [] } = useMenuCategories(activeMenuId);
  const { data: items = [] } = useMenuItems({ categoryId: selectedCatId, search: search || undefined });

  const createMenu = useCreateMenu();
  const updateMenu = useUpdateMenu();
  const deleteMenu = useDeleteMenu();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const createItem = useCreateMenuItem();
  const updateItem = useUpdateMenuItem();
  const deleteItem = useDeleteMenuItem();
  const { data: kitchens = [] } = useKitchens();
  const bulkAssignKitchen = useBulkAssignKitchen();
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set());
  const [bulkKitchenId, setBulkKitchenId] = useState<string>("");

  const [showMenuModal, setShowMenuModal] = useState(false);
  const [editMenu, setEditMenu] = useState<Menu | null>(null);
  const [menuForm, setMenuForm] = useState({ name: "", description: "", availableFrom: "", availableTo: "" });

  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState<MenuCategory | null>(null);
  const [catForm, setCatForm] = useState({ name: "", description: "" });

  const [showItemModal, setShowItemModal] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(EMPTY_ITEM_FORM);
  const [activeTab, setActiveTab] = useState<"details" | "modifiers">("details");

  const csvInputRef = useRef<HTMLInputElement>(null);

  const filteredItems = items.filter((item: MenuItem) => {
    if (activeMenuId) {
      const catIds = categories.map((c: MenuCategory) => c.id);
      return catIds.includes(item.categoryId);
    }
    return true;
  });

  const openEditItem = (item: MenuItem) => {
    setEditItem(item);
    setItemForm({
      name: item.name,
      price: item.price,
      description: item.description ?? "",
      categoryId: String(item.categoryId),
      isVeg: item.isVeg,
      preparationTime: String(item.preparationTime),
      imageUrl: item.imageUrl ?? "",
      calories: item.calories ? String(item.calories) : "",
      tags: Array.isArray(item.tags) ? item.tags.join(", ") : "",
      kitchenId: item.kitchenId != null ? String(item.kitchenId) : "",
    });
    setActiveTab("details");
    setShowItemModal(true);
  };

  const handleSaveItem = async () => {
    if (!itemForm.name || !itemForm.price || !itemForm.categoryId) {
      toast({ title: "Name, price and category are required", variant: "destructive" });
      return;
    }
    const payload = {
      name: itemForm.name,
      price: itemForm.price,
      description: itemForm.description,
      categoryId: Number(itemForm.categoryId),
      isVeg: itemForm.isVeg,
      preparationTime: Number(itemForm.preparationTime),
      imageUrl: itemForm.imageUrl || undefined,
      calories: itemForm.calories ? Number(itemForm.calories) : undefined,
      tags: itemForm.tags ? itemForm.tags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
      kitchenId: itemForm.kitchenId ? Number(itemForm.kitchenId) : null,
    };
    try {
      if (editItem) {
        await updateItem.mutateAsync({ id: editItem.id, ...payload });
        toast({ title: "Item updated" });
      } else {
        await createItem.mutateAsync(payload);
        toast({ title: "Item created" });
      }
      setShowItemModal(false);
      setEditItem(null);
      setItemForm(EMPTY_ITEM_FORM);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "Failed to save item";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const handleDeleteItem = async (id: number) => {
    if (!confirm("Delete this item?")) return;
    try {
      await deleteItem.mutateAsync(id);
      toast({ title: "Item deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handleToggleAvailable = async (item: MenuItem) => {
    try {
      await updateItem.mutateAsync({ id: item.id, isAvailable: !item.isAvailable });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const handleSaveMenu = async () => {
    if (!menuForm.name) return;
    try {
      if (editMenu) {
        await updateMenu.mutateAsync({ id: editMenu.id, ...menuForm });
        toast({ title: "Menu updated" });
      } else {
        const m = await createMenu.mutateAsync(menuForm);
        setSelectedMenuId(m.id);
        toast({ title: "Menu created" });
      }
      setShowMenuModal(false);
      setEditMenu(null);
      setMenuForm({ name: "", description: "", availableFrom: "", availableTo: "" });
    } catch {
      toast({ title: "Failed to save menu", variant: "destructive" });
    }
  };

  const handleDeleteMenu = async (id: number) => {
    if (!confirm("Delete this menu? All categories and items inside will be affected.")) return;
    try {
      await deleteMenu.mutateAsync(id);
      if (activeMenuId === id) setSelectedMenuId(undefined);
      toast({ title: "Menu deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handleSaveCat = async () => {
    if (!catForm.name || !activeMenuId) return;
    try {
      if (editCat) {
        await updateCategory.mutateAsync({ id: editCat.id, ...catForm });
        toast({ title: "Category updated" });
      } else {
        await createCategory.mutateAsync({ menuId: activeMenuId, ...catForm });
        toast({ title: "Category created" });
      }
      setShowCatModal(false);
      setEditCat(null);
      setCatForm({ name: "", description: "" });
    } catch {
      toast({ title: "Failed to save category", variant: "destructive" });
    }
  };

  const handleDeleteCat = async (id: number) => {
    if (!confirm("Delete this category? Items inside will lose their category.")) return;
    try {
      await deleteCategory.mutateAsync(id);
      if (selectedCatId === id) setSelectedCatId(undefined);
      toast({ title: "Category deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handleExportCSV = async () => {
    try {
      const { getApiUrl } = await import("@/lib/api");
      const token = localStorage.getItem("tt_access_token");
      const res = await fetch(getApiUrl(`/restaurants/${RESTAURANT_ID}/items/export.csv`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "menu-items.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exported all menu items" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").slice(1).filter(l => l.trim());
      const parsedItems = lines.flatMap(line => {
        const cols = line.match(/("(?:[^"]|"")*"|[^,]*)/g)?.map(v => v.replace(/^"|"$/g, "").replace(/""/g, '"')) ?? [];
        const [name, price, categoryName, vegStr, , prep, calories, tags] = cols;
        if (!name?.trim() || !price?.trim()) return [];
        return [{
          name: name.trim(),
          price: price.trim(),
          categoryName: categoryName?.trim() || undefined,
          isVeg: vegStr?.toLowerCase() === "yes",
          preparationTime: Number(prep) || 15,
          calories: calories ? Number(calories) : undefined,
          tags: tags ? tags.split(";").map((t: string) => t.trim()).filter(Boolean) : undefined,
        }];
      });

      if (parsedItems.length === 0) {
        toast({ title: "No valid rows found in CSV", variant: "destructive" });
        return;
      }

      try {
        const { apiPost } = await import("@/lib/api");
        const result = await apiPost<{ imported: number; skipped: number; errors: string[] }>(
          `/restaurants/${RESTAURANT_ID}/items/import`,
          { items: parsedItems }
        );
        const msg = result.errors.length > 0
          ? `Imported ${result.imported}, skipped ${result.skipped + result.errors.length}`
          : `Imported ${result.imported} items`;
        toast({ title: msg });
        if (result.errors.length > 0) console.warn("Import errors:", result.errors);
      } catch {
        toast({ title: "Import failed", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const activeMenu = menus.find((m: Menu) => m.id === activeMenuId);

  return (
    <Layout>
      <PageHeader
        title="Menu Management"
        subtitle={`${filteredItems.length} items`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExportCSV}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => csvInputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Import CSV
            </Button>
            <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportCSV} />
            <Button size="sm" onClick={() => { setEditItem(null); setItemForm(EMPTY_ITEM_FORM); setActiveTab("details"); setShowItemModal(true); }}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Item
            </Button>
          </div>
        }
      />

      <div className="flex h-[calc(100vh-140px)]">
        <aside className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-muted/10">
          <div className="p-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Menus</p>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setEditMenu(null); setMenuForm({ name: "", description: "", availableFrom: "", availableTo: "" }); setShowMenuModal(true); }}>
                <Plus className="w-3 h-3" />
              </Button>
            </div>
            <div className="space-y-0.5">
              {menus.map((m: Menu) => (
                <div key={m.id} className={cn("flex items-center rounded-md px-2 py-1.5 cursor-pointer group transition-colors", activeMenuId === m.id ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground")} onClick={() => { setSelectedMenuId(m.id); setSelectedCatId(undefined); }}>
                  <UtensilsCrossed className="w-3.5 h-3.5 mr-2 flex-shrink-0" />
                  <span className="text-xs font-medium flex-1 truncate">{m.name}</span>
                  {!m.isActive && <span className="text-[9px] text-muted-foreground mr-1">off</span>}
                  <div className="hidden group-hover:flex items-center gap-0.5">
                    <button className="p-0.5 hover:text-primary" onClick={e => { e.stopPropagation(); setEditMenu(m); setMenuForm({ name: m.name, description: m.description ?? "", availableFrom: m.availableFrom ?? "", availableTo: m.availableTo ?? "" }); setShowMenuModal(true); }}><Pencil className="w-2.5 h-2.5" /></button>
                    <button className="p-0.5 hover:text-destructive" onClick={e => { e.stopPropagation(); handleDeleteMenu(m.id); }}><Trash2 className="w-2.5 h-2.5" /></button>
                  </div>
                </div>
              ))}
              {menus.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">No menus yet</p>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Categories</p>
              {activeMenuId && (
                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setEditCat(null); setCatForm({ name: "", description: "" }); setShowCatModal(true); }}>
                  <Plus className="w-3 h-3" />
                </Button>
              )}
            </div>

            <button className={cn("w-full text-left flex items-center px-2 py-1.5 rounded-md text-xs transition-colors mb-0.5", !selectedCatId ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground")} onClick={() => setSelectedCatId(undefined)}>
              All Items
            </button>

            {categories.map((cat: MenuCategory) => (
              <div key={cat.id} className={cn("group flex items-center px-2 py-1.5 rounded-md cursor-pointer text-xs transition-colors mb-0.5", selectedCatId === cat.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground")} onClick={() => setSelectedCatId(cat.id)}>
                <span className="flex-1 truncate">{cat.name}</span>
                <div className="hidden group-hover:flex items-center gap-0.5">
                  <button className="p-0.5 hover:text-primary" onClick={e => { e.stopPropagation(); setEditCat(cat); setCatForm({ name: cat.name, description: cat.description ?? "" }); setShowCatModal(true); }}><Pencil className="w-2.5 h-2.5" /></button>
                  <button className="p-0.5 hover:text-destructive" onClick={e => { e.stopPropagation(); handleDeleteCat(cat.id); }}><Trash2 className="w-2.5 h-2.5" /></button>
                </div>
              </div>
            ))}
            {categories.length === 0 && activeMenuId && <p className="text-xs text-muted-foreground text-center py-3">No categories yet</p>}
            {!activeMenuId && <p className="text-xs text-muted-foreground text-center py-3">Select a menu first</p>}
          </div>

          {activeMenu && (activeMenu.availableFrom || activeMenu.availableTo) && (
            <div className="p-3 border-t border-border">
              <p className="text-[10px] text-muted-foreground font-medium mb-1">Availability</p>
              <p className="text-xs text-foreground">{activeMenu.availableFrom ?? "Open"} – {activeMenu.availableTo ?? "Close"}</p>
            </div>
          )}
        </aside>

        <main className="flex-1 overflow-y-auto p-5">
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
            </div>
          </div>

          {selectedItemIds.size > 0 && (
            <div className="mb-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2 flex items-center gap-3">
              <span className="text-sm font-medium">{selectedItemIds.size} selected</span>
              <select
                className="border border-input rounded-md px-2 py-1 text-xs bg-background"
                value={bulkKitchenId}
                onChange={e => setBulkKitchenId(e.target.value)}
              >
                <option value="">Choose kitchen…</option>
                {kitchens.filter((k: Kitchen) => k.isActive).map((k: Kitchen) => (
                  <option key={k.id} value={k.id}>{k.name}{k.isDefault ? " (default)" : ""}</option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!bulkKitchenId || bulkAssignKitchen.isPending}
                onClick={async () => {
                  try {
                    await bulkAssignKitchen.mutateAsync({ itemIds: Array.from(selectedItemIds), kitchenId: Number(bulkKitchenId) });
                    toast({ title: `Assigned ${selectedItemIds.size} items to kitchen` });
                    setSelectedItemIds(new Set());
                    setBulkKitchenId("");
                  } catch {
                    toast({ title: "Bulk assign failed", variant: "destructive" });
                  }
                }}
              >
                Apply
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelectedItemIds(new Set())}>Clear</Button>
            </div>
          )}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={filteredItems.length > 0 && filteredItems.every((i: MenuItem) => selectedItemIds.has(i.id))}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedItemIds(new Set(filteredItems.map((i: MenuItem) => i.id)));
                        else setSelectedItemIds(new Set());
                      }}
                    />
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Item</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Category</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Price</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Prep</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Details</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item: MenuItem) => (
                  <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedItemIds.has(item.id)}
                        onChange={(e) => {
                          setSelectedItemIds(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(item.id); else next.delete(item.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name} className="w-8 h-8 rounded-md object-cover flex-shrink-0 bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ) : (
                          <div className="w-8 h-8 rounded-md bg-muted/60 flex items-center justify-center flex-shrink-0">
                            <UtensilsCrossed className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <VegBadge isVeg={item.isVeg} />
                            <p className="text-sm font-medium text-foreground">{item.name}</p>
                          </div>
                          {item.description && <p className="text-xs text-muted-foreground truncate max-w-40">{item.description}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">{categories.find((c: MenuCategory) => c.id === item.categoryId)?.name ?? "–"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-semibold">₹{item.price}</span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />{item.preparationTime}m
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {item.calories && (
                          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded flex items-center gap-0.5">
                            <Flame className="w-2.5 h-2.5" />{item.calories} kcal
                          </span>
                        )}
                        {Array.isArray(item.tags) && item.tags.map((tag: string) => (
                          <span key={tag} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded flex items-center gap-0.5">
                            <Tag className="w-2.5 h-2.5" />{tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleAvailable(item)}
                        className={cn(
                          "text-xs font-medium px-2 py-1 rounded-full transition-colors",
                          item.isAvailable ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-red-100 text-red-600 hover:bg-red-200"
                        )}
                      >
                        {item.isAvailable ? "Available" : "Unavailable"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditItem(item)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDeleteItem(item.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-16 text-muted-foreground">
                      <UtensilsCrossed className="w-10 h-10 mx-auto mb-3 opacity-20" />
                      <p className="text-sm">No items found</p>
                      <p className="text-xs mt-1">Add items using the button above or import a CSV</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>

      {showMenuModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">{editMenu ? "Edit Menu" : "Create Menu"}</h2>
            <div className="space-y-3">
              <div><Label>Menu Name</Label><Input placeholder="e.g. Breakfast Menu" value={menuForm.name} onChange={e => setMenuForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Description</Label><Input placeholder="Optional description" value={menuForm.description} onChange={e => setMenuForm(p => ({ ...p, description: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Available From</Label>
                  <Input type="time" value={menuForm.availableFrom} onChange={e => setMenuForm(p => ({ ...p, availableFrom: e.target.value }))} />
                </div>
                <div>
                  <Label>Available To</Label>
                  <Input type="time" value={menuForm.availableTo} onChange={e => setMenuForm(p => ({ ...p, availableTo: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => { setShowMenuModal(false); setEditMenu(null); }}>Cancel</Button>
                <Button className="flex-1" onClick={handleSaveMenu} disabled={createMenu.isPending || updateMenu.isPending}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCatModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-semibold mb-4">{editCat ? "Edit Category" : "Add Category"}</h2>
            <div className="space-y-3">
              <div><Label>Category Name</Label><Input placeholder="e.g. Starters" value={catForm.name} onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Description</Label><Input placeholder="Optional" value={catForm.description} onChange={e => setCatForm(p => ({ ...p, description: e.target.value }))} /></div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => { setShowCatModal(false); setEditCat(null); }}>Cancel</Button>
                <Button className="flex-1" onClick={handleSaveCat} disabled={createCategory.isPending || updateCategory.isPending}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showItemModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
              <h2 className="text-lg font-semibold">{editItem ? "Edit Item" : "Add Menu Item"}</h2>
              <button onClick={() => { setShowItemModal(false); setEditItem(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex border-b border-border">
              <button className={cn("flex-1 text-sm py-2.5 font-medium border-b-2 transition-colors", activeTab === "details" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")} onClick={() => setActiveTab("details")}>
                <Settings2 className="w-3.5 h-3.5 inline mr-1.5" />Details
              </button>
              <button
                className={cn("flex-1 text-sm py-2.5 font-medium border-b-2 transition-colors", activeTab === "modifiers" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground", !editItem && "opacity-40 cursor-not-allowed")}
                onClick={() => editItem && setActiveTab("modifiers")}
              >
                <Tag className="w-3.5 h-3.5 inline mr-1.5" />Modifiers
                {!editItem && <span className="text-[9px] ml-1">(save first)</span>}
              </button>
            </div>

            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {activeTab === "details" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <Label>Item Name <span className="text-destructive">*</span></Label>
                      <Input placeholder="e.g. Butter Chicken" value={itemForm.name} onChange={e => setItemForm(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Price (₹) <span className="text-destructive">*</span></Label>
                      <Input placeholder="0.00" value={itemForm.price} onChange={e => setItemForm(p => ({ ...p, price: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Prep Time (min)</Label>
                      <Input type="number" value={itemForm.preparationTime} onChange={e => setItemForm(p => ({ ...p, preparationTime: e.target.value }))} />
                    </div>
                    <div className="col-span-2">
                      <Label>Description</Label>
                      <Input placeholder="Brief description" value={itemForm.description} onChange={e => setItemForm(p => ({ ...p, description: e.target.value }))} />
                    </div>
                    <div className="col-span-2">
                      <Label>Category <span className="text-destructive">*</span></Label>
                      <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={itemForm.categoryId} onChange={e => setItemForm(p => ({ ...p, categoryId: e.target.value }))}>
                        <option value="">Select category</option>
                        {categories.map((c: MenuCategory) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <Label>Image URL</Label>
                      <Input placeholder="https://example.com/image.jpg" value={itemForm.imageUrl} onChange={e => setItemForm(p => ({ ...p, imageUrl: e.target.value }))} />
                      {itemForm.imageUrl && (
                        <img src={itemForm.imageUrl} alt="preview" className="mt-2 h-20 w-full object-cover rounded-md border border-border" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      )}
                    </div>
                    <div>
                      <Label>Calories (kcal)</Label>
                      <Input type="number" placeholder="Optional" value={itemForm.calories} onChange={e => setItemForm(p => ({ ...p, calories: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Tags</Label>
                      <Input placeholder="spicy, popular (comma-sep)" value={itemForm.tags} onChange={e => setItemForm(p => ({ ...p, tags: e.target.value }))} />
                    </div>
                    <div className="col-span-2">
                      <Label>Kitchen / Station</Label>
                      <select className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm bg-background" value={itemForm.kitchenId} onChange={e => setItemForm(p => ({ ...p, kitchenId: e.target.value }))}>
                        <option value="">Default kitchen</option>
                        {kitchens.filter((k: Kitchen) => k.isActive).map((k: Kitchen) => (
                          <option key={k.id} value={k.id}>{k.name}{k.isDefault ? " (default)" : ""}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-muted-foreground mt-1">Tickets for this item route to the selected kitchen station.</p>
                    </div>
                    <div className="col-span-2 flex items-center gap-3 pt-1">
                      <Label>Type:</Label>
                      <button onClick={() => setItemForm(p => ({ ...p, isVeg: true }))} className={cn("flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-colors", itemForm.isVeg ? "bg-green-100 border-green-400 text-green-700" : "border-border text-muted-foreground")}>
                        <Leaf className="w-3 h-3" />Veg
                      </button>
                      <button onClick={() => setItemForm(p => ({ ...p, isVeg: false }))} className={cn("flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-colors", !itemForm.isVeg ? "bg-red-100 border-red-400 text-red-700" : "border-border text-muted-foreground")}>
                        Non-Veg
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                editItem && <ModifierGroupPanel itemId={editItem.id} />
              )}
            </div>

            {activeTab === "details" && (
              <div className="px-6 pb-5 flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => { setShowItemModal(false); setEditItem(null); }}>Cancel</Button>
                <Button className="flex-1" onClick={handleSaveItem} disabled={createItem.isPending || updateItem.isPending}>
                  {editItem ? "Update Item" : "Create Item"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
