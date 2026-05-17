/**
 * Tenant-facing implementation/go-live checklist (Task #435).
 *
 * Restaurant owners + managers see the same checklist the assigned
 * onboarding manager works from: per-step progress + owner + due date,
 * the planned go-live date, and (once launched) the week 1/2/4
 * post-launch follow-ups.
 *
 * Gated on the `dedicated_implementation` plan feature — restaurants on
 * lower plans get an upsell card pointing them at the standard setup wizard.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Circle, AlertOctagon, Loader2, ArrowRight, CalendarClock,
  User as UserIcon, ShieldCheck, ExternalLink, Rocket,
} from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { apiFetch, apiAction } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type StepStatus = "not_started" | "in_progress" | "blocked" | "complete" | "skipped";
type Step = {
  id: number; stepKey: string; title: string; description: string | null;
  ownerType: "restaurant" | "manager"; ownerUserId: number | null;
  status: StepStatus; progressPct: number;
  dueDate: string | null; completedAt: string | null; lastActivityAt: string;
};
type PostLaunchTask = { id: number; weekOffset: number; title: string; description: string | null; dueDate: string; completedAt: string | null };
type Manager = { id: number; name: string; email: string } | null;
type Payload = {
  entitled: boolean;
  implementation: { id: number; status: string; goLiveDate: string | null; launchedAt: string | null; notes: string | null; slaHours: number };
  steps: Step[]; postLaunchTasks: PostLaunchTask[]; manager: Manager; progressPct: number;
};

const STATUS_LABEL: Record<StepStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  complete: "Complete",
  skipped: "Skipped",
};
const STATUS_PILL: Record<StepStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  blocked: "bg-destructive/15 text-destructive",
  complete: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  skipped: "bg-muted text-muted-foreground line-through",
};

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function SetupOnboardingPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Payload>({
    queryKey: ["implementations", "me"],
    queryFn: () => apiFetch("/implementations/me"),
  });

  const updateStep = useMutation({
    mutationFn: ({ stepId, body }: { stepId: number; body: Partial<{ status: StepStatus; progressPct: number }> }) =>
      apiAction(`/implementations/me/steps/${stepId}`, "PATCH", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["implementations", "me"] });
      toast({ title: "Checklist updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-5xl mx-auto p-6 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading implementation…
        </div>
      </Layout>
    );
  }

  if (!data) {
    return (
      <Layout>
        <div className="max-w-5xl mx-auto p-6 text-sm text-muted-foreground">No data.</div>
      </Layout>
    );
  }

  if (!data.entitled) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto p-6 space-y-4">
          <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Dedicated implementation</h1>
                <p className="text-sm text-muted-foreground">Available on the Enterprise plan</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Enterprise customers get a hands-on onboarding manager who runs a structured go-live
              checklist with SLA timers and week 1/2/4 post-launch check-ins. In the meantime, the
              standard setup wizard covers everything you need to get live yourself.
            </p>
            <div className="flex gap-2">
              <Link href="/setup-wizard" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Open Setup Wizard <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <Link href="/pricing" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground hover:underline">
                See Enterprise plan <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const { implementation, steps, postLaunchTasks, manager, progressPct } = data;
  const launched = !!implementation.launchedAt;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start gap-4 justify-between">
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <Rocket className="w-5 h-5 text-primary" /> Implementation & Go-Live
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your dedicated onboarding manager works through this checklist with you. Update
                progress as you finish each step.
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Overall progress</div>
              <div className="text-2xl font-bold">{progressPct}%</div>
              <div className="w-40 h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5 text-sm">
            <div className="flex items-center gap-2">
              <UserIcon className="w-4 h-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Onboarding manager</div>
                <div className="font-medium">{manager ? `${manager.name} (${manager.email})` : "Not assigned yet"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Target go-live</div>
                <div className="font-medium">{fmtDate(implementation.goLiveDate)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-muted-foreground" />
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <div className="font-medium capitalize">{implementation.status.replace("_", " ")}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Checklist */}
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          <div className="px-5 py-3 text-sm font-semibold">Go-live checklist</div>
          {steps.map(step => {
            const isDone = step.status === "complete" || step.status === "skipped";
            const Icon = isDone ? CheckCircle2 : step.status === "blocked" ? AlertOctagon : Circle;
            const iconCls =
              isDone ? "text-emerald-600" : step.status === "blocked" ? "text-destructive" : "text-muted-foreground";
            return (
              <div key={step.id} className="px-5 py-4 flex flex-wrap items-start gap-4">
                <Icon className={`w-5 h-5 mt-0.5 ${iconCls}`} />
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{step.title}</span>
                    <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${STATUS_PILL[step.status]}`}>
                      {STATUS_LABEL[step.status]}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      Owner: {step.ownerType}
                    </span>
                  </div>
                  {step.description && (
                    <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    {step.dueDate && <span>Due {fmtDate(step.dueDate)}</span>}
                    <span>Progress {step.status === "complete" ? 100 : step.progressPct}%</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="text-xs border border-border rounded-md px-2 py-1 bg-background"
                    value={step.status}
                    disabled={updateStep.isPending}
                    onChange={e => updateStep.mutate({ stepId: step.id, body: { status: e.target.value as StepStatus } })}
                  >
                    {(["not_started", "in_progress", "blocked", "complete", "skipped"] as StepStatus[]).map(s => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  {!isDone && (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="text-xs border border-border rounded-md px-2 py-1 bg-background w-16"
                      value={step.progressPct}
                      onChange={e => updateStep.mutate({ stepId: step.id, body: { progressPct: Math.max(0, Math.min(100, Number(e.target.value))) } })}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Post-launch tasks */}
        {launched && postLaunchTasks.length > 0 && (
          <div className="rounded-xl border border-border bg-card">
            <div className="px-5 py-3 text-sm font-semibold border-b border-border">Post-launch follow-ups</div>
            <ul className="divide-y divide-border">
              {postLaunchTasks.map(t => (
                <li key={t.id} className="px-5 py-3 flex items-start gap-3">
                  {t.completedAt
                    ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600" />
                    : <Circle className="w-4 h-4 mt-0.5 text-muted-foreground" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">Week {t.weekOffset}: {t.title}</div>
                    {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                    <div className="text-xs text-muted-foreground mt-1">Due {fmtDate(t.dueDate)}{t.completedAt ? ` · Completed ${fmtDate(t.completedAt)}` : ""}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Layout>
  );
}
