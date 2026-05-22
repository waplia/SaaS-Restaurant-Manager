import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Flame, ChevronRight, ChevronLeft, Loader2, Plus, Trash2, Check, Sparkles, Rocket,
  Store, Utensils, MapPin, FileUp, Star, CreditCard, Receipt,
  Building2, ChefHat, Grid3x3, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadField } from "@/components/ImageUploadField";
import { PhoneInput } from "@/components/PhoneInput";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Status = "idle" | "running" | "done" | "failed";

interface WizardOutlet { name: string; city?: string; address?: string; phone?: string }
interface WizardAnswers {
  restaurantType?: string;
  cuisines?: string[];
  outlets?: WizardOutlet[];
  menuImportId?: number | null;
  googleReviewLink?: string | null;
  paymentMethods?: string[];
  paymentGateway?: string | null;
  taxCountry?: string;
  taxRate?: number;
  serviceCharge?: number;
}
interface WizardSummary {
  categoriesCreated: number;
  branchesCreated: number;
  itemsImported: number;
  tablesCount: number;
  kitchensCount: number;
  staffCount: number;
  taxApplied: number | null;
  paymentMethods: string[];
  qrMenuStyle: string | null;
  pinnedReports: string[];
  googleReviewLink: string | null;
  menuImportId: number | null;
  menuImportStatus: string | null;
}
interface WizardState {
  answers: WizardAnswers;
  step: number;
  status: Status;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  summary: WizardSummary | null;
  onboardingCompletedAt?: string | null;
}

const TYPES = [
  { id: "fine_dine", label: "Fine Dining" },
  { id: "casual", label: "Casual Dining" },
  { id: "qsr", label: "QSR / Fast Food" },
  { id: "cafe", label: "Café / Bakery" },
  { id: "cloud", label: "Cloud Kitchen" },
  { id: "bar", label: "Bar / Pub" },
  { id: "food_truck", label: "Food Truck" },
  { id: "other", label: "Other" },
];

const CUISINES = [
  "Indian", "North Indian", "South Indian", "Chinese", "Italian", "Continental",
  "Mexican", "Thai", "Japanese", "Mughlai", "Punjabi", "Bengali", "Pizza",
  "Burgers", "Desserts", "Beverages", "Healthy", "Street Food",
];

const PAYMENT_METHODS = ["cash", "upi", "card", "wallet", "online"];
const COUNTRIES = [
  { id: "IN", label: "India", tax: 5 },
  { id: "AE", label: "UAE", tax: 5 },
  { id: "US", label: "United States", tax: 8 },
  { id: "UK", label: "United Kingdom", tax: 20 },
  { id: "OTHER", label: "Other", tax: 0 },
];

const STEPS = [
  { id: "profile", title: "Restaurant profile", icon: Building2 },
  { id: "type", title: "Restaurant type", icon: Store },
  { id: "cuisines", title: "Cuisines", icon: Utensils },
  { id: "outlets", title: "Outlets", icon: MapPin },
  { id: "kitchen", title: "Kitchens", icon: ChefHat },
  { id: "menu", title: "Menu upload", icon: FileUp },
  { id: "tables", title: "Tables", icon: Grid3x3 },
  { id: "staff", title: "Invite staff", icon: Users },
  { id: "review", title: "Google review link", icon: Star },
  { id: "payment", title: "Payment", icon: CreditCard },
  { id: "tax", title: "Tax", icon: Receipt },
] as const;

