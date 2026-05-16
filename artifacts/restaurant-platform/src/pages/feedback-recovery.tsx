import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Loader2, Phone, Star, AlertTriangle } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { useAiWallet } from "@/lib/aiHooks";
import { CreditsPill } from "@/components/ai/CreditsPill";
import { InsufficientCreditsModal } from "@/components/ai/InsufficientCreditsModal";
import { apiFetch, apiPost, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface RecoveryRow {
  task: {
    id: number;
    feedbackId: number | null;
    externalReviewId: number | null;
    status: "new" | "contacted" | "resolved" | "ignored";
    sentiment: string | null;
    category: string | null;
    aiSummary: string | null;
    suggestedResponse: string | null;
    suggestedCompensation: string | null;
    resolutionNotes: string | null;
    createdAt: string;
  };
  assigneeName: string | null;
  feedback: {
    id: number;
    rating: number;
    comment: string | null;
    customerName: string | null;
    customerPhone: string | null;
    createdAt: string;
  } | null;
  externalReview: {
    id: number;
    rating: number | null;
    body: string;
    authorName: string | null;
    source: string;
  } | null;
}

const STATUSES = ["new", "contacted", "resolved", "ignored"] as const;
const COMPS = ["apology", "discount", "dessert", "callback", "refund_review"];
const COST = 1;

export default function FeedbackRecoveryPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const wallet = useAiWallet();

  const [filter, setFilter] = useState<typeof STATUSES[number] | "all">("new");
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [showInsufficient, setShowInsufficient] = useState(false);
  const [notesEdit, setNotesEdit] = useState<Record<number, string>>({});

  const list = useQuery<RecoveryRow[]>({
    queryKey: ["recovery", restaurantId, filter],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/reviews/recovery${filter !== "all" ? `?status=${filter}` : ""}`),
    enabled: !!restaurantId,
  });

  async function analyze(sourceId: number, kind: "feedback" | "external") {
    if ((wallet.data?.balance ?? 0) < COST) { setShowInsufficient(true); return; }
    setAnalyzingId(sourceId);
    try {
      const qs = kind === "external" ? "?source=external" : "";
      await apiPost(`/restaurants/${restaurantId}/reviews/recovery/analyze/${sourceId}${qs}`);
      toast({ title: "Analysis complete" });
      qc.invalidateQueries({ queryKey: ["recovery", restaurantId] });
      qc.invalidateQueries({ queryKey: ["ai-wallet"] });
    } catch (e) {
      toast({ title: "Analysis failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAnalyzingId(null);
    }
  }

  const update = useMutation({
    mutationFn: (vars: { id: number; body: Record<string, unknown> }) =>
      apiPatch(`/restaurants/${restaurantId}/reviews/recovery/${vars.id}`, vars.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recovery", restaurantId] });
      toast({ title: "Updated" });
    },
  });

  return (
    <Layout>
      <PageHeader
        title="Feedback Recovery"
        subtitle="Manager queue for low-rated private feedback. Run AI analysis, contact the guest, log the resolution."
        actions={<CreditsPill cost={COST} available={wallet.data?.balance ?? null} />}
      />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)} className="mb-4">
        <TabsList>
          <TabsTrigger value="new">New</TabsTrigger>
          <TabsTrigger value="contacted">Contacted</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="ignored">Ignored</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {list.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (list.data?.length ?? 0) === 0 ? (
        <Card><CardContent className="p-10 text-center">
          <AlertTriangle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No feedback in this queue.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {list.data!.map(({ task, feedback, externalReview, assigneeName }) => {
            const source = feedback ? "feedback" : externalReview ? "external" : null;
            const sourceId = feedback?.id ?? externalReview?.id ?? null;
            const author = feedback?.customerName ?? externalReview?.authorName ?? "Anonymous";
            const rating = feedback?.rating ?? externalReview?.rating ?? null;
            const text = feedback?.comment ?? externalReview?.body ?? null;
            return (
            <Card key={task.id} data-testid={`card-recovery-${task.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{author}</span>
                      {externalReview && <Badge variant="outline" className="text-xs">Public · {externalReview.source}</Badge>}
                      {rating && (
                        <span className="flex items-center text-amber-500 text-sm">
                          {Array.from({ length: rating }).map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}
                        </span>
                      )}
                      <Badge variant={task.status === "new" ? "destructive" : task.status === "resolved" ? "default" : "outline"}>
                        {task.status}
                      </Badge>
                      {task.sentiment && <Badge variant="outline" className="text-xs">{task.sentiment}</Badge>}
                      {task.category && <Badge variant="secondary" className="text-xs">{task.category}</Badge>}
                      {feedback?.customerPhone && (
                        <a href={`tel:${feedback.customerPhone}`} className="text-xs text-primary inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {feedback.customerPhone}
                        </a>
                      )}
                      {assigneeName && <span className="text-xs text-muted-foreground">→ {assigneeName}</span>}
                    </div>
                    {text && <p className="text-sm mt-2 whitespace-pre-wrap">{text}</p>}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => sourceId && source && analyze(sourceId, source)}
                    disabled={analyzingId === sourceId || !source}
                  >
                    {analyzingId === sourceId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    {task.aiSummary ? "Re-analyze" : "AI Analyze"}
                  </Button>
                </div>

                {task.aiSummary && (
                  <div className="bg-muted/40 rounded p-3 text-sm space-y-2">
                    <p><strong>Summary:</strong> {task.aiSummary}</p>
                    {task.suggestedResponse && <p><strong>Suggested response:</strong> {task.suggestedResponse}</p>}
                    {task.suggestedCompensation && <p><strong>Suggested compensation:</strong> {task.suggestedCompensation}</p>}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Status</Label>
                    <Select value={task.status} onValueChange={(v) => update.mutate({ id: task.id, body: { status: v } })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Compensation</Label>
                    <Select
                      value={task.suggestedCompensation ?? "apology"}
                      onValueChange={(v) => update.mutate({ id: task.id, body: { suggestedCompensation: v } })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{COMPS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Resolution notes</Label>
                  <Textarea
                    rows={2}
                    value={notesEdit[task.id] ?? task.resolutionNotes ?? ""}
                    onChange={(e) => setNotesEdit({ ...notesEdit, [task.id]: e.target.value })}
                    onBlur={() => {
                      const v = notesEdit[task.id];
                      if (v !== undefined && v !== (task.resolutionNotes ?? "")) {
                        update.mutate({ id: task.id, body: { resolutionNotes: v } });
                      }
                    }}
                  />
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      <InsufficientCreditsModal open={showInsufficient} onClose={() => setShowInsufficient(false)} required={COST} available={wallet.data?.balance ?? 0} feature="ai_feedback_analysis" />
    </Layout>
  );
}
