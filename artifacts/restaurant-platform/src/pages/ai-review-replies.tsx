import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, Plus, Copy, Send, Loader2, Star, MessageSquare } from "lucide-react";
import { AI_CHAT_OPEN_EVENT } from "@/components/ai/AiChatAssistant";
import { useRestaurantId } from "@/lib/hooks";
import { useAiWallet } from "@/lib/aiHooks";
import { CreditsPill } from "@/components/ai/CreditsPill";
import { InsufficientCreditsModal } from "@/components/ai/InsufficientCreditsModal";
import { apiFetch, apiPost, apiPatch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface ExternalReview {
  id: number;
  source: string;
  authorName: string | null;
  rating: number | null;
  body: string;
  sentiment: string | null;
  category: string | null;
  postedAt: string | null;
  createdAt: string;
}

interface ReviewReply {
  id: number;
  externalReviewId: number | null;
  reviewSnapshot: string;
  tone: string;
  draftReply: string;
  finalReply: string | null;
  status: "draft" | "edited" | "posted" | "discarded";
  postedTo: string | null;
  postedAt: string | null;
  createdAt: string;
}

const TONES = ["professional", "friendly", "apologetic", "premium", "short", "detailed"];
const COST = 2;

export default function AiReviewRepliesPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const wallet = useAiWallet();

  const [adding, setAdding] = useState(false);
  const [newReview, setNewReview] = useState({ authorName: "", rating: 3, body: "" });
  const [tone, setTone] = useState("professional");
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [editingReply, setEditingReply] = useState<ReviewReply | null>(null);
  const [editText, setEditText] = useState("");
  const [showInsufficient, setShowInsufficient] = useState(false);

  const reviews = useQuery<ExternalReview[]>({
    queryKey: ["external-reviews", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/reviews/external`),
    enabled: !!restaurantId,
  });

  const replies = useQuery<ReviewReply[]>({
    queryKey: ["review-replies", restaurantId],
    queryFn: () => apiFetch(`/restaurants/${restaurantId}/reviews/replies`),
    enabled: !!restaurantId,
  });

  const addReview = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/reviews/external`, newReview),
    onSuccess: () => {
      toast({ title: "Review added" });
      setAdding(false);
      setNewReview({ authorName: "", rating: 3, body: "" });
      qc.invalidateQueries({ queryKey: ["external-reviews", restaurantId] });
    },
  });

  async function generate(review: ExternalReview) {
    if ((wallet.data?.balance ?? 0) < COST) { setShowInsufficient(true); return; }
    setGeneratingId(review.id);
    try {
      await apiPost(`/restaurants/${restaurantId}/reviews/ai-reply`, {
        externalReviewId: review.id,
        body: review.body,
        rating: review.rating,
        tone,
      });
      toast({ title: "Reply drafted" });
      qc.invalidateQueries({ queryKey: ["review-replies", restaurantId] });
      qc.invalidateQueries({ queryKey: ["external-reviews", restaurantId] });
      qc.invalidateQueries({ queryKey: ["ai-wallet"] });
    } catch (e) {
      toast({ title: "Generation failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setGeneratingId(null);
    }
  }

  const updateReply = useMutation({
    mutationFn: (vars: { id: number; body: Record<string, unknown> }) =>
      apiPatch(`/restaurants/${restaurantId}/reviews/replies/${vars.id}`, vars.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-replies", restaurantId] });
      setEditingReply(null);
    },
  });

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  }

  function repliesFor(reviewId: number) {
    return (replies.data ?? []).filter((r) => r.externalReviewId === reviewId);
  }

  return (
    <Layout>
      <PageHeader
        title="AI Review Replies"
        subtitle="Paste customer reviews from Google, draft AI replies, then copy or post them."
        actions={
          <div className="flex items-center gap-2">
            <CreditsPill cost={COST} available={wallet.data?.balance ?? null} />
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add review
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-3 mb-4">
        <Label className="text-sm">Reply tone:</Label>
        <Select value={tone} onValueChange={setTone}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{COST} credits per AI reply</span>
      </div>

      {reviews.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (reviews.data?.length ?? 0) === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No reviews yet. Click "Add review" to paste one from Google.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {reviews.data!.map((rv) => {
            const drafts = repliesFor(rv.id);
            return (
              <Card key={rv.id} data-testid={`card-review-${rv.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{rv.authorName ?? "Anonymous"}</span>
                        {rv.rating && (
                          <span className="flex items-center text-amber-500 text-sm">
                            {Array.from({ length: rv.rating }).map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-current" />)}
                          </span>
                        )}
                        {rv.sentiment && <Badge variant="outline" className="text-xs">{rv.sentiment}</Badge>}
                        {rv.category && <Badge variant="secondary" className="text-xs">{rv.category}</Badge>}
                      </div>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{rv.body}</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => generate(rv)}
                        disabled={generatingId === rv.id}
                        data-testid={`button-generate-${rv.id}`}
                      >
                        {generatingId === rv.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                        AI Reply
                      </Button>
                      {wallet.data?.planDashboardChatEnabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.dispatchEvent(new CustomEvent(AI_CHAT_OPEN_EVENT, {
                            detail: { prompt: `Draft a ${tone} reply to review #${rv.id} (${rv.rating ?? "?"}★ from ${rv.authorName ?? "Anonymous"}): "${rv.body}"` },
                          }))}
                          data-testid={`button-chat-draft-${rv.id}`}
                        >
                          <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                          Draft with AI chat
                        </Button>
                      )}
                    </div>
                  </div>

                  {drafts.map((d) => (
                    <div key={d.id} className="border-l-2 border-primary/40 pl-3 ml-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{d.status}</Badge>
                        <span className="text-xs text-muted-foreground">{d.tone}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{d.finalReply ?? d.draftReply}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => copy(d.finalReply ?? d.draftReply)}>
                          <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditingReply(d); setEditText(d.finalReply ?? d.draftReply); }}>
                          Edit
                        </Button>
                        {d.status !== "posted" && (
                          <Button size="sm" variant="outline" onClick={() => updateReply.mutate({ id: d.id, body: { status: "posted", postedTo: "google" } })}>
                            <Send className="h-3.5 w-3.5 mr-1.5" /> Mark as posted
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>Paste a review</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reviewer name</Label>
              <Input value={newReview.authorName} onChange={(e) => setNewReview({ ...newReview, authorName: e.target.value })} />
            </div>
            <div>
              <Label>Rating</Label>
              <Select value={String(newReview.rating)} onValueChange={(v) => setNewReview({ ...newReview, rating: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}★</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Review text</Label>
              <Textarea rows={5} value={newReview.body} onChange={(e) => setNewReview({ ...newReview, body: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={() => addReview.mutate()} disabled={!newReview.body.trim() || addReview.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingReply} onOpenChange={(o) => !o && setEditingReply(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit reply</DialogTitle></DialogHeader>
          <Textarea rows={8} value={editText} onChange={(e) => setEditText(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingReply(null)}>Cancel</Button>
            <Button onClick={() => editingReply && updateReply.mutate({ id: editingReply.id, body: { finalReply: editText } })}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InsufficientCreditsModal open={showInsufficient} onClose={() => setShowInsufficient(false)} required={COST} available={wallet.data?.balance ?? 0} feature="ai_review_reply" />
    </Layout>
  );
}
