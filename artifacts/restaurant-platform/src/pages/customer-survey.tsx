import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Loader2, CheckCircle2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface PublicQuestion {
  id: number;
  type: string;
  label: string;
  required: boolean;
  options: string[];
  scaleMin: number | null;
  scaleMax: number | null;
}

interface PublicSurvey {
  slug: string;
  type: string;
  title: string;
  description: string | null;
  thankYouMessage: string;
  collectName: boolean;
  collectPhone: boolean;
  collectTableNumber: boolean;
  questions: PublicQuestion[];
  restaurant: { name: string; slug: string; logoUrl: string | null };
  accentColor: string;
}

export default function CustomerSurveyPage() {
  const [, params] = useRoute<{ slug: string }>("/survey/:slug");
  const slug = params?.slug ?? "";
  const [survey, setSurvey] = useState<PublicSurvey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tableNumber, setTableNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/public/surveys/${slug}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error("Not found")))
      .then(setSurvey)
      .catch(() => setError("This survey is no longer available."));
  }, [slug]);

  if (error) return <Centered>{error}</Centered>;
  if (!survey) return <Centered><Loader2 className="h-5 w-5 animate-spin" /></Centered>;

  const accent = survey.accentColor;

  if (done) {
    return (
      <Centered>
        <div className="max-w-md w-full text-center space-y-4 p-6">
          <CheckCircle2 className="h-12 w-12 mx-auto" style={{ color: accent }} />
          <h1 className="text-2xl font-semibold">{survey.thankYouMessage}</h1>
          <p className="text-sm text-muted-foreground">Your feedback helps {survey.restaurant.name} get better.</p>
        </div>
      </Centered>
    );
  }

  async function submit() {
    if (!survey) return;
    for (const q of survey.questions) {
      if (q.required && (answers[String(q.id)] == null || answers[String(q.id)] === "")) {
        setError(`Please answer: ${q.label}`);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/surveys/${slug}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          respondentName: survey.collectName ? name : undefined,
          respondentPhone: survey.collectPhone ? phone : undefined,
          tableNumber: survey.collectTableNumber ? tableNumber : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to submit");
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="text-center space-y-2">
          {survey.restaurant.logoUrl && (
            <img src={survey.restaurant.logoUrl} alt={survey.restaurant.name} className="h-14 mx-auto rounded" />
          )}
          <p className="text-sm text-muted-foreground">{survey.restaurant.name}</p>
          <h1 className="text-2xl font-semibold">{survey.title}</h1>
          {survey.description && <p className="text-sm text-muted-foreground">{survey.description}</p>}
        </div>

        <div className="bg-card rounded-lg border p-5 space-y-5">
          {survey.questions.map(q => (
            <QuestionInput
              key={q.id}
              q={q}
              accent={accent}
              value={answers[String(q.id)]}
              onChange={(v) => setAnswers(a => ({ ...a, [String(q.id)]: v }))}
            />
          ))}

          {(survey.collectName || survey.collectPhone || survey.collectTableNumber) && (
            <div className="space-y-3 pt-3 border-t">
              {survey.collectName && (
                <div>
                  <Label>Your name (optional)</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" />
                </div>
              )}
              {survey.collectPhone && (
                <div>
                  <Label>Phone (optional)</Label>
                  <PhoneInput value={phone} onChange={(v) => setPhone(v)} />
                </div>
              )}
              {survey.collectTableNumber && (
                <div>
                  <Label>Table number (optional)</Label>
                  <Input value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} data-testid="input-table" />
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            className="w-full"
            style={{ backgroundColor: accent, color: "white" }}
            onClick={submit}
            disabled={submitting}
            data-testid="button-submit-survey"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit"}
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground">Powered by KhanaLagao</p>
      </div>
    </div>
  );
}

function QuestionInput({ q, accent, value, onChange }: {
  q: PublicQuestion;
  accent: string;
  value: string | number | undefined;
  onChange: (v: string | number) => void;
}) {
  if (q.type === "rating_5" || q.type === "rating_10") {
    const max = q.scaleMax ?? (q.type === "rating_5" ? 5 : 10);
    return (
      <div>
        <Label className="block mb-2">{q.label}{q.required && <span className="text-destructive">*</span>}</Label>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map(n => {
            const selected = Number(value) >= n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onChange(n)}
                className="p-1.5 rounded hover:bg-muted transition"
                data-testid={`star-${q.id}-${n}`}
              >
                <Star className="h-7 w-7" style={{ color: selected ? accent : "#cbd5e1" }} fill={selected ? accent : "transparent"} />
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (q.type === "nps") {
    return (
      <div>
        <Label className="block mb-2">{q.label}{q.required && <span className="text-destructive">*</span>}</Label>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 11 }, (_, i) => i).map(n => {
            const selected = Number(value) === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onChange(n)}
                className="w-9 h-9 rounded-full border text-sm font-medium"
                style={selected ? { backgroundColor: accent, color: "white", borderColor: accent } : {}}
                data-testid={`nps-${q.id}-${n}`}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>Not at all likely</span><span>Extremely likely</span>
        </div>
      </div>
    );
  }
  if (q.type === "single_choice") {
    return (
      <div>
        <Label className="block mb-2">{q.label}{q.required && <span className="text-destructive">*</span>}</Label>
        <div className="flex flex-wrap gap-2">
          {q.options.map(opt => {
            const selected = value === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(opt)}
                className="px-3 py-1.5 rounded-full border text-sm"
                style={selected ? { backgroundColor: accent, color: "white", borderColor: accent } : {}}
                data-testid={`choice-${q.id}-${opt}`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (q.type === "text_long") {
    return (
      <div>
        <Label className="block mb-2">{q.label}{q.required && <span className="text-destructive">*</span>}</Label>
        <Textarea rows={3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} data-testid={`text-${q.id}`} />
      </div>
    );
  }
  // text_short
  return (
    <div>
      <Label className="block mb-2">{q.label}{q.required && <span className="text-destructive">*</span>}</Label>
      <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} data-testid={`text-${q.id}`} />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center p-4">{children}</div>;
}