export default function SetupWizardPage() {
  const { user } = useAuth();
  const restaurantId = useRestaurantId();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["setup-wizard", restaurantId],
    queryFn: () => apiGet<WizardState>(`/restaurants/${restaurantId}/setup-wizard`),
    enabled: !!restaurantId,
    refetchInterval: (q) => {
      const s = (q.state.data as WizardState | undefined)?.status;
      return s === "running" ? 1500 : false;
    },
  });

  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<WizardAnswers>({});
  const [generating, setGenerating] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  // Hydrate from server. Prefer the saved step *id* over the numeric index
  // because the STEPS array can change between deploys (we add new steps);
  // a saved numeric index would otherwise resume on the wrong screen.
  useEffect(() => {
    if (!data) return;
    setAnswers(data.answers ?? {});
    if (data.status === "done" && data.summary) setShowSummary(true);
    if (stepIdx === 0 && !showSummary) {
      const savedId = (data as unknown as { stepId?: string }).stepId;
      const byId = savedId ? STEPS.findIndex((s) => s.id === savedId) : -1;
      if (byId >= 0) {
        setStepIdx(byId);
      } else if (typeof data.step === "number") {
        setStepIdx(Math.min(Math.max(0, data.step), STEPS.length - 1));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.answers, data?.status]);

  // Already done? Send to dashboard.
  useEffect(() => {
    if (data?.onboardingCompletedAt) navigate("/dashboard");
  }, [data?.onboardingCompletedAt, navigate]);

  const saveMut = useMutation({
    mutationFn: (payload: { answers: Partial<WizardAnswers>; step?: number; stepId?: string }) =>
      apiPatch<WizardState>(`/restaurants/${restaurantId}/setup-wizard`, payload),
    onSuccess: (s) => qc.setQueryData(["setup-wizard", restaurantId], s),
  });

  // Invalidate every query the wizard may have touched so the dashboard +
  // sidebar counts + tables / kitchens / staff / menu / settings pages all
  // re-fetch from the server on first render after the wizard, instead of
  // serving the stale "empty" responses they cached before the wizard ran.
  async function invalidateWizardCaches() {
    const keys: (readonly unknown[])[] = [
      ["restaurant", restaurantId],
      ["restaurant"],
      ["branches-list", restaurantId],
      ["branches", restaurantId],
      ["branches"],
      ["kitchens", restaurantId],
      ["kitchens"],
      ["tables", restaurantId],
      ["tables"],
      ["wizard-tables", restaurantId],
      ["staff", restaurantId],
      ["staff"],
      ["wizard-staff", restaurantId],
      ["menus", restaurantId],
      ["menus"],
      ["categories"],
      ["items"],
      ["menu"],
      ["settings"],
      ["dashboard"],
      ["onboarding-state"],
      ["setup-wizard", restaurantId],
    ];
    await Promise.all(keys.map(queryKey => qc.invalidateQueries({ queryKey })));
  }

  const generateMut = useMutation({
    mutationFn: async () => {
      const s = await apiPost<WizardState>(`/restaurants/${restaurantId}/setup-wizard/generate`, { answers });
      await apiPost(`/restaurants/${restaurantId}/setup-wizard/complete`, {});
      return s;
    },
    onSuccess: async (s) => {
      qc.setQueryData(["setup-wizard", restaurantId], s);
      // Wait for invalidation to fire before we navigate away — otherwise
      // the dashboard mounts against the still-cached "empty" responses.
      await invalidateWizardCaches();
      setGenerating(false);
      toast({ title: "You're live!", description: "Khana AI has set up your restaurant." });
      navigate("/dashboard");
    },
    onError: (err: unknown) => {
      setGenerating(false);
      const msg = err instanceof Error ? err.message : "Generation failed";
      toast({ title: "Setup failed", description: msg, variant: "destructive" });
    },
  });

  const completeMut = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/setup-wizard/complete`, {}),
    onSuccess: async () => {
      await invalidateWizardCaches();
      toast({ title: "You're live!", description: "Welcome to KhanaLagao." });
      navigate("/dashboard");
    },
  });

  function patch(p: Partial<WizardAnswers>) {
    setAnswers((prev) => {
      const next = { ...prev, ...p };
      saveMut.mutate({ answers: p, step: stepIdx, stepId: STEPS[stepIdx]?.id });
      return next;
    });
  }

  function next() {
    const newStep = Math.min(stepIdx + 1, STEPS.length - 1);
    setStepIdx(newStep);
    saveMut.mutate({ answers: {}, step: newStep, stepId: STEPS[newStep]?.id });
  }
  function prev() { setStepIdx((s) => Math.max(0, s - 1)); }

  if (!user || isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (showSummary && data?.summary) return <SummaryView summary={data.summary} onGoLive={() => completeMut.mutate()} loading={completeMut.isPending} navigate={navigate} />;

  if (generating || data?.status === "running") return <GeneratingView />;

  const step = STEPS[stepIdx];
  const Icon = step.icon;

  // Spec: only restaurant type and tax are mandatory. Every other step can
  // be skipped — Khana AI fills in sensible defaults during generation.
  function canProceed(): boolean {
    switch (step.id) {
      case "type": return !!answers.restaurantType;
      case "tax": return typeof answers.taxRate === "number" && answers.taxRate >= 0;
      default: return true;
    }
  }
  function isOptional(stepId: typeof STEPS[number]["id"]): boolean {
    return stepId !== "type" && stepId !== "tax";
  }

  const isLast = stepIdx === STEPS.length - 1;
  const canGenerate = !!answers.restaurantType && typeof answers.taxRate === "number" && answers.taxRate >= 0;

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="border-b bg-background">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <Flame className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold">KhanaLagao</div>
            <div className="text-xs text-muted-foreground">AI Setup Wizard</div>
          </div>
          <div className="ml-auto text-sm text-muted-foreground">Step {stepIdx + 1} of {STEPS.length}</div>
        </div>
        <div className="max-w-4xl mx-auto px-4 pb-3">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-card border rounded-2xl p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">{step.title}</h2>
              <p className="text-sm text-muted-foreground">{stepDescription(step.id)}</p>
            </div>
          </div>

          <StepBody stepId={step.id} answers={answers} patch={patch} />

          <div className="flex items-center justify-between pt-4 border-t">
            <Button variant="ghost" onClick={prev} disabled={stepIdx === 0}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div className="flex items-center gap-2">
              {isOptional(step.id) && (
                <Button variant="ghost" onClick={next}>Skip</Button>
              )}
              {isLast ? (
                <Button onClick={() => { setGenerating(true); generateMut.mutate(); }} disabled={!canGenerate || generateMut.isPending}>
                  <Sparkles className="w-4 h-4 mr-2" /> Generate setup with Khana AI
                </Button>
              ) : (
                <Button onClick={next} disabled={!canProceed()}>
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </div>
        <p className="text-xs text-center text-muted-foreground mt-4">
          Generating your setup is free — you can edit everything later from Settings.
        </p>
      </div>
    </div>
  );
}

function stepDescription(id: typeof STEPS[number]["id"]): string {
  switch (id) {
    case "profile": return "Your restaurant's name, phone, address and currency.";
    case "type": return "Pick the option that best describes your restaurant.";
    case "cuisines": return "Select all the cuisines you serve.";
    case "outlets": return "List your outlets — you can add more later.";
    case "kitchen": return "Where orders will be routed for prep — most places start with one.";
    case "menu": return "Optional. Upload your menu now to auto-import dishes.";
    case "tables": return "Bulk-add tables with auto-numbered names. Edit later from Tables.";
    case "staff": return "Optional. Invite waiters, kitchen staff or managers.";
    case "review": return "Optional. Paste your Google review link for happy guests.";
    case "payment": return "Which payment methods will you accept?";
    case "tax": return "We'll set this as the default tax rate on bills.";
  }
}

function MenuUploadStep({ answers, patch }: { answers: WizardAnswers; patch: (p: Partial<WizardAnswers>) => void }) {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const importId = answers.menuImportId ?? null;
  const { data: importStatus } = useQuery({
    queryKey: ["setup-wizard-import", restaurantId, importId],
    queryFn: () => apiGet<{ id: number; status: string; itemCount?: number; totalRows?: number; errorMessage?: string | null }>(`/restaurants/${restaurantId}/ai/menu-import/imports/${importId}`),
    enabled: !!restaurantId && !!importId,
    refetchInterval: (q) => {
      const s = (q.state.data as { status?: string } | undefined)?.status;
      return s && (s === "ready" || s === "failed" || s === "saved") ? false : 2000;
    },
  });

  function friendlyError(raw: string | null | undefined): string {
    if (!raw) return "Khana AI couldn't read this menu. Please try again or upload a different file.";
    try {
      const parsed = JSON.parse(raw);
      const m = parsed?.error?.message ?? parsed?.message;
      if (typeof m === "string") {
        if (/high demand|UNAVAILABLE|503|overloaded/i.test(m)) return "Our AI provider is busy right now. Please try again in a minute.";
        return m;
      }
    } catch { /* not JSON */ }
    if (/high demand|UNAVAILABLE|503|overloaded/i.test(raw)) return "Our AI provider is busy right now. Please try again in a minute.";
    return raw.length > 220 ? raw.slice(0, 220) + "…" : raw;
  }

  async function start(body: { source: string; text?: string; url?: string; objectPath?: string; fileName?: string }) {
    setSubmitting(true);
    try {
      const res = await apiPost<{ id: number; status: string }>(`/restaurants/${restaurantId}/ai/menu-import/start`, body);
      patch({ menuImportId: res.id });
      toast({ title: "Menu import started", description: "Khana AI is reading your menu in the background." });
    } catch (e) {
      toast({ title: "Could not start import", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitting(true);
    try {
      const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
        `/restaurants/${restaurantId}/storage/uploads/request-url`,
        { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
      );
      const put = await fetch(presign.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!put.ok) throw new Error("Upload failed");
      await apiPost(`/restaurants/${restaurantId}/storage/uploads/finalize`, { objectPath: presign.objectPath });
      const objectPath = presign.objectPath;
      const ext = file.name.toLowerCase().split(".").pop() ?? "";
      const source = ext === "pdf" ? "pdf" : ext === "csv" ? "csv" : (ext === "xlsx" || ext === "xls") ? "excel" : "image";
      await start({ source, objectPath, fileName: file.name });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setSubmitting(false);
      e.target.value = "";
    }
  }

  if (importId) {
    const s = importStatus?.status ?? "pending";
    const ready = s === "ready" || s === "saved";
    const failed = s === "failed";
    const itemsDetected = importStatus?.itemCount ?? importStatus?.totalRows ?? null;
    const statusLabel: Record<string, string> = {
      pending: "Queued…",
      processing: "Khana AI is reading your menu line by line…",
      ready: "Ready",
      saved: "Saved",
      partially_saved: "Partially saved",
      failed: "Import failed",
    };
    return (
      <div className="space-y-3">
        <div className={cn("border rounded-xl p-4 flex items-center gap-3", failed && "border-destructive/40 bg-destructive/5")}>
          {failed ? (
            <span className="w-5 h-5 rounded-full bg-destructive/15 text-destructive grid place-items-center text-xs font-bold">!</span>
          ) : ready ? (
            <Check className="w-5 h-5 text-green-600" />
          ) : (
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Menu import #{importId}</div>
            <div className={cn("text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
              {failed ? friendlyError(importStatus?.errorMessage) : statusLabel[s] ?? s}
              {!failed && itemsDetected != null && itemsDetected > 0 && ` · ${itemsDetected} items detected`}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => patch({ menuImportId: null })}>
            {failed ? "Try again" : "Replace"}
          </Button>
        </div>
        {!failed && (
          <p className="text-xs text-muted-foreground">When you click "Generate", Khana AI will save these items into your menu.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border-2 border-dashed rounded-xl p-6 text-center space-y-2">
        <FileUp className="w-8 h-8 text-muted-foreground mx-auto" />
        <div className="text-sm">Upload a menu PDF, image, CSV or Excel</div>
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls" className="hidden" id="wizard-menu-file" onChange={onFile} />
        <label htmlFor="wizard-menu-file">
          <Button asChild variant="outline" disabled={submitting}>
            <span className="cursor-pointer">{submitting ? "Uploading…" : "Choose file"}</span>
          </Button>
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2 border rounded-xl p-3">
          <Label className="text-xs">Or paste a menu URL</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          <Button size="sm" variant="secondary" disabled={!url || submitting} onClick={() => start({ source: "url", url })}>Import URL</Button>
        </div>
        <div className="space-y-2 border rounded-xl p-3">
          <Label className="text-xs">Or paste menu text</Label>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Margherita Pizza – ₹299…" />
          <Button size="sm" variant="secondary" disabled={text.trim().length < 5 || submitting} onClick={() => start({ source: "text", text })}>Import text</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Optional. Skip this step if you'd rather build your menu by hand later.</p>
    </div>
  );
}

function StepBody({ stepId, answers, patch }: { stepId: typeof STEPS[number]["id"]; answers: WizardAnswers; patch: (p: Partial<WizardAnswers>) => void }) {
  if (stepId === "profile") {
    return <ProfileStep />;
  }
  if (stepId === "kitchen") {
    return <KitchenStep />;
  }
  if (stepId === "tables") {
    return <TablesStep />;
  }
  if (stepId === "staff") {
    return <StaffStep />;
  }
  if (stepId === "type") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => patch({ restaurantType: t.id })}
            className={cn("border rounded-xl p-4 text-left hover:border-primary transition", answers.restaurantType === t.id && "border-primary bg-primary/5 ring-2 ring-primary/20")}
          >
            <div className="font-medium">{t.label}</div>
          </button>
        ))}
      </div>
    );
  }
  if (stepId === "cuisines") {
    const sel = new Set(answers.cuisines ?? []);
    const toggle = (c: string) => {
      const next = sel.has(c) ? [...sel].filter((x) => x !== c) : [...sel, c];
      patch({ cuisines: next });
    };
    return (
      <div className="flex flex-wrap gap-2">
        {CUISINES.map((c) => (
          <button
            key={c}
            onClick={() => toggle(c)}
            className={cn("px-3 py-2 rounded-full border text-sm hover:border-primary transition", sel.has(c) && "bg-primary text-primary-foreground border-primary")}
          >
            {c}
          </button>
        ))}
      </div>
    );
  }
  if (stepId === "outlets") {
    const outlets = answers.outlets ?? [{ name: "" }];
    const update = (i: number, field: keyof WizardOutlet, v: string) => {
      const next = outlets.map((o, idx) => (idx === i ? { ...o, [field]: v } : o));
      patch({ outlets: next });
    };
    const add = () => patch({ outlets: [...outlets, { name: "" }] });
    const remove = (i: number) => patch({ outlets: outlets.filter((_, idx) => idx !== i) });
    return (
      <div className="space-y-3">
        {outlets.map((o, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end border rounded-xl p-3">
            <div className="sm:col-span-4 space-y-1">
              <Label className="text-xs">Outlet name {i === 0 && <span className="text-muted-foreground">(main)</span>}</Label>
              <Input value={o.name ?? ""} onChange={(e) => update(i, "name", e.target.value)} placeholder="Spice Garden — Indiranagar" />
            </div>
            <div className="sm:col-span-3 space-y-1">
              <Label className="text-xs">City</Label>
              <Input value={o.city ?? ""} onChange={(e) => update(i, "city", e.target.value)} placeholder="Bengaluru" />
            </div>
            <div className="sm:col-span-4 space-y-1">
              <Label className="text-xs">Address</Label>
              <Input value={o.address ?? ""} onChange={(e) => update(i, "address", e.target.value)} placeholder="100ft Rd" />
            </div>
            <div className="sm:col-span-1 flex justify-end">
              {outlets.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => remove(i)}><Trash2 className="w-4 h-4" /></Button>
              )}
            </div>
          </div>
        ))}
        <Button variant="outline" onClick={add}><Plus className="w-4 h-4 mr-2" /> Add another outlet</Button>
      </div>
    );
  }
  if (stepId === "menu") {
    return <MenuUploadStep answers={answers} patch={patch} />;
  }
  if (stepId === "review") {
    return (
      <div className="space-y-2">
        <Label htmlFor="grl">Google review link</Label>
        <Input id="grl" type="url" placeholder="https://g.page/r/.../review" value={answers.googleReviewLink ?? ""} onChange={(e) => patch({ googleReviewLink: e.target.value })} />
        <p className="text-xs text-muted-foreground">Find this in your Google Business profile under "Get more reviews".</p>
      </div>
    );
  }
  if (stepId === "payment") {
    const sel = new Set(answers.paymentMethods ?? ["cash", "upi", "card"]);
    const toggle = (m: string) => {
      const next = sel.has(m) ? [...sel].filter((x) => x !== m) : [...sel, m];
      patch({ paymentMethods: next });
    };
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => (
            <button key={m} onClick={() => toggle(m)} className={cn("px-4 py-2 rounded-full border text-sm capitalize", sel.has(m) && "bg-primary text-primary-foreground border-primary")}>{m}</button>
          ))}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Online payment gateway (optional)</Label>
          <select className="w-full border rounded-md h-10 px-3 bg-background" value={answers.paymentGateway ?? ""} onChange={(e) => patch({ paymentGateway: e.target.value || null })}>
            <option value="">None for now</option>
            <option value="razorpay">Razorpay</option>
            <option value="stripe">Stripe</option>
            <option value="cashfree">Cashfree</option>
          </select>
        </div>
      </div>
    );
  }
  if (stepId === "tax") {
    const country = answers.taxCountry ?? "IN";
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <Label className="text-xs">Country</Label>
          <select className="w-full border rounded-md h-10 px-3 bg-background" value={country} onChange={(e) => {
            const c = COUNTRIES.find((x) => x.id === e.target.value);
            patch({ taxCountry: e.target.value, taxRate: c?.tax ?? answers.taxRate });
          }}>
            {COUNTRIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Default tax rate (%)</Label>
            <Input type="number" min={0} step="0.01" value={answers.taxRate ?? ""} onChange={(e) => patch({ taxRate: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Service charge (%) — optional</Label>
            <Input type="number" min={0} step="0.01" value={answers.serviceCharge ?? ""} onChange={(e) => patch({ serviceCharge: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      {children}
    </div>
  );
}

function ProfileStep() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: restaurant } = useQuery<{ name: string; phone: string | null; address: string | null; city: string | null; currency: string | null; description: string | null; timezone: string | null; logoUrl: string | null }>({
    queryKey: ["restaurant", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}`),
    enabled: !!restaurantId,
  });
  const [form, setForm] = useState({ name: "", phone: "", address: "", city: "", description: "", currency: "INR", timezone: "Asia/Kolkata", logoUrl: "" });
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (restaurant && !hydrated) {
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
      setHydrated(true);
    }
  }, [restaurant, hydrated]);
  const mut = useMutation({
    mutationFn: (data: typeof form) => apiPatch(`/restaurants/${restaurantId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["restaurant", restaurantId] });
      toast({ title: "Profile saved" });
    },
    onError: (e) => toast({ title: "Save failed", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });
  return (
    <div className="space-y-4">
      <Field label="Restaurant name" required>
        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="KhanaLagao Cafe" />
      </Field>
      <Field label="Phone number" required>
        <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="9876543210" />
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
            <option value="AED">AED (د.إ)</option>
            <option value="GBP">GBP (£)</option>
          </select>
        </Field>
      </div>
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
      <ImageUploadField
        label="Logo (optional)"
        value={form.logoUrl}
        onChange={(v) => setForm({ ...form, logoUrl: v })}
        compact
      />
      <Field label="Short description (optional)">
        <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Family-style North Indian, dine-in & takeaway." rows={2} />
      </Field>
      <Button onClick={() => mut.mutate(form)} disabled={mut.isPending || !form.name || !form.phone || !form.address || !form.city}>
        {mut.isPending ? "Saving…" : "Save profile"}
      </Button>
    </div>
  );
}

function KitchenStep() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: kitchens = [] } = useQuery<{ id: number; name: string; isDefault: boolean }[]>({
    queryKey: ["kitchens", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/kitchens`),
    enabled: !!restaurantId,
  });
  const [name, setName] = useState("");
  const mut = useMutation({
    mutationFn: (n: string) => apiPost(`/restaurants/${restaurantId}/kitchens`, { name: n }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["kitchens", restaurantId] });
      toast({ title: "Kitchen added" });
    },
    onError: (e) => toast({ title: "Save failed", description: e instanceof Error ? e.message : "", variant: "destructive" }),
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Kitchens are where orders are routed for prep. Most places start with one (e.g. "Main Kitchen"). You can add a "Bar" or "Tandoor" later.</p>
      {kitchens.length > 0 && (
        <div className="space-y-1.5">
          {kitchens.map(k => (
            <div key={k.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="font-medium">{k.name}</span>
              {k.isDefault && <span className="text-xs text-muted-foreground">(default)</span>}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main Kitchen" />
        <Button onClick={() => mut.mutate(name)} disabled={mut.isPending || !name.trim()}>
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

function TablesStep() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: tables = [] } = useQuery<{ id: number; tableNumber: string; capacity: number }[]>({
    queryKey: ["wizard-tables", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/tables`),
    enabled: !!restaurantId,
  });
  const [bulk, setBulk] = useState({ count: "5", prefix: "T", capacity: "4" });
  const parsedCount = Number.parseInt(bulk.count, 10);
  const validCount = Number.isFinite(parsedCount) && parsedCount >= 1 && parsedCount <= 50;
  const mut = useMutation({
    mutationFn: async () => {
      const count = Math.min(50, parsedCount);
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
      qc.invalidateQueries({ queryKey: ["wizard-tables", restaurantId] });
      toast({ title: `Added ${(created as unknown[]).length} tables` });
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ["wizard-tables", restaurantId] });
      toast({ title: "Add stopped", description: e instanceof Error ? e.message : "", variant: "destructive" });
    },
  });
  return (
    <div className="space-y-4">
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
      <Button onClick={() => mut.mutate()} disabled={mut.isPending || !validCount}>
        {mut.isPending ? "Adding…" : validCount ? `Add ${parsedCount} tables` : "Enter 1–50 tables"}
      </Button>
    </div>
  );
}

function StaffStep() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: staff = [] } = useQuery<{ id: number; name: string; role: string }[]>({
    queryKey: ["wizard-staff", restaurantId],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/staff`),
    enabled: !!restaurantId,
  });
  const [form, setForm] = useState({ name: "", email: "", role: "waiter", password: "" });
  const mut = useMutation({
    mutationFn: (data: typeof form) => apiPost(`/users`, { ...data, restaurantId }),
    onSuccess: () => {
      setForm({ name: "", email: "", role: "waiter", password: "" });
      qc.invalidateQueries({ queryKey: ["wizard-staff", restaurantId] });
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
    <div className="space-y-4">
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
    </div>
  );
}

function GeneratingView() {
  const messages = useMemo(() => [
    "Analysing your restaurant profile…",
    "Picking the right menu categories…",
    "Setting tax & payment defaults…",
    "Designing your QR menu style…",
    "Pinning starter reports for your dashboard…",
  ], []);
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % messages.length), 1800);
    return () => clearInterval(t);
  }, [messages.length]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20">
      <div className="text-center space-y-6 max-w-md px-4">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Sparkles className="w-8 h-8 text-primary animate-pulse" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Khana AI is setting up your restaurant</h2>
          <p className="text-sm text-muted-foreground mt-2">This usually takes 10–20 seconds.</p>
        </div>
        <div className="text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{messages[i]}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryView({ summary, onGoLive, loading, navigate }: { summary: WizardSummary; onGoLive: () => void; loading: boolean; navigate: (p: string) => void }) {
  const items = [
    { label: "Menu categories created", value: `${summary.categoriesCreated}`, link: "/menu-management" },
    { label: "Menu items imported", value: summary.itemsImported > 0 ? `${summary.itemsImported}` : "—", link: "/menu-management" },
    { label: "Outlets / branches", value: `${summary.branchesCreated}`, link: "/settings/branches" },
    { label: "Tables", value: `${summary.tablesCount ?? 0}`, link: "/tables" },
    { label: "Kitchens", value: `${summary.kitchensCount ?? 0}`, link: "/settings/kitchens" },
    { label: "Team members", value: `${summary.staffCount ?? 0}`, link: "/staff" },
    { label: "Default tax rate", value: summary.taxApplied != null ? `${summary.taxApplied}%` : "—", link: "/settings/tax" },
    { label: "Payment methods", value: summary.paymentMethods.join(", ") || "—", link: "/settings/payments" },
    { label: "QR menu style", value: summary.qrMenuStyle ?? "—", link: "/settings/qr-menu" },
    { label: "Pinned reports", value: summary.pinnedReports.join(", ") || "—", link: "/reports" },
    { label: "Google review link", value: summary.googleReviewLink ? "Saved" : "Not set", link: "/settings/reviews" },
  ];
  return (
    <div className="min-h-screen bg-muted/20 py-10">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-card border rounded-2xl p-8 shadow-sm space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto">
              <Check className="w-7 h-7 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold">Your restaurant is ready</h1>
            <p className="text-sm text-muted-foreground">Khana AI set everything up. Review the summary below — you can edit any of it later.</p>
          </div>
          <div className="divide-y border rounded-xl">
            {items.map((it) => (
              <div key={it.label} className="flex items-center justify-between p-4">
                <div>
                  <div className="text-sm font-medium">{it.label}</div>
                  <div className="text-sm text-muted-foreground">{it.value}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate(it.link)}>Edit</Button>
              </div>
            ))}
          </div>
          <Button className="w-full" size="lg" onClick={onGoLive} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
            Go live
          </Button>
        </div>
      </div>
    </div>
  );
}
