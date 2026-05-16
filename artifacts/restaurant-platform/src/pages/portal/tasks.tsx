import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ListChecks, CheckCircle2, Clock } from "lucide-react";

interface Task { id: number; title: string; description: string | null; priority: string; status: string; dueAt: string | null; recurrence: string; completedAt: string | null }

export default function PortalTasksPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["portal-tasks-all"], queryFn: () => apiFetch("/portal/tasks") });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiPost(`/portal/tasks/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-tasks-all"] });
      qc.invalidateQueries({ queryKey: ["portal-tasks"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const open = tasks.filter(t => t.status === "open" || t.status === "in_progress");
  const done = tasks.filter(t => t.status === "done");

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2"><ListChecks className="w-6 h-6" />Tasks</h1>

        <section>
          <h2 className="font-semibold mb-2 text-sm">Open ({open.length})</h2>
          {open.length === 0 ? <p className="text-sm text-muted-foreground">No open tasks. 🎉</p> : (
            <div className="space-y-2">
              {open.map(t => (
                <Card key={t.id}><CardContent className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{t.title}</p>
                      {t.priority !== "normal" && <Badge variant={t.priority === "high" ? "destructive" : "secondary"} className="text-[10px]">{t.priority}</Badge>}
                      {t.recurrence !== "none" && <Badge variant="outline" className="text-[10px]">{t.recurrence}</Badge>}
                    </div>
                    {t.description && <p className="text-xs text-muted-foreground mt-1">{t.description}</p>}
                    {t.dueAt && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Clock className="w-3 h-3" />Due {new Date(t.dueAt).toLocaleString()}</p>}
                  </div>
                  <div className="flex flex-col gap-1">
                    {t.status === "open" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: t.id, status: "in_progress" })} data-testid={`btn-start-${t.id}`}>Start</Button>}
                    <Button size="sm" onClick={() => setStatus.mutate({ id: t.id, status: "done" })} data-testid={`btn-done-${t.id}`}><CheckCircle2 className="w-4 h-4 mr-1" />Done</Button>
                  </div>
                </CardContent></Card>
              ))}
            </div>
          )}
        </section>

        {done.length > 0 && (
          <section>
            <h2 className="font-semibold mb-2 text-sm">Recently completed</h2>
            <div className="space-y-2">
              {done.slice(0, 8).map(t => (
                <Card key={t.id}><CardContent className="p-3 flex items-center justify-between text-sm">
                  <span className="line-through text-muted-foreground">{t.title}</span>
                  <span className="text-xs text-muted-foreground">{t.completedAt && new Date(t.completedAt).toLocaleDateString()}</span>
                </CardContent></Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </PortalLayout>
  );
}
