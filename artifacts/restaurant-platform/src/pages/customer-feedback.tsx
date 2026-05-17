import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Star, Loader2, ExternalLink, CheckCircle2, Copy, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { useToast } from "@/hooks/use-toast";

interface QrConfig {
  qrCode: string;
  title: string;
  customMessage: string | null;
  thankYouMessage: string;
  negativeFeedbackMessage: string;
  googleReviewUrl: string | null;
  positiveThreshold: number;
  showGoogleButtonOnNegative: boolean;
  restaurant: { name: string; slug: string; logoUrl: string | null };
  accentColor: string;
}

const POSITIVE_TAGS = [
  "Tasty food",
  "Good service",
  "Friendly staff",
  "Clean place",
  "Nice ambience",
  "Value for money",
  "Fast service",
  "Would visit again",
];
const CRITICAL_TAGS = [
  "Slow service",
  "Food quality",
  "Staff behaviour",
  "Billing issue",
  "Hygiene",
  "Wait time",
  "Pricing",
  "Other",
];

type Phase = "rate" | "tags" | "draft" | "private" | "done";

export default function CustomerFeedbackPage() {
  const [, params] = useRoute<{ qrCode: string }>("/review/:qrCode");
  const qrCode = params?.qrCode ?? "";
  const [config, setConfig] = useState<QrConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionToken] = useState<string>(() => {
    try {
      return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    } catch {
      return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  });
  const { toast } = useToast();
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("rate");
  const [aiAssistEnabled, setAiAssistEnabled] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftEdited, setDraftEdited] = useState("");
  const [feedbackId, setFeedbackId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draftFailed, setDraftFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!qrCode) return;
    fetch(`/api/public/review-qr/${qrCode}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Not found")))
      .then(setConfig)
      .catch(() => setError("This review link is no longer active."));
  }, [qrCode]);

  const isPositive = useMemo(() => {
    if (!rating || !config) return false;
    return rating >= config.positiveThreshold;
  }, [rating, config]);

  const tagOptions = isPositive ? POSITIVE_TAGS : CRITICAL_TAGS;

  async function submitRating(stars: number) {
    setRating(stars);
    setTags([]);
    setComment("");
    setDraft(null);
    setDraftEdited("");
    setFeedbackId(null);
    setCopied(false);
    setDraftFailed(null);
    try {
      const res = await fetch(`/api/public/review-qr/${qrCode}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: stars, sessionToken }),
      });
      const data = await res.json();
      setAiAssistEnabled(!!data.aiAssistEnabled);
    } catch {
      setAiAssistEnabled(false);
    }
    setPhase("tags");
  }

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag].slice(0, 5));
  }

  async function continueFromTags() {
    if (!rating || !config) return;
    if (isPositive && config.googleReviewUrl && aiAssistEnabled) {
      await generateDraft();
    } else if (isPositive && config.googleReviewUrl) {
      // Positive but AI disabled — just send to Google after capturing tags as feedback
      await persistPositiveWithoutDraft();
    } else {
      setPhase("private");
    }
  }

  async function persistPositiveWithoutDraft() {
    if (!rating) return;
    try {
      const res = await fetch(`/api/public/review-qr/${qrCode}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, tags, comment, sessionToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.id) setFeedbackId(data.id);
    } catch { /* non-fatal */ }
    goToGoogle();
  }

  async function generateDraft() {
    if (!rating) return;
    setGenerating(true);
    setDraftFailed(null);
    try {
      const res = await fetch(`/api/public/review-qr/${qrCode}/generate-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, tags, comment, customerName, sessionToken }),
      });
      const data = await res.json();
      if (data.feedbackId) setFeedbackId(data.feedbackId);
      const draftText = typeof data.draftText === "string" ? data.draftText : typeof data.draft === "string" ? data.draft : "";
      if (data.available && draftText.trim()) {
        setDraft(draftText);
        setDraftEdited(draftText);
        setPhase("draft");
      } else {
        setDraftFailed(data.reason ?? "unavailable");
        setPhase("draft");
      }
    } catch {
      setDraftFailed("network");
      setPhase("draft");
    } finally {
      setGenerating(false);
    }
  }

  async function copyDraft() {
    if (!draftEdited) return;
    try {
      await navigator.clipboard.writeText(draftEdited);
      setCopied(true);
      toast({ title: "Review copied", description: "Now paste it into Google when the page opens." });
      fetch(`/api/public/review-qr/${qrCode}/draft-copied`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedbackId, sessionToken }),
      }).catch(() => undefined);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard blocked */ }
  }

  function goToGoogle() {
    fetch(`/api/public/review-qr/${qrCode}/google-redirect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedbackId, sessionToken }),
    }).catch(() => undefined);
    if (config?.googleReviewUrl) {
      window.open(config.googleReviewUrl, "_blank", "noopener");
    }
    setPhase("done");
  }

  async function submitPrivateFeedback() {
    if (!rating) return;
    setSubmitting(true);
    try {
      await fetch(`/api/public/review-qr/${qrCode}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, tags, comment, customerName, customerPhone, sessionToken }),
      });
      setPhase("done");
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-muted">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">Link unavailable</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const accent = { backgroundColor: config.accentColor, color: "white" };

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <div className="bg-background rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        <div className="p-6 text-white text-center" style={{ backgroundColor: config.accentColor }}>
          {config.restaurant.logoUrl && (
            <img src={config.restaurant.logoUrl} alt={config.restaurant.name} className="h-14 mx-auto mb-2 rounded bg-white/10 p-1" />
          )}
          <h1 className="text-lg font-semibold">{config.restaurant.name}</h1>
          <p className="text-sm opacity-90 mt-1">{config.title}</p>
        </div>

        <div className="p-6">
          {phase === "rate" && (
            <div className="space-y-4 text-center">
              {config.customMessage && <p className="text-sm text-muted-foreground">{config.customMessage}</p>}
              <p className="font-medium">How would you rate your experience?</p>
              <div className="flex justify-center gap-1" onMouseLeave={() => setHover(null)}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = (hover ?? rating ?? 0) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => submitRating(n)}
                      onMouseEnter={() => setHover(n)}
                      className="p-2 transition-transform hover:scale-110"
                      data-testid={`button-rate-${n}`}
                    >
                      <Star className={`h-10 w-10 ${filled ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {phase === "tags" && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="flex justify-center gap-0.5 mb-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={`h-5 w-5 ${(rating ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
                  ))}
                </div>
                <p className="font-medium">
                  {isPositive ? "Awesome! What did you enjoy?" : "Sorry to hear that. What went wrong?"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Pick up to 5 tags</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {tagOptions.map((tag) => {
                  const active = tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition ${active ? "text-white border-transparent" : "bg-background hover:bg-muted"}`}
                      style={active ? accent : undefined}
                      data-testid={`tag-${tag.replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
              <div>
                <Label className="text-xs">Anything else? (optional)</Label>
                <Textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={isPositive ? "What stood out for you?" : "Tell us more so we can fix it"}
                  data-testid="input-comment"
                />
              </div>
              {isPositive && aiAssistEnabled && config.googleReviewUrl && (
                <div>
                  <Label className="text-xs">Your name (optional, used in the draft)</Label>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} data-testid="input-name" />
                </div>
              )}
              <Button
                className="w-full"
                style={accent}
                onClick={continueFromTags}
                disabled={generating}
                data-testid="button-continue-tags"
              >
                {generating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Writing your draft…</>
                ) : isPositive && aiAssistEnabled && config.googleReviewUrl ? (
                  <><Sparkles className="h-4 w-4 mr-2" /> Help me write a Google review</>
                ) : (
                  "Continue"
                )}
              </Button>
              {isPositive && config.googleReviewUrl && !aiAssistEnabled && (
                <Button variant="outline" className="w-full" onClick={persistPositiveWithoutDraft}>
                  <ExternalLink className="h-4 w-4 mr-2" /> Skip & open Google
                </Button>
              )}
            </div>
          )}

          {phase === "draft" && (
            <div className="space-y-3">
              {draft ? (
                <>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4" style={{ color: config.accentColor }} /> Your AI-written draft
                    </Label>
                    <button
                      type="button"
                      onClick={generateDraft}
                      disabled={generating}
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      data-testid="button-regenerate-draft"
                    >
                      <RefreshCw className={`h-3 w-3 ${generating ? "animate-spin" : ""}`} /> Regenerate
                    </button>
                  </div>
                  <Textarea
                    rows={6}
                    value={draftEdited}
                    onChange={(e) => { setDraftEdited(e.target.value); setCopied(false); }}
                    className="text-sm"
                    data-testid="textarea-draft"
                  />
                  <p className="text-xs text-muted-foreground">Feel free to edit before posting. Copy it, then we'll open Google for you.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={copyDraft} data-testid="button-copy-draft">
                      <Copy className="h-4 w-4 mr-2" /> {copied ? "Copied!" : "Copy"}
                    </Button>
                    <Button style={accent} onClick={goToGoogle} data-testid="button-open-google">
                      <ExternalLink className="h-4 w-4 mr-2" /> Open Google
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center space-y-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    {draftFailed === "ai_assist_disabled"
                      ? "AI assist is off for this QR — but you can still leave a review."
                      : "We couldn't write a draft right now — but you can still leave a quick review."}
                  </p>
                  {config.googleReviewUrl && (
                    <Button className="w-full" style={accent} onClick={goToGoogle}>
                      <ExternalLink className="h-4 w-4 mr-2" /> Open Google review
                    </Button>
                  )}
                  <button className="text-xs text-muted-foreground underline" onClick={() => setPhase("tags")}>
                    Go back
                  </button>
                </div>
              )}
            </div>
          )}

          {phase === "private" && (
            <div className="space-y-3">
              <p className="text-sm">{config.negativeFeedbackMessage}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Your name (optional)</Label>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Phone (optional)</Label>
                  <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                </div>
              </div>
              <Button className="w-full" style={accent} onClick={submitPrivateFeedback} disabled={submitting} data-testid="button-submit-feedback">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send feedback"}
              </Button>
              {config.showGoogleButtonOnNegative && config.googleReviewUrl && (
                <Button variant="outline" className="w-full" onClick={goToGoogle}>
                  Or leave a public Google review
                </Button>
              )}
            </div>
          )}

          {phase === "done" && (
            <div className="text-center space-y-3 py-4">
              <CheckCircle2 className="h-14 w-14 mx-auto text-green-500" />
              <p className="font-medium">{config.thankYouMessage}</p>
              <p className="text-sm text-muted-foreground">
                {isPositive ? "Thanks for sharing the love!" : "A manager will reach out shortly."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
