import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { GraduationCap, Award, FileDown, Loader2, PlayCircle } from "lucide-react";
import { jsPDF } from "jspdf";

interface MyAssignment { id: number; courseId: number; status: string; assignedAt: string; completedAt: string | null; expiresAt: string | null; lastScore: number | null; attempts: number; courseTitle: string; courseDescription: string; requiresApproval: boolean; passMarkPercent: number }
interface MyCertificate { id: number; certificateNumber: string; courseId: number; courseTitle: string; score: number; issuedAt: string; expiresAt: string | null }
interface CourseDetail { course: { id: number; title: string; description: string; passMarkPercent: number }; modules: Array<{ id: number; title: string; videoUrl: string | null; body: string }>; questions: Array<{ id: number; question: string; options: string[] }> }

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  not_started: { label: "Not started", color: "bg-gray-100 text-gray-700" },
  in_progress: { label: "In progress", color: "bg-blue-100 text-blue-700" },
  awaiting_approval: { label: "Awaiting approval", color: "bg-yellow-100 text-yellow-700" },
  completed: { label: "Completed", color: "bg-green-100 text-green-700" },
  expired: { label: "Expired", color: "bg-red-100 text-red-700" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
};

export default function MyTrainingPage() {
  const { user } = useAuth();
  const { data: assigns } = useQuery<{ data: MyAssignment[] }>({ queryKey: ["my-assigns"], queryFn: () => apiGet("/sop-training/my-assignments") });
  const { data: certs } = useQuery<{ data: MyCertificate[] }>({ queryKey: ["my-certs"], queryFn: () => apiGet("/sop-training/my-certificates") });
  const [active, setActive] = useState<MyAssignment | null>(null);

  return (
    <Layout>
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-3"><GraduationCap className="w-6 h-6" /><h1 className="text-2xl font-semibold">My Training</h1></div>

        <section className="space-y-2">
          <h2 className="font-semibold">Assigned courses</h2>
          {(assigns?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No courses assigned.</p>}
          <div className="grid md:grid-cols-2 gap-3">
            {(assigns?.data ?? []).map(a => {
              const s = STATUS_LABELS[a.status] ?? { label: a.status, color: "bg-gray-100" };
              return (
                <div key={a.id} className="border rounded p-3 bg-card">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{a.courseTitle}</div>
                      <div className="text-xs text-muted-foreground">Pass mark: {a.passMarkPercent}% · Attempts: {a.attempts}{a.lastScore != null && ` · Last: ${a.lastScore}%`}</div>
                    </div>
                    <Badge className={s.color}>{s.label}</Badge>
                  </div>
                  <p className="text-sm mt-1">{a.courseDescription}</p>
                  {a.expiresAt && <p className="text-xs mt-1">Expires: {new Date(a.expiresAt).toLocaleDateString()}</p>}
                  {(a.status === "not_started" || a.status === "in_progress" || a.status === "rejected" || a.status === "expired") && (
                    <Button size="sm" className="mt-2" onClick={() => setActive(a)}><PlayCircle className="w-4 h-4 mr-1" />{a.status === "not_started" ? "Start" : "Continue"}</Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold flex items-center gap-2"><Award className="w-5 h-5" />Certificates</h2>
          {(certs?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No certificates yet.</p>}
          <div className="grid md:grid-cols-2 gap-3">
            {(certs?.data ?? []).map(c => (
              <div key={c.id} className="border rounded p-3 bg-card flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.courseTitle}</div>
                  <div className="text-xs text-muted-foreground">{c.certificateNumber} · Score {c.score}%</div>
                  <div className="text-xs">Issued {new Date(c.issuedAt).toLocaleDateString()}{c.expiresAt && ` · Expires ${new Date(c.expiresAt).toLocaleDateString()}`}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => downloadCertificate({ recipient: user?.name ?? "Staff", course: c.courseTitle, number: c.certificateNumber, score: c.score, issuedAt: c.issuedAt, expiresAt: c.expiresAt })}><FileDown className="w-4 h-4 mr-1" />PDF</Button>
              </div>
            ))}
          </div>
        </section>
      </div>
      {active && <CourseRunDialog assignment={active} onClose={() => setActive(null)} />}
    </Layout>
  );
}

function CourseRunDialog({ assignment, onClose }: { assignment: MyAssignment; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<CourseDetail>({ queryKey: ["course", assignment.courseId], queryFn: () => apiGet(`/sop-training/courses/${assignment.courseId}`) });
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const start = useMutation({ mutationFn: () => apiPost(`/sop-training/assignments/${assignment.id}/start`, {}) });
  const submit = useMutation({
    mutationFn: () => apiPost<{ passed: boolean; score: number; status: string }>(`/sop-training/assignments/${assignment.id}/attempt`, { answers }),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ["my-assigns"] });
      qc.invalidateQueries({ queryKey: ["my-certs"] });
      toast({ title: r.passed ? `Passed with ${r.score}%` : `Failed (${r.score}%) — try again`, variant: r.passed ? undefined : "destructive" });
      onClose();
    },
  });

  const totalSteps = (data?.modules.length ?? 0) + 1;
  const onQuiz = step >= (data?.modules.length ?? 0);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{assignment.courseTitle}</DialogTitle></DialogHeader>
        {isLoading || !data ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">Step {step + 1} of {totalSteps}</div>
            {!onQuiz && data.modules[step] && (
              <div className="space-y-2">
                <h3 className="font-semibold">{data.modules[step].title}</h3>
                {data.modules[step].videoUrl && (
                  <div className="aspect-video"><iframe className="w-full h-full" src={toEmbed(data.modules[step].videoUrl!)} allow="autoplay; encrypted-media" /></div>
                )}
                <p className="whitespace-pre-wrap text-sm">{data.modules[step].body}</p>
              </div>
            )}
            {onQuiz && (
              <div className="space-y-3">
                <h3 className="font-semibold">Quiz</h3>
                {data.questions.length === 0 ? <p className="text-sm text-muted-foreground">No quiz — submit to complete.</p> : data.questions.map((q, i) => (
                  <div key={q.id} className="border rounded p-2">
                    <div className="font-medium text-sm">{i + 1}. {q.question}</div>
                    <div className="space-y-1 mt-1">
                      {q.options.map((o, k) => (
                        <label key={k} className="flex items-center gap-2 text-sm">
                          <input type="radio" checked={answers[String(q.id)] === k} onChange={() => setAnswers(a => ({ ...a, [String(q.id)]: k }))} />{o}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => step > 0 ? setStep(step - 1) : onClose()}>{step > 0 ? "Back" : "Close"}</Button>
          {!onQuiz && (
            <Button onClick={() => { if (assignment.status === "not_started") start.mutate(); setStep(step + 1); }}>Next</Button>
          )}
          {onQuiz && <Button onClick={() => submit.mutate()} disabled={submit.isPending}>{submit.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}Submit quiz</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toEmbed(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) { const v = u.searchParams.get("v"); if (v) return `https://www.youtube.com/embed/${v}`; }
    if (u.hostname === "youtu.be") return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (u.hostname.includes("vimeo.com")) return `https://player.vimeo.com/video/${u.pathname.replace(/^\//, "")}`;
  } catch { /* ignore */ }
  return url;
}

function downloadCertificate(args: { recipient: string; course: string; number: string; score: number; issuedAt: string; expiresAt: string | null }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setDrawColor(190, 140, 30); doc.setLineWidth(6); doc.rect(20, 20, w - 40, h - 40);
  doc.setLineWidth(1); doc.rect(36, 36, w - 72, h - 72);
  doc.setFont("helvetica", "bold"); doc.setFontSize(34); doc.setTextColor(60, 50, 20);
  doc.text("Certificate of Completion", w / 2, 130, { align: "center" });
  doc.setFontSize(14); doc.setFont("helvetica", "normal"); doc.setTextColor(80);
  doc.text("This certifies that", w / 2, 180, { align: "center" });
  doc.setFontSize(28); doc.setFont("helvetica", "bold"); doc.setTextColor(20);
  doc.text(args.recipient, w / 2, 220, { align: "center" });
  doc.setFontSize(14); doc.setFont("helvetica", "normal"); doc.setTextColor(80);
  doc.text("has successfully completed the training course", w / 2, 260, { align: "center" });
  doc.setFontSize(20); doc.setFont("helvetica", "bold"); doc.setTextColor(20);
  doc.text(args.course, w / 2, 300, { align: "center" });
  doc.setFontSize(12); doc.setFont("helvetica", "normal"); doc.setTextColor(80);
  doc.text(`Score: ${args.score}%`, w / 2, 340, { align: "center" });
  doc.text(`Issued: ${new Date(args.issuedAt).toLocaleDateString()}`, w / 2, 360, { align: "center" });
  if (args.expiresAt) doc.text(`Valid until: ${new Date(args.expiresAt).toLocaleDateString()}`, w / 2, 380, { align: "center" });
  doc.setFontSize(10); doc.setTextColor(120);
  doc.text(`Certificate No: ${args.number}`, w / 2, h - 60, { align: "center" });
  doc.save(`${args.number}.pdf`);
}
