import { useState, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Flame, Check, ChevronRight, ChevronLeft, SkipForward, Loader2, Plus, Trash2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type StepId = "profile" | "branch" | "kitchen" | "menu_categories" | "menu_items" | "tables" | "staff" | "payment" | "go_live";
interface StepDef { id: StepId; title: string; desc: string; skippable?: boolean }
const STEP_DEFS: StepDef[] = [
  { id: "profile", title: "Restaurant profile", desc: "Phone, address, currency" },
  { id: "branch", title: "Add a branch", desc: "Skip if you only have one location", skippable: true },
  { id: "kitchen", title: "Set up a kitchen", desc: "Where orders will be routed" },
  { id: "menu_categories", title: "Menu categories", desc: "Group your dishes" },
  { id: "menu_items", title: "Menu items", desc: "Add at least one dish" },
  { id: "tables", title: "Add tables", desc: "Bulk-add seating" },
  { id: "staff", title: "Invite staff", desc: "Optional", skippable: true },
  { id: "payment", title: "Payment & tax", desc: "Optional — set tax rate", skippable: true },
  { id: "go_live", title: "Go live", desc: "Review and launch" },
];

interface OnboardingState {
  isOnboarded: boolean;
  completedAt: string | null;
  skippedSteps: string[];
  defaultMenuId: number;
  counts: { branches: number; kitchens: number; categories: number; items: number; tables: number; staff: number };
  steps: { id: StepId; completed: boolean; skipped: boolean; skippable: boolean }[];
}

export function useOnboardingState() {
  const { user } = useAuth();
  // Only owners and managers can read onboarding state — gate the request
  // to avoid systematic 403s for waiters/cashiers/super-admins on every page.
  const enabled = !!user && !user.isSuperAdmin && (user.role === "owner" || user.role === "manager");
  return useQuery({
    queryKey: ["onboarding-state"],
    queryFn: () => apiGet<OnboardingState>("/onboarding/state"),
    staleTime: 5000,
    enabled,
  });
}

export default function OnboardingPage() {
  const { user } = useAuth();
  const restaurantId = useRestaurantId();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: state, isLoading } = useOnboardingState();
  const [activeIdx, setActiveIdx] = useState(0);

  const skipMut = useMutation({
    mutationFn: (step: StepId) => apiPost<{ skippedSteps: string[] }>("/onboarding/skip", { step }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding-state"] }),
  });

  const completeMut = useMutation({
    mutationFn: () => apiPost<{ completedAt: string }>("/onboarding/complete"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      toast({ title: "You're live!", description: "Welcome to Khana Lagao." });
      navigate("/dashboard");
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Could not complete onboarding";
      toast({ title: "Hold on", description: msg, variant: "destructive" });
    },
  });

  const activeStep = STEP_DEFS[activeIdx];
  const stepStatus = useMemo(() => {
    const map = new Map<string, { completed: boolean; skipped: boolean }>();
    state?.steps.forEach(s => map.set(s.id, { completed: s.completed, skipped: s.skipped }));
    return map;
  }, [state]);

  if (!user) {
    navigate("/login");
    return null;
  }
  // Onboarding is owner/manager only — bounce other roles back to dashboard
  // so they don't sit on an indefinite loader (the state query is disabled
  // for them by design).
  if (user.isSuperAdmin || (user.role !== "owner" && user.role !== "manager")) {
    navigate("/dashboard");
    return null;
  }

  if (isLoading || !state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const goNext = () => setActiveIdx(i => Math.min(i + 1, STEP_DEFS.length - 1));
  const goPrev = () => setActiveIdx(i => Math.max(i - 1, 0));
  const s = state;

  function renderStep() {
    const onAdvance = () => {
      qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      goNext();
    };
    switch (activeStep.id) {
      case "profile": return <ProfileStep restaurantId={restaurantId} onDone={onAdvance} />;
      case "branch": return <BranchStep restaurantId={restaurantId} onDone={onAdvance} />;
      case "kitchen": return <KitchenStep restaurantId={restaurantId} onDone={onAdvance} />;
      case "menu_categories": return <CategoriesStep restaurantId={restaurantId} menuId={s.defaultMenuId} onDone={onAdvance} />;
      case "menu_items": return <ItemsStep restaurantId={restaurantId} onDone={onAdvance} />;
      case "tables": return <TablesStep restaurantId={restaurantId} onDone={onAdvance} />;
      case "staff": return <StaffStep restaurantId={restaurantId} onDone={onAdvance} />;
      case "payment": return <PaymentStep restaurantId={restaurantId} onDone={onAdvance} />;
      case "go_live":
        return (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold flex items-center gap-2"><Rocket className="w-5 h-5 text-primary" /> You're ready to launch</h3>
              <p className="text-sm text-muted-foreground">Review what you've set up and go live. You can keep editing everything from the dashboard.</p>
            </div>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: "Branches", value: s.counts.branches },
                { label: "Kitchens", value: s.counts.kitchens },
                { label: "Menu categories", value: s.counts.categories },
                { label: "Menu items", value: s.counts.items },
                { label: "Tables", value: s.counts.tables },
                { label: "Team members", value: s.counts.staff },
              ].map(s => (
                <li key={s.label} className="rounded-lg border border-border bg-card px-3 py-2 flex items-center justify-between">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="font-semibold">{s.value}</span>
                </li>
              ))}
            </ul>
            <Button size="lg" className="w-full" disabled={completeMut.isPending} onClick={() => completeMut.mutate()}>
              {completeMut.isPending ? "Going live…" : "Go live and open dashboard"}
            </Button>
          </div>
        );
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center"><Flame className="w-4 h-4 text-white" /></div>
            <span className="font-bold text-lg">Khana Lagao</span>
            <span className="text-xs text-muted-foreground border-l border-border pl-2.5 ml-1">Setup wizard</span>
          </div>
          <button onClick={() => navigate("/dashboard")} className="text-sm text-muted-foreground hover:text-foreground">Continue later →</button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 grid lg:grid-cols-[280px_1fr] gap-8">
        <aside>
          <div className="sticky top-6 space-y-4">
            <div>
              <h1 className="text-xl font-bold">Welcome, {user.name.split(" ")[0]}</h1>
              <p className="text-sm text-muted-foreground mt-1">Let's get your restaurant set up. Should take 5–10 minutes.</p>
            </div>
            <ol className="space-y-1">
              {STEP_DEFS.map((s, i) => {
                const status = stepStatus.get(s.id);
                const done = !!status?.completed;
                const skipped = !!status?.skipped;
                const active = i === activeIdx;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setActiveIdx(i)}
                      className={cn(
                        "w-full flex items-start gap-3 text-left rounded-lg px-3 py-2 transition-colors",
                        active ? "bg-primary/10 text-foreground" : "hover:bg-muted/40 text-foreground"
                      )}
                    >
                      <span className={cn(
                        "mt-0.5 w-5 h-5 rounded-full text-xs flex items-center justify-center font-semibold flex-shrink-0",
                        done ? "bg-emerald-500 text-white" :
                        skipped ? "bg-muted text-muted-foreground" :
                        active ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                      )}>
                        {done ? <Check className="w-3 h-3" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("text-sm font-medium block truncate", skipped && "line-through text-muted-foreground")}>{s.title}</span>
                        <span className="text-xs text-muted-foreground block">{skipped ? "Skipped" : s.desc}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>

        <main>
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="mb-6">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Step {activeIdx + 1} of {STEP_DEFS.length}</p>
                <p className="text-xs font-medium text-muted-foreground">
                  {Array.from(stepStatus.values()).filter(v => v.completed).length} of {STEP_DEFS.length} complete
                </p>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-4">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round((Array.from(stepStatus.values()).filter(v => v.completed).length / STEP_DEFS.length) * 100)}%` }}
                />
              </div>
              <h2 className="text-2xl font-bold mt-1">{activeStep.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{activeStep.desc}</p>
            </div>
            {renderStep()}
            <div className="flex items-center justify-between mt-8 pt-5 border-t border-border">
              <Button variant="ghost" onClick={goPrev} disabled={activeIdx === 0}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <div className="flex items-center gap-2">
                {activeStep.skippable && !stepStatus.get(activeStep.id)?.completed && (
                  <Button
                    variant="ghost"
                    onClick={() => skipMut.mutate(activeStep.id, { onSuccess: () => goNext() })}
                    disabled={skipMut.isPending}
                  >
                    <SkipForward className="w-4 h-4 mr-1" /> Skip
                  </Button>
                )}
                {activeIdx < STEP_DEFS.length - 1 && (() => {
                  const status = stepStatus.get(activeStep.id);
                  const isComplete = !!status?.completed;
                  const isSkipped = !!status?.skipped;
                  const canAdvance = isComplete || isSkipped || activeStep.skippable === true;
                  // For optional steps, treat "Next" as an implicit Skip so
                  // checklist semantics stay consistent with the user's intent.
                  const handleNext = () => {
                    if (!isComplete && !isSkipped && activeStep.skippable === true) {
                      skipMut.mutate(activeStep.id, { onSuccess: () => goNext() });
                    } else {
                      goNext();
                    }
                  };
                  return (
                    <Button
                      variant="outline"
                      onClick={handleNext}
                      disabled={!canAdvance || skipMut.isPending}
                      title={!canAdvance ? "Finish this step to continue" : undefined}
                    >
                      Next <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  );
                })()}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function StepShell({ children }: { children: ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

function ProfileStep({ restaurantId, onDone }: { restaurantId: number; onDone: () => void }) {
  const { data: restaurant } = useQuery<{ name: string; phone: string | null; address: string | null; city: string | null; currency: string | null; description: string | null; timezone: string | null; logoUrl: string | null }>({
    queryKey: ["restaurant", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}`),
  });
  const [form, setForm] = useState({ name: "", phone: "", address: "", city: "", description: "", currency: "INR", timezone: "Asia/Kolkata", logoUrl: "" });
  const initialised = useState(false);
  if (restaurant && !initialised[0]) {
    setForm({
      name: restaurant.name ?? "",
      phone: restaurant.phone ?? "",
      address: restaurant.address ?? "",
      city: restaurant.city ?? "",
      description: restaurant.description ?? "",
      currency: restaurant.currency ?? "INR",
      timezone: restaurant.timezone ?? "Asia/Kolkata",
      logoUrl: restaurant.logoUrl ?? "",
    });
    initialised[1](true);
  }
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: (data: typeof form) => apiPatch(`/restaurants/${restaurantId}`, data),
    onSuccess: () => { toast({ title: "Profile saved" }); onDone(); },
    onError: (e) => toast({ title: "Save failed", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });
  return (
    <StepShell>
      <Field label="Restaurant name" required>
        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Khana Lagao Cafe" />
      </Field>
      <Field label="Phone number" required>
        <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
      </Field>
      <Field label="Street address" required>
        <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="MG Road, near City Mall" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City" required>
          <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Bengaluru" />
        </Field>
        <Field label="Currency">
          <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="INR">INR (₹)</option>
            <option value="USD">USD ($)</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Timezone">
          <select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
            <option value="Asia/Dubai">Asia/Dubai</option>
            <option value="Asia/Singapore">Asia/Singapore</option>
            <option value="Europe/London">Europe/London</option>
            <option value="America/New_York">America/New_York</option>
          </select>
        </Field>
        <Field label="Logo URL (optional)">
          <Input value={form.logoUrl} onChange={e => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…/logo.png" />
        </Field>
      </div>
      <Field label="Short description (optional)">
        <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Family-style North Indian, dine-in & takeaway." rows={2} />
      </Field>
      <Button onClick={() => mut.mutate(form)} disabled={mut.isPending || !form.name || !form.phone || !form.address || !form.city}>
        {mut.isPending ? "Saving…" : "Save profile"}
      </Button>
    </StepShell>
  );
}

function BranchStep({ restaurantId, onDone }: { restaurantId: number; onDone: () => void }) {
  const { data: branches = [] } = useQuery<{ id: number; name: string; address: string | null }[]>({
    queryKey: ["branches-list", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/branches`),
  });
  const [form, setForm] = useState({ name: "", address: "", phone: "" });
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (data: typeof form) => apiPost(`/restaurants/${restaurantId}/branches`, data),
    onSuccess: () => {
      setForm({ name: "", address: "", phone: "" });
      qc.invalidateQueries({ queryKey: ["branches-list", restaurantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      toast({ title: "Branch added" });
      onDone();
    },
    onError: (e) => {
      const msg = e instanceof ApiError && e.status === 402
        ? `${e.message} You can upgrade in Settings → Subscription.`
        : e instanceof Error ? e.message : "Save failed";
      toast({ title: "Could not add branch", description: msg, variant: "destructive" });
    },
  });
  return (
    <StepShell>
      <p className="text-sm text-muted-foreground">
        We've already created your <strong>Main</strong> branch. Add another location only if you run multiple outlets — otherwise just hit <em>Skip</em>.
      </p>
      {branches.length > 0 && (
        <div className="space-y-1.5">
          {branches.map(b => (
            <div key={b.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="font-medium">{b.name}</span>
              {b.address && <span className="text-muted-foreground truncate">— {b.address}</span>}
            </div>
          ))}
        </div>
      )}
      <Field label="Branch name" required>
        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Indiranagar branch" />
      </Field>
      <Field label="Address">
        <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="100 Ft Road" />
      </Field>
      <Field label="Phone">
        <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 …" />
      </Field>
      <Button onClick={() => mut.mutate(form)} disabled={mut.isPending || !form.name.trim()}>
        {mut.isPending ? "Adding…" : "Add branch"}
      </Button>
    </StepShell>
  );
}

function KitchenStep({ restaurantId, onDone }: { restaurantId: number; onDone: () => void }) {
  const { data: kitchens = [] } = useQuery<{ id: number; name: string; isDefault: boolean }[]>({
    queryKey: ["kitchens", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/kitchens`),
  });
  const [name, setName] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (n: string) => apiPost(`/restaurants/${restaurantId}/kitchens`, { name: n }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["kitchens", restaurantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      toast({ title: "Kitchen added" });
    },
    onError: (e) => toast({ title: "Save failed", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });
  return (
    <StepShell>
      <p className="text-sm text-muted-foreground">Kitchens are where orders are routed for prep. Most places start with one (e.g. "Main Kitchen"). You can add a "Bar" or "Tandoor" later.</p>
      <div className="space-y-1.5">
        {kitchens.map(k => (
          <div key={k.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <Check className="w-4 h-4 text-emerald-500" />
            <span className="font-medium">{k.name}</span>
            {k.isDefault && <span className="text-xs text-muted-foreground">(default)</span>}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main Kitchen" />
        <Button onClick={() => mut.mutate(name)} disabled={mut.isPending || !name.trim()}>
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>
      {kitchens.length > 0 && (
        <Button variant="outline" onClick={onDone}>Continue →</Button>
      )}
    </StepShell>
  );
}

function CategoriesStep({ restaurantId, menuId, onDone }: { restaurantId: number; menuId: number; onDone: () => void }) {
  const { data: cats = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["categories", restaurantId, menuId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/categories?menuId=${menuId}`),
  });
  const [name, setName] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (n: string) => apiPost(`/restaurants/${restaurantId}/categories`, { menuId, name: n }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["categories", restaurantId, menuId] });
      qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      toast({ title: "Category added" });
    },
    onError: (e) => toast({ title: "Save failed", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });
  return (
    <StepShell>
      <p className="text-sm text-muted-foreground">Group your menu — e.g. "Starters", "Main course", "Beverages". Add at least one to continue.</p>
      <div className="space-y-1.5">
        {cats.map(c => (
          <div key={c.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <Check className="w-4 h-4 text-emerald-500" />
            <span className="font-medium">{c.name}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Starters" />
        <Button onClick={() => mut.mutate(name)} disabled={mut.isPending || !name.trim()}>
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>
      {cats.length > 0 && <Button variant="outline" onClick={onDone}>Continue →</Button>}
    </StepShell>
  );
}

function ItemsStep({ restaurantId, onDone }: { restaurantId: number; onDone: () => void }) {
  const { data: cats = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["all-categories", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/categories`),
  });
  const { data: kitchens = [] } = useQuery<{ id: number; name: string; isDefault?: boolean }[]>({
    queryKey: ["kitchens", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/kitchens`),
  });
  const { data: items = [] } = useQuery<{ id: number; name: string; price: string }[]>({
    queryKey: ["all-items", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/items`),
  });
  const [form, setForm] = useState({ categoryId: "", kitchenId: "", name: "", price: "", isVeg: true });
  const { toast } = useToast();
  const qc = useQueryClient();
  // Default kitchen selection once kitchens load
  if (kitchens.length > 0 && !form.kitchenId) {
    const def = kitchens.find(k => k.isDefault) ?? kitchens[0];
    setForm(f => ({ ...f, kitchenId: String(def.id) }));
  }
  const mut = useMutation({
    mutationFn: (data: typeof form) => apiPost(`/restaurants/${restaurantId}/items`, {
      categoryId: Number(data.categoryId),
      kitchenId: data.kitchenId ? Number(data.kitchenId) : null,
      name: data.name,
      price: data.price,
      isVeg: data.isVeg,
    }),
    onSuccess: () => {
      setForm({ ...form, name: "", price: "" });
      qc.invalidateQueries({ queryKey: ["all-items", restaurantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      toast({ title: "Menu item added" });
    },
    onError: (e) => {
      const msg = e instanceof ApiError && e.status === 402
        ? `${e.message} You can upgrade in Settings → Subscription.`
        : e instanceof Error ? e.message : "Save failed";
      toast({ title: "Could not add item", description: msg, variant: "destructive" });
    },
  });

  if (cats.length === 0) {
    return <p className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3">Add at least one category in the previous step before adding menu items.</p>;
  }
  return (
    <StepShell>
      <p className="text-sm text-muted-foreground">Add a few signature items to get started. You can always add more from the Menu page.</p>
      {items.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {items.map(it => (
            <div key={it.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /><span className="font-medium">{it.name}</span></div>
              <span className="text-muted-foreground">₹{it.price}</span>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Category">
          <select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Select…</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Kitchen">
          <select value={form.kitchenId} onChange={e => setForm({ ...form, kitchenId: e.target.value })}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" disabled={kitchens.length === 0}>
            {kitchens.length === 0 && <option value="">Add a kitchen first</option>}
            {kitchens.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={form.isVeg ? "veg" : "nonveg"} onChange={e => setForm({ ...form, isVeg: e.target.value === "veg" })}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="veg">Veg</option>
            <option value="nonveg">Non-veg</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
        <Field label="Item name">
          <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Paneer Tikka" />
        </Field>
        <Field label="Price (₹)">
          <Input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="280" />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => mut.mutate(form)} disabled={mut.isPending || !form.categoryId || !form.kitchenId || !form.name.trim() || !form.price}>
          <Plus className="w-4 h-4 mr-1" /> Add item
        </Button>
        {items.length > 0 && <Button variant="outline" onClick={onDone}>Continue →</Button>}
      </div>
    </StepShell>
  );
}

function TablesStep({ restaurantId, onDone }: { restaurantId: number; onDone: () => void }) {
  const { data: tables = [] } = useQuery<{ id: number; tableNumber: string; capacity: number }[]>({
    queryKey: ["onboarding-tables", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/tables`),
  });
  const [bulk, setBulk] = useState({ count: "5", prefix: "T", capacity: "4" });
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async () => {
      const count = Math.max(1, Math.min(50, Number(bulk.count) || 0));
      const start = tables.length + 1;
      const created: unknown[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const t = await apiPost(`/restaurants/${restaurantId}/tables`, {
            tableNumber: `${bulk.prefix}${start + i}`,
            capacity: Number(bulk.capacity) || 4,
          });
          created.push(t);
        } catch (e) {
          if (e instanceof ApiError && e.status === 402) {
            throw new Error(`Added ${created.length}. ${e.message}`);
          }
          throw e;
        }
      }
      return created;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["onboarding-tables", restaurantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      toast({ title: `Added ${(created as unknown[]).length} tables` });
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ["onboarding-tables", restaurantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      toast({ title: "Add stopped", description: e instanceof Error ? e.message : "", variant: "destructive" });
    },
  });
  return (
    <StepShell>
      <p className="text-sm text-muted-foreground">Bulk-add tables with auto-numbered names. Edit, rename, or assign sections later from the Tables page.</p>
      {tables.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {tables.map(t => (
            <span key={t.id} className="inline-flex items-center gap-1 text-xs rounded-md bg-muted/60 px-2 py-1">
              <Check className="w-3 h-3 text-emerald-500" />{t.tableNumber} · {t.capacity} seats
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="How many">
          <Input type="number" min={1} max={50} value={bulk.count} onChange={e => setBulk({ ...bulk, count: e.target.value })} />
        </Field>
        <Field label="Name prefix">
          <Input value={bulk.prefix} onChange={e => setBulk({ ...bulk, prefix: e.target.value })} />
        </Field>
        <Field label="Seats each">
          <Input type="number" min={1} value={bulk.capacity} onChange={e => setBulk({ ...bulk, capacity: e.target.value })} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? "Adding…" : `Add ${bulk.count || 0} tables`}
        </Button>
        {tables.length > 0 && <Button variant="outline" onClick={onDone}>Continue →</Button>}
      </div>
    </StepShell>
  );
}

function StaffStep({ restaurantId, onDone: _onDone }: { restaurantId: number; onDone: () => void }) {
  const { data: staff = [] } = useQuery<{ id: number; name: string; role: string }[]>({
    queryKey: ["onboarding-staff", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/staff`),
  });
  const [form, setForm] = useState({ name: "", email: "", role: "waiter", password: "" });
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    // Staff are user accounts — POST /users with this restaurant scope.
    mutationFn: (data: typeof form) => apiPost(`/users`, { ...data, restaurantId }),
    onSuccess: () => {
      setForm({ name: "", email: "", role: "waiter", password: "" });
      qc.invalidateQueries({ queryKey: ["onboarding-staff", restaurantId] });
      qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      toast({ title: "Team member added" });
    },
    onError: (e) => {
      const msg = e instanceof ApiError && e.status === 402
        ? `${e.message} You can upgrade in Settings → Subscription.`
        : e instanceof Error ? e.message : "Save failed";
      toast({ title: "Could not add", description: msg, variant: "destructive" });
    },
  });
  return (
    <StepShell>
      <p className="text-sm text-muted-foreground">Invite waiters, kitchen staff, or managers. They'll get a login to use the POS, KDS or back office. Optional — you can do this later.</p>
      {staff.length > 1 && (
        <div className="space-y-1.5">
          {staff.map(s => (
            <div key={s.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-muted-foreground capitalize">{s.role}</span>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ramesh Kumar" /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="ramesh@example.com" /></Field>
        <Field label="Role">
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="waiter">Waiter</option>
            <option value="kitchen">Kitchen</option>
            <option value="manager">Manager</option>
          </select>
        </Field>
        <Field label="Temporary password"><Input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 6 chars" /></Field>
      </div>
      <Button onClick={() => mut.mutate(form)} disabled={mut.isPending || !form.name.trim() || !form.email.trim() || form.password.length < 6}>
        <Plus className="w-4 h-4 mr-1" /> Add team member
      </Button>
    </StepShell>
  );
}

const PAYMENT_METHODS = [
  { id: "cash", label: "Cash" },
  { id: "upi", label: "UPI" },
  { id: "card", label: "Card" },
];

function PaymentStep({ restaurantId, onDone }: { restaurantId: number; onDone: () => void }) {
  const { data: restaurant } = useQuery<{ taxRate: string | null; serviceCharge: string | null; acceptedPaymentMethods: string[] | null }>({
    queryKey: ["restaurant", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}`),
  });
  const [form, setForm] = useState({ taxRate: "5", serviceCharge: "0", methods: ["cash", "upi", "card"] });
  const initialised = useState(false);
  if (restaurant && !initialised[0]) {
    setForm({
      taxRate: restaurant.taxRate ?? "5",
      serviceCharge: restaurant.serviceCharge ?? "0",
      methods: restaurant.acceptedPaymentMethods ?? ["cash", "upi", "card"],
    });
    initialised[1](true);
  }
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: (data: typeof form) => apiPatch(`/restaurants/${restaurantId}`, {
      taxRate: data.taxRate,
      serviceCharge: data.serviceCharge,
      acceptedPaymentMethods: data.methods,
    }),
    onSuccess: () => { toast({ title: "Payment & tax saved" }); onDone(); },
    onError: (e) => toast({ title: "Save failed", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });
  const toggleMethod = (id: string) =>
    setForm(f => ({ ...f, methods: f.methods.includes(id) ? f.methods.filter(m => m !== id) : [...f.methods, id] }));
  return (
    <StepShell>
      <p className="text-sm text-muted-foreground">Pick the tenders you accept at the bill, set the tax rate (e.g. GST), and any service charge.</p>
      <Field label="Accepted payment methods">
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map(m => {
            const on = form.methods.includes(m.id);
            return (
              <button key={m.id} type="button" onClick={() => toggleMethod(m.id)}
                className={cn(
                  "px-3 py-1.5 rounded-md border text-sm font-medium transition-colors",
                  on ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input text-foreground hover:bg-muted/40"
                )}>
                {on && <Check className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />}
                {m.label}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tax rate (%)">
          <Input type="number" step="0.01" value={form.taxRate} onChange={e => setForm({ ...form, taxRate: e.target.value })} />
        </Field>
        <Field label="Service charge (%)">
          <Input type="number" step="0.01" value={form.serviceCharge} onChange={e => setForm({ ...form, serviceCharge: e.target.value })} />
        </Field>
      </div>
      <Button onClick={() => mut.mutate(form)} disabled={mut.isPending || form.methods.length === 0}>
        {mut.isPending ? "Saving…" : "Save and continue"}
      </Button>
    </StepShell>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      {children}
    </div>
  );
}
