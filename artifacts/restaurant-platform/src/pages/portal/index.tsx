import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Clock, CalendarDays, Wallet, ListChecks, Megaphone, TrendingUp, Award } from "lucide-react";

interface Active { id: number; clockIn: string }
interface Announcement { id: number; title: string; priority: string; publishedAt: string; read: boolean }
interface Task { id: number; title: string; status: string; dueAt: string | null; priority: string }
interface Scorecard { overall: number; attendance: { score: number; present: number; totalDays: number }; tasks: { score: number; done: number; total: number }; rating: { average: number | null } }
interface Incentives { totals: { earned: number; pending: number } }

export default function PortalHomePage() {
  const { user } = useAuth();
  const { data: active } = useQuery<Active | null>({ queryKey: ["portal-active"], queryFn: () => apiGet("/portal/attendance/active") });
  const { data: announcements = [] } = useQuery<Announcement[]>({ queryKey: ["portal-announcements"], queryFn: () => apiGet("/portal/announcements") });
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["portal-tasks"], queryFn: () => apiGet("/portal/tasks?status=open") });
  const { data: scorecard } = useQuery<Scorecard>({ queryKey: ["portal-scorecard"], queryFn: () => apiGet("/portal/scorecard") });
  const { data: incentives } = useQuery<Incentives>({ queryKey: ["portal-incentives"], queryFn: () => apiGet("/portal/incentives") });

  const unread = announcements.filter(a => !a.read).length;
  const openTasks = tasks.length;

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Hi {user?.name?.split(" ")[0] ?? "there"} 👋</h1>
          <p className="text-sm text-muted-foreground">Here's your snapshot for today.</p>
        </div>

        {/* Status row */}
        <Card>
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium">{active ? "You are clocked in" : "You are not clocked in"}</p>
                {active && <p className="text-xs text-muted-foreground">Since {new Date(active.clockIn).toLocaleTimeString()}</p>}
              </div>
            </div>
            <Link href="/portal/attendance" className="text-sm text-primary font-medium" data-testid="link-attendance">
              {active ? "Clock out →" : "Clock in →"}
            </Link>
          </CardContent>
        </Card>

        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="Performance" value={`${scorecard?.overall ?? 0}`} suffix="/100" href="/portal/scorecard" />
          <KpiCard icon={<ListChecks className="w-5 h-5" />} label="Open tasks" value={`${openTasks}`} href="/portal/tasks" />
          <KpiCard icon={<Megaphone className="w-5 h-5" />} label="Unread news" value={`${unread}`} href="/portal/announcements" />
          <KpiCard icon={<Award className="w-5 h-5" />} label="Incentives" value={`₹${(incentives?.totals.earned ?? 0).toFixed(0)}`} href="/portal/incentives" />
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickLink href="/portal/shifts" icon={<CalendarDays className="w-5 h-5" />} label="My Shifts" />
          <QuickLink href="/portal/leaves" icon={<CalendarDays className="w-5 h-5" />} label="Apply leave" />
          <QuickLink href="/portal/payroll" icon={<Wallet className="w-5 h-5" />} label="Payslips" />
          <QuickLink href="/portal/training" icon={<TrendingUp className="w-5 h-5" />} label="Training" />
        </div>

        {/* Latest announcements */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Latest announcements</h2>
            <Link href="/portal/announcements" className="text-xs text-primary">View all</Link>
          </div>
          {announcements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No announcements yet.</p>
          ) : (
            <div className="space-y-2">
              {announcements.slice(0, 3).map(a => (
                <Link key={a.id} href="/portal/announcements">
                  <div className="border rounded-lg p-3 bg-card flex items-start justify-between gap-3 hover:bg-accent/40">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{a.title}</p>
                        {a.priority !== "normal" && <Badge variant={a.priority === "urgent" ? "destructive" : "secondary"} className="text-[10px]">{a.priority}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{new Date(a.publishedAt).toLocaleString()}</p>
                    </div>
                    {!a.read && <span className="w-2 h-2 rounded-full bg-primary mt-2" />}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </PortalLayout>
  );
}

function KpiCard({ icon, label, value, suffix, href }: { icon: React.ReactNode; label: string; value: string; suffix?: string; href: string }) {
  return (
    <Link href={href}>
      <Card className="hover:bg-accent/40 transition cursor-pointer h-full">
        <CardContent className="p-3 md:p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon}<span>{label}</span></div>
          <p className="text-2xl font-bold mt-1">{value}<span className="text-sm text-muted-foreground font-normal">{suffix}</span></p>
        </CardContent>
      </Card>
    </Link>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href}>
      <Card className="hover:bg-accent/40 transition cursor-pointer h-full">
        <CardContent className="p-3 md:p-4 flex flex-col items-center text-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
          <p className="text-xs md:text-sm font-medium">{label}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
