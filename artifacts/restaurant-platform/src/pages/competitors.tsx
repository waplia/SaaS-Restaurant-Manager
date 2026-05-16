import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Eye, Plus, Pencil, Trash2, ExternalLink, Scale } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/utils";

interface Competitor {
  id: number;
  name: string;
  area: string | null;
  cuisine: string | null;
  notes: string | null;
  lastRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function CompetitorsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Competitor | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["competitors", restaurantId],
    queryFn: () => apiGet<{ data: Competitor[] }>(`/restaurants/${restaurantId}/competitors`),
  });

  const createMut = useMutation({
    mutationFn: (body: Partial<Competitor>) =>
      apiPost(`/restaurants/${restaurantId}/competitors`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["competitors", restaurantId] });
      setCreating(false);
      toast({ title: "Competitor added" });
    },
    onError: (e: Error) => toast({ title: "Failed to add", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: Partial<Competitor> & { id: number }) =>
      apiPatch(`/restaurants/${restaurantId}/competitors/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["competitors", restaurantId] });
      setEditing(null);
      toast({ title: "Competitor updated" });
    },
    onError: (e: Error) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/competitors/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["competitors", restaurantId] });
      setDeleting(null);
      toast({ title: "Competitor removed" });
    },
    onError: (e: Error) => toast({ title: "Failed to remove", description: e.message, variant: "destructive" }),
  });

  const competitors = data?.data ?? [];

  return (
    <Layout>
      <PageHeader
        title="Competitor Tracker"
        subtitle="Track nearby competitors' menus, prices and offers."
        actions={
          <>
            <Link href="/competitors/comparison">
              <Button variant="outline" size="sm" data-testid="button-comparison-views">
                <Scale className="h-4 w-4 mr-2" />Comparison views
              </Button>
            </Link>
            <Button size="sm" onClick={() => setCreating(true)} data-testid="button-add-competitor">
              <Plus className="h-4 w-4 mr-2" />Add competitor
            </Button>
          </>
        }
      />

      <div className="p-6 space-y-4">
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
          </div>
        ) : competitors.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Eye className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-base font-medium">No competitors yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add a competitor to get started.</p>
              <Button className="mt-4" onClick={() => setCreating(true)} data-testid="button-empty-add">
                <Plus className="h-4 w-4 mr-2" />Add competitor
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {competitors.map((c) => (
              <Card key={c.id} data-testid={`competitor-card-${c.id}`}>
                <CardContent className="pt-5 pb-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/competitors/${c.id}`}>
                        <span className="font-semibold hover:underline cursor-pointer block truncate" data-testid={`competitor-name-${c.id}`}>{c.name}</span>
                      </Link>
                      {c.area && <p className="text-xs text-muted-foreground truncate">{c.area}</p>}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(c)} data-testid={`button-edit-${c.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleting(c)} data-testid={`button-delete-${c.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {c.cuisine && <Badge variant="secondary" className="text-xs">{c.cuisine}</Badge>}
                  {c.notes && <p className="text-xs text-muted-foreground line-clamp-2">{c.notes}</p>}
                  <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                    <span>
                      {c.lastRefreshedAt
                        ? `Refreshed ${formatDateTime(c.lastRefreshedAt)}`
                        : "Never refreshed"}
                    </span>
                    <Link href={`/competitors/${c.id}`}>
                      <span className="text-primary hover:underline cursor-pointer flex items-center gap-1">
                        Details <ExternalLink className="h-3 w-3" />
                      </span>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CompetitorFormDialog
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
            <AlertDialogTitle>Remove competitor?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleting?.name}&quot; and all its tracked items, links and notes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMut.mutate(deleting.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

function CompetitorFormDialog({
  open, initial, onClose, onSave, saving,
}: {
  open: boolean;
  initial?: Competitor;
  onClose: () => void;
  onSave: (v: { name: string; area: string; cuisine: string; notes: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [area, setArea] = useState(initial?.area ?? "");
  const [cuisine, setCuisine] = useState(initial?.cuisine ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit competitor" : "Add competitor"}</DialogTitle>
          <DialogDescription>Track a nearby restaurant's menu and offers.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="comp-name">Name *</Label>
            <Input id="comp-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-competitor-name" />
          </div>
          <div>
            <Label htmlFor="comp-area">Area / locality</Label>
            <Input id="comp-area" value={area} onChange={(e) => setArea(e.target.value)} data-testid="input-competitor-area" />
          </div>
          <div>
            <Label htmlFor="comp-cuisine">Cuisine</Label>
            <Input id="comp-cuisine" value={cuisine} onChange={(e) => setCuisine(e.target.value)} data-testid="input-competitor-cuisine" />
          </div>
          <div>
            <Label htmlFor="comp-notes">Notes</Label>
            <Textarea id="comp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} data-testid="input-competitor-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || !name.trim()}
            onClick={() => onSave({ name: name.trim(), area: area.trim(), cuisine: cuisine.trim(), notes: notes.trim() })}
            data-testid="button-save-competitor"
          >
            {saving ? "Saving…" : initial ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
