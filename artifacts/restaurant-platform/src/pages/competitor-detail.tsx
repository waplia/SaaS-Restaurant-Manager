import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  RefreshCw, Sparkles, Plus, Trash2, ExternalLink, Pencil, ArrowLeft, Link as LinkIcon, Tag,
} from "lucide-react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from "@/lib/api";
import { useRestaurantId, useMenuItems } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDateTime } from "@/lib/utils";

interface Competitor {
  id: number;
  name: string;
  area: string | null;
  cuisine: string | null;
  notes: string | null;
  lastRefreshedAt: string | null;
}
interface CompetitorMenuLink {
  id: number;
  competitorId: number;
  label: string;
  url: string;
}
interface CompetitorItem {
  id: number;
  name: string;
  category: string | null;
  price: string | null;
  description: string | null;
  offer: string | null;
  notes: string | null;
  isNew: boolean;
  noticedAt: string | null;
  linkedMenuItemId: number | null;
}
interface DetailResponse {
  competitor: Competitor;
  links: CompetitorMenuLink[];
  items: CompetitorItem[];
}

export default function CompetitorDetailPage() {
  const params = useParams<{ id: string }>();
  const competitorId = Number(params.id);
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["competitor-detail", restaurantId, competitorId],
    queryFn: () => apiGet<DetailResponse>(`/restaurants/${restaurantId}/competitors/${competitorId}`),
    enabled: Number.isFinite(competitorId),
  });

  const { data: menuItems = [] } = useMenuItems();

  const refresh = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/competitors/${competitorId}/refresh`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["competitor-detail", restaurantId, competitorId] });
      qc.invalidateQueries({ queryKey: ["competitors", restaurantId] });
      toast({ title: "Refreshed", description: "Marked as up-to-date." });
    },
  });

  if (isLoading || !data) {
    return (
      <Layout>
        <PageHeader title="Competitor" />
        <div className="p-6 space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      </Layout>
    );
  }

  const { competitor, links, items } = data;
  const newItems = items.filter((i) => i.isNew);

  return (
    <Layout>
      <PageHeader
        title={competitor.name}
        subtitle={[competitor.area, competitor.cuisine].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <Link href="/competitors">
              <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
            </Link>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button variant="outline" size="sm" disabled data-testid="button-ai-refresh">
                    <Sparkles className="h-4 w-4 mr-2" />AI auto-refresh
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Coming soon: auto-pull menu and prices from links.</TooltipContent>
            </Tooltip>
            <Button
              size="sm"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              data-testid="button-manual-refresh"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refresh.isPending ? "animate-spin" : ""}`} />
              Manual refresh
            </Button>
          </>
        }
      />

      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="pt-5 pb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Last refreshed: </span>
              <span data-testid="text-last-refreshed">
                {competitor.lastRefreshedAt ? formatDateTime(competitor.lastRefreshedAt) : "Never"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Tracked items: </span>
              <span>{items.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Menu links: </span>
              <span>{links.length}</span>
            </div>
            {competitor.notes && (
              <div className="w-full text-muted-foreground italic mt-1">{competitor.notes}</div>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items" data-testid="tab-items">Items</TabsTrigger>
            <TabsTrigger value="links" data-testid="tab-links">Menu Links</TabsTrigger>
            <TabsTrigger value="offers" data-testid="tab-offers">Offers</TabsTrigger>
            <TabsTrigger value="notes" data-testid="tab-notes">New Item Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="mt-4">
            <ItemsTab
              competitorId={competitorId}
              restaurantId={restaurantId}
              items={items}
              menuItems={menuItems}
            />
          </TabsContent>

          <TabsContent value="links" className="mt-4">
            <LinksTab
              competitorId={competitorId}
              restaurantId={restaurantId}
              links={links}
            />
          </TabsContent>

          <TabsContent value="offers" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Active offers</CardTitle></CardHeader>
              <CardContent>
                {items.filter((i) => i.offer).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No offers tracked yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Offer</TableHead>
                        <TableHead>Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.filter((i) => i.offer).map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className="font-medium">{i.name}</TableCell>
                          <TableCell><Badge variant="secondary"><Tag className="h-3 w-3 mr-1" />{i.offer}</Badge></TableCell>
                          <TableCell>{i.price ? formatCurrency(i.price) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Items flagged as &quot;new&quot;</CardTitle>
              </CardHeader>
              <CardContent>
                {newItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No new items flagged. Toggle &quot;new&quot; on an item to add it here.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {newItems.map((i) => (
                      <div key={i.id} className="border rounded-lg p-3" data-testid={`new-item-${i.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{i.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {i.category && `${i.category} · `}
                              Noted {i.noticedAt ? formatDateTime(i.noticedAt) : "—"}
                            </div>
                          </div>
                          <Badge>NEW</Badge>
                        </div>
                        {i.notes && <p className="text-sm mt-2 text-muted-foreground">{i.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

// ─── Items tab ────────────────────────────────────────────────
function ItemsTab({
  competitorId, restaurantId, items, menuItems,
}: {
  competitorId: number;
  restaurantId: number;
  items: CompetitorItem[];
  menuItems: { id: number; name: string }[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CompetitorItem | null>(null);
  const [deleting, setDeleting] = useState<CompetitorItem | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["competitor-detail", restaurantId, competitorId] });

  const createMut = useMutation({
    mutationFn: (body: Partial<CompetitorItem>) =>
      apiPost(`/restaurants/${restaurantId}/competitors/${competitorId}/items`, body),
    onSuccess: () => { invalidate(); setCreating(false); toast({ title: "Item added" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: Partial<CompetitorItem> & { id: number }) =>
      apiPatch(`/restaurants/${restaurantId}/competitor-items/${id}`, body),
    onSuccess: () => { invalidate(); setEditing(null); toast({ title: "Item updated" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/competitor-items/${id}`),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "Item removed" }); },
  });
  const linkMut = useMutation({
    mutationFn: ({ itemId, menuItemId }: { itemId: number; menuItemId: number | null }) =>
      apiPut(`/restaurants/${restaurantId}/competitor-items/${itemId}/link`, { menuItemId }),
    onSuccess: () => { invalidate(); toast({ title: "Link updated" }); },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Tracked items</CardTitle>
        <Button size="sm" onClick={() => setCreating(true)} data-testid="button-add-item">
          <Plus className="h-4 w-4 mr-2" />Add item
        </Button>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No items yet. Add competitor menu items manually.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Offer</TableHead>
                <TableHead>Linked to my menu</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id} data-testid={`item-row-${i.id}`}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {i.name}
                      {i.isNew && <Badge className="text-[10px] py-0">NEW</Badge>}
                    </div>
                    {i.description && <div className="text-xs text-muted-foreground">{i.description}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{i.category ?? "—"}</TableCell>
                  <TableCell>{i.price ? formatCurrency(i.price) : "—"}</TableCell>
                  <TableCell className="text-sm">{i.offer ?? "—"}</TableCell>
                  <TableCell>
                    <Select
                      value={i.linkedMenuItemId ? String(i.linkedMenuItemId) : "none"}
                      onValueChange={(v) =>
                        linkMut.mutate({ itemId: i.id, menuItemId: v === "none" ? null : Number(v) })
                      }
                    >
                      <SelectTrigger className="w-48 h-8 text-xs" data-testid={`select-link-${i.id}`}>
                        <SelectValue placeholder="Auto (by name)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Auto (by name)</SelectItem>
                        {menuItems.map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(i)} data-testid={`button-edit-item-${i.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleting(i)} data-testid={`button-delete-item-${i.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ItemFormDialog
        key={editing?.id ?? (creating ? "new" : "closed")}
        open={creating || editing !== null}
        initial={editing ?? undefined}
        onClose={() => { setCreating(false); setEditing(null); }}
        saving={createMut.isPending || updateMut.isPending}
        onSave={(values) => {
          if (editing) updateMut.mutate({ id: editing.id, ...values });
          else createMut.mutate(values);
        }}
      />
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove item?</AlertDialogTitle>
            <AlertDialogDescription>This will delete &quot;{deleting?.name}&quot;.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMut.mutate(deleting.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ItemFormDialog({
  open, initial, onClose, onSave, saving,
}: {
  open: boolean;
  initial?: CompetitorItem;
  onClose: () => void;
  onSave: (v: { name: string; category: string; price: string; description: string; offer: string; notes: string; isNew: boolean }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [price, setPrice] = useState(initial?.price ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [offer, setOffer] = useState(initial?.offer ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [isNew, setIsNew] = useState(initial?.isNew ?? false);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit item" : "Add competitor item"}</DialogTitle>
          <DialogDescription>Manually capture an item from the competitor's menu.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-item-name" />
            </div>
            <div>
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Mains, Drinks…" data-testid="input-item-category" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Price</Label>
              <Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="input-item-price" />
            </div>
            <div>
              <Label>Offer</Label>
              <Input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="20% off weekdays" data-testid="input-item-offer" />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="input-item-notes" />
          </div>
          <div className="flex items-center justify-between border rounded-md p-3">
            <div>
              <Label className="font-medium">Flag as new item</Label>
              <p className="text-xs text-muted-foreground">Track it under New Item Notes.</p>
            </div>
            <Switch checked={isNew} onCheckedChange={setIsNew} data-testid="switch-item-new" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || !name.trim()}
            onClick={() =>
              onSave({
                name: name.trim(),
                category: category.trim(),
                price: price.trim(),
                description: description.trim(),
                offer: offer.trim(),
                notes: notes.trim(),
                isNew,
              })
            }
            data-testid="button-save-item"
          >
            {saving ? "Saving…" : initial ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Links tab ────────────────────────────────────────────────
function LinksTab({
  competitorId, restaurantId, links,
}: {
  competitorId: number;
  restaurantId: number;
  links: CompetitorMenuLink[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["competitor-detail", restaurantId, competitorId] });

  const addMut = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/competitors/${competitorId}/links`, { label, url }),
    onSuccess: () => { invalidate(); setLabel(""); setUrl(""); toast({ title: "Link added" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (linkId: number) => apiDelete(`/restaurants/${restaurantId}/competitors/${competitorId}/links/${linkId}`),
    onSuccess: () => { invalidate(); toast({ title: "Link removed" }); },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Menu links</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label className="text-xs">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Zomato" data-testid="input-link-label" />
          </div>
          <div className="flex-[2]">
            <Label className="text-xs">URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" data-testid="input-link-url" />
          </div>
          <Button
            disabled={!label.trim() || !url.trim() || addMut.isPending}
            onClick={() => addMut.mutate()}
            data-testid="button-add-link"
          >
            <Plus className="h-4 w-4 mr-1" />Add
          </Button>
        </div>
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No menu links yet.</p>
        ) : (
          <div className="space-y-2">
            {links.map((l) => (
              <div key={l.id} className="flex items-center justify-between border rounded-md p-2" data-testid={`link-${l.id}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <LinkIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <Badge variant="outline">{l.label}</Badge>
                  <a href={l.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline truncate flex items-center gap-1">
                    {l.url} <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  </a>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMut.mutate(l.id)} data-testid={`button-delete-link-${l.id}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
