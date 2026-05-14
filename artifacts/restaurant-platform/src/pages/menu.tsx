import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useMenus, useMenuCategories, useMenuItems,
  useCreateMenu, useUpdateMenu, useDeleteMenu,
  useCreateCategory, useUpdateCategory, useDeleteCategory,
  useCreateMenuItem, useUpdateMenuItem, useDeleteMenuItem,
  useModifierGroups, useModifiers, useCreateModifierGroup, useCreateModifier,
  useKitchens, useBulkAssignKitchen,
  useInventory, useRecipeMappings, useCreateRecipeMapping, useUpdateRecipeMapping, useDeleteRecipeMapping,
  useRestaurantId,
} from "@/lib/hooks";
import type { Kitchen, InventoryItem, RecipeMapping } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, Search, Pencil, Trash2, ChevronRight, Download, Upload,
  UtensilsCrossed, Settings2, X, Check, Tag, Clock, Flame, Leaf, ChefHat,
  Sparkles, ImagePlus, Loader2, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Menu, MenuCategory, MenuItem, ModifierGroup, Modifier } from "@/lib/types";
import { ImageUploadField, resolveImageUrl } from "@/components/ImageUploadField";
import { apiPost, apiGet } from "@/lib/api";


type ParsedRow = {
  sku: string | null;
  name: string;
  menuName: string;
  categoryName: string;
  description: string;
  price: string;
  taxRate: string | null;
  isVeg: boolean;
  isAvailable: boolean;
  preparationTime: number;
  calories: number | null;
  tags: string[];
  allergens: string[];
  imageUrl: string | null;
};

type ImportResultRow = {
  row: number;
  status: "create" | "update" | "error";
  errors: string[];
  name: string;
  sku: string | null;
  category: string | null;
  matchedItemId: number | null;
};

type ImportResponse = {
  dryRun: boolean;
  committed: boolean;
  summary: { total: number; create: number; update: number; error: number };
  results: ImportResultRow[];
};

type ImportPreview = { rows: ParsedRow[]; response: ImportResponse };

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim().length > 0));
}

function parseMenuCSV(text: string): ParsedRow[] {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const i = {
    sku: idx("SKU"), menu: idx("Menu"), category: idx("Category"), name: idx("Name"),
    description: idx("Description"), price: idx("Price"), taxRate: idx("Tax Rate"),
    veg: idx("Veg"), available: idx("Available"), prep: idx("Prep Time"),
    calories: idx("Calories"), tags: idx("Tags"), allergens: idx("Allergens"),
    imageUrl: idx("Image URL"),
  };
  const get = (cols: string[], k: number) => (k >= 0 ? (cols[k] ?? "").trim() : "");
  return rows.slice(1).map((cols) => {
    const tags = get(cols, i.tags);
    const allergens = get(cols, i.allergens);
    const calStr = get(cols, i.calories);
    const taxStr = get(cols, i.taxRate);
    return {
      sku: get(cols, i.sku) || null,
      name: get(cols, i.name),
      menuName: get(cols, i.menu),
      categoryName: get(cols, i.category),
      description: get(cols, i.description),
      price: get(cols, i.price),
      taxRate: taxStr || null,
      isVeg: get(cols, i.veg).toLowerCase() === "yes",
      isAvailable: get(cols, i.available).toLowerCase() !== "no",
      preparationTime: get(cols, i.prep) === "" ? 15 : Number(get(cols, i.prep)),
      calories: calStr ? Number(calStr) : null,
      tags: tags ? tags.split(";").map(t => t.trim()).filter(Boolean) : [],
      allergens: allergens ? allergens.split(";").map(t => t.trim()).filter(Boolean) : [],
      imageUrl: get(cols, i.imageUrl) || null,
    };
  });
}

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

