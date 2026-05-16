import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Star, Loader2, ExternalLink, CheckCircle2 } from "lucide-react";
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

const CATEGORIES = ["Food quality", "Service", "Cleanliness", "Wait time", "Pricing", "Other"];

export default function CustomerFeedbackPage() {
  const [, params] = useRoute<{ qrCode: string }>("/review/:qrCode");
  const qrCode = params?.qrCode ?? "";
  const [config, setConfig] = useState<QrConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [phase, setPhase] = useState<"rate" | "google" | "form" | "done">("rate");
  const [form, setForm] = useState({ category: "", comment: "", customerName: "", customerPhone: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!qrCode) return;
    fetch(`/api/public/review-qr/${qrCode}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Not found")))
      .then(setConfig)
      .catch(() => setError("This review link is no longer active."));
  }, [qrCode]);

  async function submitRating(stars: number) {
    setRating(stars);
    try {
      const res = await fetch(`/api/public/review-qr/${qrCode}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: stars }),
      });
      const data = await res.json();
      if (data.positive && config?.googleReviewUrl) setPhase("google");
      else setPhase("form");
    } catch {
      setPhase("form");
    }
  }

  async function goToGoogle() {
    fetch(`/api/public/review-qr/${qrCode}/google-redirect`, { method: "POST" }).catch(() => undefined);
    if (config?.googleReviewUrl) window.location.href = config.googleReviewUrl;
  }

  async function submitFeedback() {
    if (!rating) return;
    setSubmitting(true);
    try {
      await fetch(`/api/public/review-qr/${qrCode}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, ...form }),
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

          {phase === "google" && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="h-12 w-12 mx-auto text-green-500" />
              <p className="font-medium">{config.thankYouMessage}</p>
              <p className="text-sm text-muted-foreground">Would you share your kind words on Google?</p>
              <Button className="w-full" style={accent} onClick={goToGoogle} data-testid="button-google-review">
                <ExternalLink className="h-4 w-4 mr-2" /> Leave a Google review
              </Button>
              <button className="text-xs text-muted-foreground underline" onClick={() => setPhase("form")}>
                No thanks, give private feedback instead
              </button>
            </div>
          )}

          {phase === "form" && (
            <div className="space-y-3">
              <p className="text-sm">{config.negativeFeedbackMessage}</p>
              <div>
                <Label className="text-xs">What was the issue?</Label>
                <select
                  className="w-full mt-1 border rounded h-9 px-2 text-sm bg-background"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  <option value="">Select…</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Tell us more</Label>
                <Textarea rows={4} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Your name (optional)</Label>
                  <Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Phone (optional)</Label>
                  <Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
                </div>
              </div>
              <Button className="w-full" style={accent} onClick={submitFeedback} disabled={submitting} data-testid="button-submit-feedback">
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
              <p className="text-sm text-muted-foreground">A manager will review your feedback shortly.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
