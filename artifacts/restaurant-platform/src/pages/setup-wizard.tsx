import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Flame, ChevronRight, ChevronLeft, Loader2, Plus, Trash2, Check, Sparkles, Rocket,
  Store, Utensils, MapPin, FileUp, Star, CreditCard, Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
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
  { id: "type", title: "Restaurant type", icon: Store },
  { id: "cuisines", title: "Cuisines", icon: Utensils },
  { id: "outlets", title: "Outlets", icon: MapPin },
  { id: "menu", title: "Menu upload", icon: FileUp },
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

  // Hydrate from server
  useEffect(() => {
    if (!data) return;
    setAnswers(data.answers ?? {});
    if (data.status === "done" && data.summary) setShowSummary(true);
    if (typeof data.step === "number" && stepIdx === 0 && !showSummary) {
      setStepIdx(Math.min(Math.max(0, data.step), STEPS.length - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.answers, data?.status]);

  // Already done? Send to dashboard.
  useEffect(() => {
    if (data?.onboardingCompletedAt) navigate("/dashboard");
  }, [data?.onboardingCompletedAt, navigate]);

  const saveMut = useMutation({
    mutationFn: (payload: { answers: Partial<WizardAnswers>; step?: number }) =>
      apiPatch<WizardState>(`/restaurants/${restaurantId}/setup-wizard`, payload),
    onSuccess: (s) => qc.setQueryData(["setup-wizard", restaurantId], s),
  });

  const generateMut = useMutation({
    mutationFn: () => apiPost<WizardState>(`/restaurants/${restaurantId}/setup-wizard/generate`, { answers }),
    onSuccess: (s) => {
      qc.setQueryData(["setup-wizard", restaurantId], s);
      setShowSummary(true);
      setGenerating(false);
      toast({ title: "Setup complete!", description: "Khana AI has set up your restaurant." });
    },
    onError: (err: unknown) => {
      setGenerating(false);
      const msg = err instanceof Error ? err.message : "Generation failed";
      toast({ title: "Setup failed", description: msg, variant: "destructive" });
    },
  });

  const completeMut = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/setup-wizard/complete`, {}),
    onSuccess: () => {
      toast({ title: "You're live!", description: "Welcome to Khana Lagao." });
      navigate("/dashboard");
    },
  });

  function patch(p: Partial<WizardAnswers>) {
    setAnswers((prev) => {
      const next = { ...prev, ...p };
      saveMut.mutate({ answers: p, step: stepIdx });
      return next;
    });
  }

  function next() {
    const newStep = Math.min(stepIdx + 1, STEPS.length - 1);
    setStepIdx(newStep);
    saveMut.mutate({ answers: {}, step: newStep });
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
            <div className="font-bold">Khana Lagao</div>
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
          Generation uses 10 Khana AI credits. You can edit everything later from Settings.
        </p>
      </div>
    </div>
  );
}

function stepDescription(id: typeof STEPS[number]["id"]): string {
  switch (id) {
    case "type": return "Pick the option that best describes your restaurant.";
    case "cuisines": return "Select all the cuisines you serve.";
    case "outlets": return "List your outlets — you can add more later.";
    case "menu": return "Optional. Upload your menu now to auto-import dishes.";
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
    queryFn: () => apiGet<{ id: number; status: string; itemCount?: number }>(`/restaurants/${restaurantId}/ai/menu-import/imports/${importId}`),
    enabled: !!restaurantId && !!importId,
    refetchInterval: (q) => {
      const s = (q.state.data as { status?: string } | undefined)?.status;
      return s && (s === "ready" || s === "failed" || s === "saved") ? false : 2000;
    },
  });

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
        { fileName: file.name, contentType: file.type || "application/octet-stream" },
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
    return (
      <div className="space-y-3">
        <div className="border rounded-xl p-4 flex items-center gap-3">
          {ready ? <Check className="w-5 h-5 text-green-600" /> : <Loader2 className="w-5 h-5 animate-spin text-primary" />}
          <div className="flex-1">
            <div className="text-sm font-medium">Menu import #{importId}</div>
            <div className="text-xs text-muted-foreground">Status: {s}{importStatus?.itemCount != null && ` · ${importStatus.itemCount} items detected`}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => patch({ menuImportId: null })}>Replace</Button>
        </div>
        <p className="text-xs text-muted-foreground">When you click "Generate", Khana AI will save these items into your menu.</p>
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
