import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Star, Loader2, ExternalLink, CheckCircle2, Copy, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

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
  "Good ambience",
  "Value for money",
  "Fast service",
];
const CRITICAL_TAGS = [
  "Slow service",
  "Food quality issue",
  "Staff behavior",
  "Billing issue",
  "Hygiene issue",
  "Delivery delay",
  "Price concern",
];

type Phase = "rate" | "tags" | "draft" | "done";

function newSessionToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function CustomerFeedbackPage() {
  const [, params] = useRoute<{ qrCode: string }>("/review/:qrCode");
  const qrCode = params?.qrCode ?? "";
  const [config, setConfig] = useState<QrConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionToken] = useState<string>(() => newSessionToken());
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("rate");
  // aiAssistAvailable comes from /rate (QR config + Google URL). When false the
  // UI never offers Generate/Regenerate; it goes straight to a manual draft.
  const [aiAssistAvailable, setAiAssistAvailable] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draftEdited, setDraftEdited] = useState("");
  const [aiDelivered, setAiDelivered] = useState(false);
  const [aiUnavailableReason, setAiUnavailableReason] = useState<string | null>(null);
  const [googleReviewUrl, setGoogleReviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savingManual, setSavingManual] = useState(false);

  useEffect(() => {
    if (!qrCode) return;
    fetch(`/api/public/review-qr/${qrCode}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Not found")))
      .then((c: QrConfig) => { setConfig(c); setGoogleReviewUrl(c.googleReviewUrl); })
      .catch(() => setError("This review link is no longer active."));
  }, [qrCode]);

  const isPositive = useMemo(() => {
    if (!rating || !config) return false;
    return rating >= config.positiveThreshold;
  }, [rating, config]);

  const tagOptions = isPositive ? POSITIVE_TAGS : CRITICAL_TAGS;

  async function pickRating(stars: number) {
    setRating(stars);
    setTags([]);
    setComment("");
    setDraftEdited("");
    setAiDelivered(false);
    setAiUnavailableReason(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/public/review-qr/${qrCode}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: stars, sessionToken }),
      });
      const data = await res.json();
      setAiAssistAvailable(!!data.aiAssistEnabled);
      if (typeof data.googleReviewUrl === "string") setGoogleReviewUrl(data.googleReviewUrl);
    } catch {
      setAiAssistAvailable(false);
    }
    setPhase("tags");
  }

  function toggleTag(tag: string) {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag].slice(0, 5));
  }

  // Persist tags + comment + name + phone without spending AI credits. Used
  // when ai_assist is off — keeps the feedback row in sync with what the
  // customer typed even though we won't ask the model for a draft.
  async function saveTagsAndContinue() {
    if (!rating) return;
    setSavingManual(true);
    try {
      // Re-call /rate with same rating just to ensure the row exists before
      // generate-draft (no double counting — server only emits a scan event
      // once per session for new rows).
      // Then call /generate-draft which will short-circuit with ai_assist_disabled
      // / no_google_url but still persist tags+comment+name+phone in the row.
      await fetch(`/api/public/review-qr/${qrCode}/generate-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, sessionToken, tags, comment, customerName, customerPhone }),
      }).catch(() => undefined);
    } finally {
      setSavingManual(false);
    }
    setPhase("draft");
  }

  async function generateDraft() {
    if (!rating) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/public/review-qr/${qrCode}/generate-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, sessionToken, tags, comment, customerName, customerPhone }),
      });
      const data = await res.json();
      if (typeof data.googleReviewUrl === "string") setGoogleReviewUrl(data.googleReviewUrl);
      if (data.available && typeof data.draft === "string" && data.draft.trim()) {
        setAiDelivered(true);
        setAiUnavailableReason(null);
        setDraftEdited(data.draft);
      } else {
        setAiDelivered(false);
        setAiUnavailableReason(data.reason ?? "unavailable");
      }
      setPhase("draft");
    } catch {
      setAiDelivered(false);
      setAiUnavailableReason("network");
      setPhase("draft");
    } finally {
      setGenerating(false);
    }
  }

  async function copyDraft() {
    const text = draftEdited.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      fetch(`/api/public/review-qr/${qrCode}/draft-copied`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken }),
      }).catch(() => undefined);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard blocked */ }
  }

  function goToGoogle() {
    fetch(`/api/public/review-qr/${qrCode}/google-redirect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken }),
    }).catch(() => undefined);
    if (googleReviewUrl) {
      window.open(googleReviewUrl, "_blank", "noopener");
    }
    setPhase("done");
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
  const hasGoogleUrl = !!googleReviewUrl;
  const showGenerate = aiAssistAvailable && hasGoogleUrl;

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
                      onClick={() => pickRating(n)}
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
                <Label className="text-xs">Tell us more (optional)</Label>
                <Textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={isPositive ? "What stood out for you?" : "Tell us more so we can fix it"}
                  data-testid="input-comment"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Your name (optional)</Label>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} data-testid="input-name" />
                </div>
                {!isPositive && (
                  <div>
                    <Label className="text-xs">Phone (optional)</Label>
                    <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} data-testid="input-phone" />
                  </div>
                )}
              </div>
              {showGenerate ? (
                <Button
                  className="w-full"
                  style={accent}
                  onClick={generateDraft}
                  disabled={generating}
                  data-testid="button-generate-review"
                >
                  {generating ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Writing your draft…</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-2" /> Generate Review</>
                  )}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  style={accent}
                  onClick={saveTagsAndContinue}
                  disabled={savingManual}
                  data-testid="button-continue-manual"
                >
                  {savingManual ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Continue
                </Button>
              )}
            </div>
          )}

          {phase === "draft" && (
            <div className="space-y-3">
              {!isPositive && (
                <p className="text-xs text-muted-foreground italic">
                  {config.negativeFeedbackMessage} A manager will follow up on your feedback.
                </p>
              )}
              <div className="flex items-center justify-between">
                <Label className="text-sm flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" style={{ color: config.accentColor }} />
                  {aiDelivered ? "Your AI-written draft" : "Write your review"}
                </Label>
                {showGenerate && aiDelivered && (
                  <button
                    type="button"
                    onClick={generateDraft}
                    disabled={generating}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    data-testid="button-regenerate-draft"
                  >
                    <RefreshCw className={`h-3 w-3 ${generating ? "animate-spin" : ""}`} /> Regenerate
                  </button>
                )}
              </div>
              {!aiDelivered && showGenerate && aiUnavailableReason && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  We couldn't generate a draft this time. You can write your review manually below.
                </p>
              )}
              {!showGenerate && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  AI review generation is unavailable. You can write your review manually.
                </p>
              )}
              <Textarea
                rows={6}
                value={draftEdited}
                onChange={(e) => { setDraftEdited(e.target.value); setCopied(false); }}
                placeholder={aiDelivered ? "" : "Write a short review you'd like to post on Google…"}
                className="text-sm"
                data-testid="textarea-draft"
              />
              <p className="text-xs text-muted-foreground">Feel free to edit before posting. Copy it, then we'll open Google for you.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={copyDraft} disabled={!draftEdited.trim()} data-testid="button-copy-draft">
                  <Copy className="h-4 w-4 mr-2" /> {copied ? "Copied!" : "Copy Review"}
                </Button>
                <Button style={accent} onClick={goToGoogle} disabled={!hasGoogleUrl} data-testid="button-open-google">
                  <ExternalLink className="h-4 w-4 mr-2" /> Open Google Review
                </Button>
              </div>
              {!hasGoogleUrl && (
                <p className="text-xs text-muted-foreground text-center">
                  This restaurant hasn't set up a Google review link yet — your feedback has still been sent to them.
                </p>
              )}
              <div className="text-center">
                <button className="text-xs text-muted-foreground underline" onClick={() => setPhase("done")} data-testid="button-skip-google">
                  Done
                </button>
              </div>
            </div>
          )}

          {phase === "done" && (
            <div className="text-center space-y-3 py-4">
              <CheckCircle2 className="h-14 w-14 mx-auto text-green-500" />
              <p className="font-medium">{config.thankYouMessage}</p>
              <p className="text-sm text-muted-foreground">
                Paste your copied review on Google and submit.
              </p>
              {!isPositive && (
                <p className="text-xs text-muted-foreground">A manager will reach out shortly about your concerns.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
