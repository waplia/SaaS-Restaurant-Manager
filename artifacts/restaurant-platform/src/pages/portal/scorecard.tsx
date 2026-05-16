import { useQuery } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { TrendingUp, Star } from "lucide-react";

interface Scorecard {
  sinceDays: number;
  attendance: { totalDays: number; present: number; absent: number; totalLate: number; totalOvertime: number; totalWorked: number; score: number };
  punctuality: { totalLate: number; score: number };
  tasks: { total: number; done: number; onTime: number; score: number };
  rating: { count: number; average: number | null };
  overall: number;
  notes: Array<{ id: number; rating: number | null; body: string; createdAt: string }>;
}

export default function PortalScorecardPage() {
  const { data } = useQuery<Scorecard>({ queryKey: ["portal-scorecard-full"], queryFn: () => apiFetch("/portal/scorecard?days=90") });

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2"><TrendingUp className="w-6 h-6" />Performance</h1>
        <p className="text-xs text-muted-foreground">Last {data?.sinceDays ?? 90} days</p>

        {data && (
          <>
            <Card><CardContent className="p-5 text-center">
              <p className="text-xs text-muted-foreground uppercase">Overall score</p>
              <p className="text-5xl font-bold text-primary">{data.overall}</p>
              <p className="text-xs text-muted-foreground">out of 100</p>
            </CardContent></Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Stat label="Attendance" score={data.attendance.score}
                detail={`${data.attendance.present}/${data.attendance.totalDays} days · ${data.attendance.absent} absent`} />
              <Stat label="Punctuality" score={data.punctuality.score}
                detail={`${data.punctuality.totalLate} mins late total`} />
              <Stat label="Tasks" score={data.tasks.score}
                detail={`${data.tasks.done}/${data.tasks.total} done · ${data.tasks.onTime} on time`} />
            </div>

            <Card><CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium flex items-center gap-2"><Star className="w-4 h-4" />Manager rating</p>
                {data.rating.average ? (
                  <Badge>{data.rating.average.toFixed(1)} / 5 ({data.rating.count})</Badge>
                ) : <span className="text-xs text-muted-foreground">No ratings yet</span>}
              </div>
            </CardContent></Card>

            {data.notes.length > 0 && (
              <section>
                <h2 className="font-semibold mb-2 text-sm">Recent feedback</h2>
                <div className="space-y-2">
                  {data.notes.map(n => (
                    <Card key={n.id}><CardContent className="p-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{new Date(n.createdAt).toLocaleDateString()}</span>
                        {n.rating && <Badge variant="outline">{n.rating}/5</Badge>}
                      </div>
                      <p className="text-sm mt-1">{n.body}</p>
                    </CardContent></Card>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </PortalLayout>
  );
}

function Stat({ label, score, detail }: { label: string; score: number; detail: string }) {
  const color = score >= 80 ? "text-emerald-600" : score >= 60 ? "text-amber-600" : "text-red-600";
  return (
    <Card><CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{score}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </CardContent></Card>
  );
}