function RecipePanel({ itemId, itemPrice }: { itemId: number; itemPrice: string }) {
  const { data: recipe = [] } = useRecipeMappings({ menuItemId: itemId });
  const { data: inventory = [] } = useInventory();
  const createMapping = useCreateRecipeMapping();
  const updateMapping = useUpdateRecipeMapping();
  const deleteMapping = useDeleteRecipeMapping();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ inventoryItemId: "", quantity: "", unit: "" });

  const totalCogs = recipe.reduce((s: number, r: RecipeMapping) => s + Number(r.quantity) * Number(r.costPerUnit ?? 0), 0);
  const price = Number(itemPrice);
  const margin = price > 0 ? ((price - totalCogs) / price) * 100 : 0;
  const foodCostPct = price > 0 ? (totalCogs / price) * 100 : 0;
  const isLowMargin = recipe.length > 0 && foodCostPct >= 65;

  const inv: InventoryItem[] = inventory as InventoryItem[];
  const availableInv = inv.filter(i => !recipe.some((r: RecipeMapping) => r.inventoryItemId === i.id));

  const handleAdd = async () => {
    if (!form.inventoryItemId || !form.quantity) {
      toast({ title: "Pick an ingredient and enter a quantity", variant: "destructive" });
      return;
    }
    const invItem = inv.find(i => i.id === Number(form.inventoryItemId));
    try {
      await createMapping.mutateAsync({
        menuItemId: itemId,
        inventoryItemId: Number(form.inventoryItemId),
        quantity: form.quantity,
        unit: form.unit || invItem?.unit || "kg",
      });
      setForm({ inventoryItemId: "", quantity: "", unit: "" });
      setShowAdd(false);
    } catch {
      toast({ title: "Failed to add ingredient", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-muted/30 border border-border rounded-lg p-3">
          <p className="text-[10px] uppercase text-muted-foreground font-medium">Price</p>
          <p className="text-base font-bold">₹{price.toFixed(2)}</p>
        </div>
        <div className="bg-muted/30 border border-border rounded-lg p-3">
          <p className="text-[10px] uppercase text-muted-foreground font-medium">Live COGS</p>
          <p className="text-base font-bold">₹{totalCogs.toFixed(2)}</p>
        </div>
        <div className={cn("border rounded-lg p-3", isLowMargin ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200")}>
          <p className="text-[10px] uppercase text-muted-foreground font-medium">Margin</p>
          <p className={cn("text-base font-bold", isLowMargin ? "text-red-700" : "text-green-700")}>
            {recipe.length === 0 ? "–" : `${margin.toFixed(1)}%`}
          </p>
        </div>
      </div>

      {isLowMargin && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-md">
          Low margin: food cost is {foodCostPct.toFixed(1)}% of price (≥ 65% threshold).
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
          <p className="text-xs font-semibold">Ingredients</p>
          {!showAdd && (
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowAdd(true)}>
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          )}
        </div>

        {recipe.length === 0 && !showAdd && (
          <p className="text-xs text-muted-foreground text-center py-6">No ingredients yet. Add one to start tracking food cost.</p>
        )}

        {recipe.map((r: RecipeMapping) => {
          const lineCost = Number(r.quantity) * Number(r.costPerUnit ?? 0);
          return (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-0 text-xs">
              <span className="flex-1 font-medium truncate">{r.inventoryItemName ?? "Unknown"}</span>
              <Input
                type="number"
                step="0.001"
                value={r.quantity}
                onChange={async e => {
                  try {
                    await updateMapping.mutateAsync({ id: r.id, quantity: e.target.value });
                  } catch {
                    toast({ title: "Update failed", variant: "destructive" });
                  }
                }}
                className="h-7 w-20 text-xs"
              />
              <span className="text-muted-foreground w-12">{r.unit}</span>
              <span className="text-muted-foreground w-20 text-right">@ ₹{Number(r.costPerUnit ?? 0).toFixed(2)}/{r.inventoryUnit}</span>
              <span className="font-semibold w-16 text-right">₹{lineCost.toFixed(2)}</span>
              <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteMapping.mutate(r.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          );
        })}

        {showAdd && (
          <div className="p-2 border-t border-border bg-muted/20 space-y-2">
            <select
              className="w-full border border-input rounded-md px-2 py-1.5 text-xs bg-background"
              value={form.inventoryItemId}
              onChange={e => {
                const inv2 = inv.find(i => i.id === Number(e.target.value));
                setForm(p => ({ ...p, inventoryItemId: e.target.value, unit: inv2?.unit ?? p.unit }));
              }}
            >
              <option value="">Select ingredient…</option>
              {availableInv.map(i => (
                <option key={i.id} value={i.id}>{i.name} (₹{Number(i.costPerUnit).toFixed(2)}/{i.unit})</option>
              ))}
            </select>
            <div className="flex gap-2">
              <Input type="number" step="0.001" placeholder="Qty" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} className="h-7 text-xs flex-1" />
              <Input placeholder="Unit" value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} className="h-7 text-xs w-20" />
              <Button size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={createMapping.isPending}>Add</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowAdd(false); setForm({ inventoryItemId: "", quantity: "", unit: "" }); }}>Cancel</Button>
            </div>
            {availableInv.length === 0 && (
              <p className="text-[10px] text-muted-foreground">All inventory items are already in this recipe.</p>
            )}
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        COGS auto-recalculates when an inventory item's purchase price changes.
      </p>
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
  allergens: string;
  kitchenId: string;
};

const EMPTY_ITEM_FORM: ItemForm = {
  name: "", price: "", description: "", categoryId: "", isVeg: true,
  preparationTime: "15", imageUrl: "", calories: "", tags: "", allergens: "", kitchenId: "",
};

type DescriptionDraftPayload = { description: string; allergens: string[]; tags: string[] };
type PhotoDraftPayload = { imageUrl: string };
type AiDraft<T> = { id: number; kind: string; payload: T; createdAt: string };
type AiDraftsResponse = {
  description: AiDraft<DescriptionDraftPayload>[];
  photo: AiDraft<PhotoDraftPayload>[];
};

export default function MenuPage() {
  const RESTAURANT_ID = useRestaurantId();
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
  const [menuForm, setMenuForm] = useState({ name: "", description: "", imageUrl: "", availableFrom: "", availableTo: "" });

  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState<MenuCategory | null>(null);
  const [catForm, setCatForm] = useState({ name: "", description: "", imageUrl: "" });

  const [showItemModal, setShowItemModal] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(EMPTY_ITEM_FORM);
  const [activeTab, setActiveTab] = useState<"details" | "modifiers" | "recipe">("details");
  const [aiBusy, setAiBusy] = useState<null | "description" | "photo">(null);
  const [aiDrafts, setAiDrafts] = useState<AiDraftsResponse>({ description: [], photo: [] });
  const [showHistory, setShowHistory] = useState(false);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

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
      allergens: Array.isArray(item.allergens) ? item.allergens.join(", ") : "",
      kitchenId: item.kitchenId != null ? String(item.kitchenId) : "",
    });
    setActiveTab("details");
    setShowItemModal(true);
    setShowHistory(false);
    setAiDrafts({ description: [], photo: [] });
    apiGet<AiDraftsResponse>(`/restaurants/${RESTAURANT_ID}/items/${item.id}/ai-drafts`)
      .then(setAiDrafts)
      .catch(() => { /* silent */ });
  };

  const applyDescriptionDraft = (p: DescriptionDraftPayload) => {
    setItemForm(prev => ({
      ...prev,
      description: p.description,
      allergens: p.allergens.join(", "),
      tags: p.tags.join(", "),
    }));
  };

  const handleGenerateDescription = async () => {
    if (!editItem) {
      toast({ title: "Save the item first, then use AI to draft copy", variant: "destructive" });
      return;
    }
    setAiBusy("description");
    try {
      const res = await apiPost<{ payload: DescriptionDraftPayload }>(
        `/restaurants/${RESTAURANT_ID}/items/${editItem.id}/ai-description`,
        {},
      );
      applyDescriptionDraft(res.payload);
      const drafts = await apiGet<AiDraftsResponse>(`/restaurants/${RESTAURANT_ID}/items/${editItem.id}/ai-drafts`);
      setAiDrafts(drafts);
      toast({ title: "Draft generated — review and save when happy" });
    } catch (e: unknown) {
      toast({ title: (e as { message?: string })?.message ?? "AI draft failed", variant: "destructive" });
    } finally {
      setAiBusy(null);
    }
  };

  const handleGeneratePhoto = async () => {
    if (!editItem) {
      toast({ title: "Save the item first, then generate a photo", variant: "destructive" });
      return;
    }
    setAiBusy("photo");
    try {
      const res = await apiPost<{ payload: PhotoDraftPayload }>(
        `/restaurants/${RESTAURANT_ID}/items/${editItem.id}/ai-photo`,
        {},
      );
      setItemForm(prev => ({ ...prev, imageUrl: res.payload.imageUrl }));
      const drafts = await apiGet<AiDraftsResponse>(`/restaurants/${RESTAURANT_ID}/items/${editItem.id}/ai-drafts`);
      setAiDrafts(drafts);
      toast({ title: "Photo suggested — accept or regenerate" });
    } catch (e: unknown) {
      toast({ title: (e as { message?: string })?.message ?? "Photo generation failed", variant: "destructive" });
    } finally {
      setAiBusy(null);
    }
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
      imageUrl: itemForm.imageUrl ? itemForm.imageUrl : null,
      calories: itemForm.calories ? Number(itemForm.calories) : undefined,
      tags: itemForm.tags.split(",").map(t => t.trim()).filter(Boolean),
      allergens: itemForm.allergens.split(",").map(t => t.trim()).filter(Boolean),
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
      const menuPayload = { ...menuForm, imageUrl: menuForm.imageUrl ? menuForm.imageUrl : null };
      if (editMenu) {
        await updateMenu.mutateAsync({ id: editMenu.id, ...menuPayload });
        toast({ title: "Menu updated" });
      } else {
        const m = await createMenu.mutateAsync(menuPayload);
        setSelectedMenuId(m.id);
        toast({ title: "Menu created" });
      }
      setShowMenuModal(false);
      setEditMenu(null);
      setMenuForm({ name: "", description: "", imageUrl: "", availableFrom: "", availableTo: "" });
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
      const catPayload = { ...catForm, imageUrl: catForm.imageUrl ? catForm.imageUrl : null };
      if (editCat) {
        await updateCategory.mutateAsync({ id: editCat.id, ...catPayload });
        toast({ title: "Category updated" });
      } else {
        await createCategory.mutateAsync({ menuId: activeMenuId, ...catPayload });
        toast({ title: "Category created" });
      }
      setShowCatModal(false);
      setEditCat(null);
      setCatForm({ name: "", description: "", imageUrl: "" });
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

  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const runImport = async (rows: ParsedRow[], dryRun: boolean) => {
    const { apiPost } = await import("@/lib/api");
    return apiPost<ImportResponse>(`/restaurants/${RESTAURANT_ID}/items/import`, { items: rows, dryRun });
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseMenuCSV(text);
      if (parsed.length === 0) {
        toast({ title: "No data rows found in CSV", variant: "destructive" });
        return;
      }
      setImportBusy(true);
      try {
        const res = await runImport(parsed, true);
        setImportPreview({ rows: parsed, response: res });
      } catch (err: unknown) {
        toast({ title: (err as { message?: string })?.message ?? "Failed to read CSV", variant: "destructive" });
      } finally {
        setImportBusy(false);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    setImportBusy(true);
    try {
      const res = await runImport(importPreview.rows, false);
      toast({ title: `Imported ${res.summary.create} new + ${res.summary.update} updated` });
      setImportPreview(null);
      await queryClient.invalidateQueries({ queryKey: ["items"] });
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      await queryClient.invalidateQueries({ queryKey: ["menus"] });
    } catch (err: unknown) {
      toast({ title: (err as { message?: string })?.message ?? "Import failed", variant: "destructive" });
    } finally {
      setImportBusy(false);
    }
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
            <Button size="sm" variant="outline" onClick={() => csvInputRef.current?.click()} disabled={importBusy}>
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
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setEditMenu(null); setMenuForm({ name: "", description: "", imageUrl: "", availableFrom: "", availableTo: "" }); setShowMenuModal(true); }}>
                <Plus className="w-3 h-3" />
              </Button>
            </div>
            <div className="space-y-0.5">
              {menus.map((m: Menu) => (
                <div key={m.id} className={cn("flex items-center rounded-md px-2 py-1.5 cursor-pointer group transition-colors", activeMenuId === m.id ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground")} onClick={() => { setSelectedMenuId(m.id); setSelectedCatId(undefined); }}>
                  {m.imageUrl ? (
                    <img src={resolveImageUrl(m.imageUrl)} alt="" className="w-5 h-5 rounded object-cover mr-2 flex-shrink-0 bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <UtensilsCrossed className="w-3.5 h-3.5 mr-2 flex-shrink-0" />
                  )}
                  <span className="text-xs font-medium flex-1 truncate">{m.name}</span>
                  {!m.isActive && <span className="text-[9px] text-muted-foreground mr-1">off</span>}
                  <div className="hidden group-hover:flex items-center gap-0.5">
                    <button className="p-0.5 hover:text-primary" onClick={e => { e.stopPropagation(); setEditMenu(m); setMenuForm({ name: m.name, description: m.description ?? "", imageUrl: m.imageUrl ?? "", availableFrom: m.availableFrom ?? "", availableTo: m.availableTo ?? "" }); setShowMenuModal(true); }}><Pencil className="w-2.5 h-2.5" /></button>
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
                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => { setEditCat(null); setCatForm({ name: "", description: "", imageUrl: "" }); setShowCatModal(true); }}>
                  <Plus className="w-3 h-3" />
                </Button>
              )}
            </div>

            <button className={cn("w-full text-left flex items-center px-2 py-1.5 rounded-md text-xs transition-colors mb-0.5", !selectedCatId ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground")} onClick={() => setSelectedCatId(undefined)}>
              All Items
            </button>

            {categories.map((cat: MenuCategory) => (
              <div key={cat.id} className={cn("group flex items-center px-2 py-1.5 rounded-md cursor-pointer text-xs transition-colors mb-0.5", selectedCatId === cat.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground")} onClick={() => setSelectedCatId(cat.id)}>
                {cat.imageUrl && (
                  <img src={resolveImageUrl(cat.imageUrl)} alt="" className="w-5 h-5 rounded object-cover mr-2 flex-shrink-0 bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                <span className="flex-1 truncate">{cat.name}</span>
                <div className="hidden group-hover:flex items-center gap-0.5">
                  <button className="p-0.5 hover:text-primary" onClick={e => { e.stopPropagation(); setEditCat(cat); setCatForm({ name: cat.name, description: cat.description ?? "", imageUrl: cat.imageUrl ?? "" }); setShowCatModal(true); }}><Pencil className="w-2.5 h-2.5" /></button>
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
                          <img src={resolveImageUrl(item.imageUrl)} alt={item.name} className="w-8 h-8 rounded-md object-cover flex-shrink-0 bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
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
              <ImageUploadField label="Banner image" value={menuForm.imageUrl} onChange={url => setMenuForm(p => ({ ...p, imageUrl: url }))} />
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
              <ImageUploadField label="Thumbnail" value={catForm.imageUrl} onChange={url => setCatForm(p => ({ ...p, imageUrl: url }))} />
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => { setShowCatModal(false); setEditCat(null); }}>Cancel</Button>
                <Button className="flex-1" onClick={handleSaveCat} disabled={createCategory.isPending || updateCategory.isPending}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importPreview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="px-6 pt-5 pb-3 border-b border-border flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Review CSV import</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {importPreview.response.summary.total} rows ·
                  <span className="text-green-600 font-medium"> {importPreview.response.summary.create} new</span> ·
                  <span className="text-blue-600 font-medium"> {importPreview.response.summary.update} updates</span>
                  {importPreview.response.summary.error > 0 && (
                    <span className="text-destructive font-medium"> · {importPreview.response.summary.error} errors</span>
                  )}
                </p>
              </div>
              <button onClick={() => setImportPreview(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-3">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-2 w-10">#</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Name</th>
                    <th className="py-2 pr-2">SKU</th>
                    <th className="py-2 pr-2">Menu / Category</th>
                    <th className="py-2">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.response.results.map((r) => (
                    <tr key={r.row} className={cn("border-b border-border last:border-0", r.status === "error" && "bg-red-50 dark:bg-red-950/30")}>
                      <td className="py-1.5 pr-2 text-muted-foreground">{r.row}</td>
                      <td className="py-1.5 pr-2">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-medium",
                          r.status === "create" && "bg-green-100 text-green-700",
                          r.status === "update" && "bg-blue-100 text-blue-700",
                          r.status === "error" && "bg-red-100 text-red-700",
                        )}>{r.status}</span>
                      </td>
                      <td className="py-1.5 pr-2">{r.name || <span className="text-muted-foreground italic">(missing)</span>}</td>
                      <td className="py-1.5 pr-2 font-mono text-[10px]">{r.sku ?? "—"}</td>
                      <td className="py-1.5 pr-2">{importPreview.rows[r.row - 1]?.menuName || "—"} / {r.category ?? "—"}</td>
                      <td className="py-1.5 text-destructive">{r.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-border flex items-center gap-3">
              {importPreview.response.summary.error > 0 && (
                <p className="text-xs text-destructive flex-1">Fix the errors in your CSV and re-upload to commit.</p>
              )}
              {importPreview.response.summary.error === 0 && (
                <p className="text-xs text-muted-foreground flex-1">All rows look good. Click Confirm to commit in a single transaction.</p>
              )}
              <Button variant="outline" onClick={() => setImportPreview(null)}>Cancel</Button>
              <Button
                onClick={handleConfirmImport}
                disabled={importBusy || importPreview.response.summary.error > 0 || (importPreview.response.summary.create + importPreview.response.summary.update === 0)}
              >
                Confirm import
              </Button>
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
              <button
                className={cn("flex-1 text-sm py-2.5 font-medium border-b-2 transition-colors", activeTab === "recipe" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground", !editItem && "opacity-40 cursor-not-allowed")}
                onClick={() => editItem && setActiveTab("recipe")}
              >
                <ChefHat className="w-3.5 h-3.5 inline mr-1.5" />Recipe
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
                      <div className="flex items-center justify-between mb-1">
                        <Label>Description</Label>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs"
                          onClick={handleGenerateDescription}
                          disabled={!editItem || aiBusy !== null}
                          title={!editItem ? "Save the item first" : "Draft description, allergens & tags from name + category"}
                        >
                          {aiBusy === "description" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                          Generate with AI
                        </Button>
                      </div>
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
                      <ImageUploadField label="Photo" value={itemForm.imageUrl} onChange={url => setItemForm(p => ({ ...p, imageUrl: url }))} />
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={handleGeneratePhoto}
                          disabled={!editItem || aiBusy !== null}
                          title={!editItem ? "Save the item first" : itemForm.imageUrl ? "Regenerate AI food photo" : "Generate an AI food photo"}
                        >
                          {aiBusy === "photo" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ImagePlus className="w-3 h-3 mr-1" />}
                          {itemForm.imageUrl ? "Regenerate AI photo" : "Suggest AI photo"}
                        </Button>
                        <p className="text-[10px] text-muted-foreground">AI photos are suggestions — review before saving.</p>
                      </div>
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
                      <Label>Allergens</Label>
                      <Input placeholder="dairy, gluten, nuts (comma-sep)" value={itemForm.allergens} onChange={e => setItemForm(p => ({ ...p, allergens: e.target.value }))} />
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
                    {editItem && (aiDrafts.description.length > 0 || aiDrafts.photo.length > 0) && (
                      <div className="col-span-2 border border-dashed border-border rounded-lg bg-muted/20">
                        <button
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                          onClick={() => setShowHistory(s => !s)}
                        >
                          <History className="w-3 h-3" />
                          AI draft history
                          <span className="text-[10px] text-muted-foreground/80">
                            ({aiDrafts.description.length} text · {aiDrafts.photo.length} photo · last 3 kept)
                          </span>
                          <ChevronRight className={cn("w-3 h-3 ml-auto transition-transform", showHistory && "rotate-90")} />
                        </button>
                        {showHistory && (
                          <div className="px-3 pb-3 space-y-3">
                            {aiDrafts.description.length > 0 && (
                              <div>
                                <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1.5">Description drafts</p>
                                <div className="space-y-1.5">
                                  {aiDrafts.description.map(d => (
                                    <div key={d.id} className="text-xs bg-card border border-border rounded-md p-2">
                                      <p className="text-foreground">{d.payload.description}</p>
                                      {(d.payload.tags?.length > 0 || d.payload.allergens?.length > 0) && (
                                        <p className="text-[10px] text-muted-foreground mt-1">
                                          {d.payload.tags?.length > 0 && <>tags: {d.payload.tags.join(", ")}</>}
                                          {d.payload.tags?.length > 0 && d.payload.allergens?.length > 0 && " · "}
                                          {d.payload.allergens?.length > 0 && <>allergens: {d.payload.allergens.join(", ")}</>}
                                        </p>
                                      )}
                                      <div className="flex items-center justify-between mt-1.5">
                                        <span className="text-[9px] text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</span>
                                        <Button type="button" size="sm" variant="ghost" className="h-5 text-[10px]" onClick={() => applyDescriptionDraft(d.payload)}>
                                          Use this
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {aiDrafts.photo.length > 0 && (
                              <div>
                                <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1.5">Photo drafts</p>
                                <div className="grid grid-cols-3 gap-1.5">
                                  {aiDrafts.photo.map(d => (
                                    <button
                                      key={d.id}
                                      type="button"
                                      onClick={() => setItemForm(prev => ({ ...prev, imageUrl: d.payload.imageUrl }))}
                                      className={cn(
                                        "relative aspect-square rounded-md overflow-hidden border-2 transition-colors",
                                        itemForm.imageUrl === d.payload.imageUrl ? "border-primary" : "border-border hover:border-primary/50",
                                      )}
                                      title={`Generated ${new Date(d.createdAt).toLocaleString()}`}
                                    >
                                      <img src={resolveImageUrl(d.payload.imageUrl)} alt="" className="w-full h-full object-cover" />
                                      {itemForm.imageUrl === d.payload.imageUrl && (
                                        <span className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center">
                                          <Check className="w-2.5 h-2.5" />
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
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
              ) : activeTab === "modifiers" ? (
                editItem && <ModifierGroupPanel itemId={editItem.id} />
              ) : (
                editItem && <RecipePanel itemId={editItem.id} itemPrice={editItem.price} />
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
