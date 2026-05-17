import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { apiGet, apiPut } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

interface Profile {
  profile: { id: number; customerId: number; spicyTolerance: number | null; sweetPreference: number | null; preferredCuisines: string[]; dietary: string[]; allergens: string[]; dislikedIngredients: string[]; favoriteItemIds: number[]; notes: string | null; };
  customerName: string | null; customerPhone: string | null;
}

export default function MenuTasteProfilesPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const empty = { customerId: "", spicyTolerance: 2, sweetPreference: 2, preferredCuisines: "", dietary: "", allergens: "", dislikedIngredients: "", notes: "" };
  const [form, setForm] = useState(empty);

  const { data } = useQuery({ queryKey: ["taste", restaurantId], queryFn: () => apiGet<{ data: Profile[] }>(`/restaurants/${restaurantId}/menu-intel/taste-profiles`) });

  const save = useMutation({
    mutationFn: () => apiPut(`/restaurants/${restaurantId}/menu-intel/taste-profiles/${Number(form.customerId)}`, {
      spicyTolerance: Number(form.spicyTolerance), sweetPreference: Number(form.sweetPreference),
      preferredCuisines: form.preferredCuisines.split(",").map((s) => s.trim()).filter(Boolean),
      dietary: form.dietary.split(",").map((s) => s.trim()).filter(Boolean),
      allergens: form.allergens.split(",").map((s) => s.trim()).filter(Boolean),
      dislikedIngredients: form.dislikedIngredients.split(",").map((s) => s.trim()).filter(Boolean),
      notes: form.notes,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["taste", restaurantId] }); setOpen(false); setForm(empty); toast({ title: "Profile saved" }); },
  });

  return (
    <Layout>
      <PageHeader title="Dish Taste Profiles" description="Per-guest taste, allergen and dietary preferences." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New / Update</Button>} />
      <div className="p-4 sm:p-6 max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-3">
        {(data?.data ?? []).map((p) => (
          <Card key={p.profile.id}><CardContent className="p-4 space-y-2">
            <div className="font-medium">{p.customerName ?? `Customer #${p.profile.customerId}`} <span className="text-xs text-muted-foreground">{p.customerPhone}</span></div>
            <div className="text-sm">Spicy: {p.profile.spicyTolerance ?? "—"}/5 · Sweet: {p.profile.sweetPreference ?? "—"}/5</div>
            <div className="flex flex-wrap gap-1">{p.profile.dietary.map((d) => <Badge key={d} variant="secondary">{d}</Badge>)}</div>
            {p.profile.allergens.length > 0 && <div className="text-xs">Allergens: {p.profile.allergens.join(", ")}</div>}
            {p.profile.notes && <div className="text-xs text-muted-foreground">{p.profile.notes}</div>}
          </CardContent></Card>
        ))}
        {(data?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground col-span-2">No taste profiles yet.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Save taste profile</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div><Label>Customer ID</Label><Input type="number" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Spicy (0-5)</Label><Input type="number" min={0} max={5} value={form.spicyTolerance} onChange={(e) => setForm({ ...form, spicyTolerance: Number(e.target.value) })} /></div>
              <div><Label>Sweet (0-5)</Label><Input type="number" min={0} max={5} value={form.sweetPreference} onChange={(e) => setForm({ ...form, sweetPreference: Number(e.target.value) })} /></div>
            </div>
            <div><Label>Preferred cuisines (comma)</Label><Input value={form.preferredCuisines} onChange={(e) => setForm({ ...form, preferredCuisines: e.target.value })} /></div>
            <div><Label>Dietary (veg, vegan, jain…)</Label><Input value={form.dietary} onChange={(e) => setForm({ ...form, dietary: e.target.value })} /></div>
            <div><Label>Allergens</Label><Input value={form.allergens} onChange={(e) => setForm({ ...form, allergens: e.target.value })} /></div>
            <div><Label>Disliked ingredients</Label><Input value={form.dislikedIngredients} onChange={(e) => setForm({ ...form, dislikedIngredients: e.target.value })} /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={() => save.mutate()} disabled={!form.customerId}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
