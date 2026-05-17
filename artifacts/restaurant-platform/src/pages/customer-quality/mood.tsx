import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Smile } from "lucide-react";
import { useMoodData, useCreateMood } from "@/lib/hooks-customer-quality";

const MOODS = [
  { key: "delighted", icon: "🤩", label: "Delighted" },
  { key: "happy", icon: "🙂", label: "Happy" },
  { key: "neutral", icon: "😐", label: "Neutral" },
  { key: "unhappy", icon: "🙁", label: "Unhappy" },
  { key: "angry", icon: "😡", label: "Angry" },
];

export default function MoodPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useMoodData(days);
  const create = useCreateMood();
  const summary = data?.summary ?? [];
  const responses = data?.responses ?? [];
  const lookup = Object.fromEntries(summary.map((s: any) => [s.mood, s.count]));

  return (
    <Layout>
      <PageHeader title="Guest Mood Tracker" description="Capture mood per visit, intervene on unhappy guests" icon={Smile}
        actions={
          <div className="flex gap-1">
            {[7, 30, 90].map(d => <Button key={d} size="sm" variant={d === days ? "default" : "outline"} onClick={() => setDays(d)}>{d}d</Button>)}
          </div>
        } />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Card><CardContent className="py-4"><div className="text-3xl font-bold">{data?.count ?? 0}</div><div className="text-sm text-muted-foreground">Total responses</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-3xl font-bold">{(data?.averageScore ?? 0).toFixed(2)}</div><div className="text-sm text-muted-foreground">Avg score (-2..+2)</div></CardContent></Card>
        <Card><CardContent className="py-4">
          <div className="text-sm text-muted-foreground mb-2">Quick capture</div>
          <div className="flex gap-2">
            {MOODS.map(m => (
              <button key={m.key} className="text-2xl hover:scale-125 transition" title={m.label}
                onClick={() => create.mutate({ mood: m.key, source: "manager" })}>{m.icon}</button>
            ))}
          </div>
        </CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Distribution</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {MOODS.map(m => (
              <div key={m.key} className="flex items-center gap-3">
                <span className="text-2xl">{m.icon}</span>
                <span className="w-24">{m.label}</span>
                <div className="flex-1 h-2 bg-muted rounded">
                  <div className="h-2 bg-primary rounded" style={{ width: `${data?.count ? (Number(lookup[m.key] ?? 0) / data.count) * 100 : 0}%` }} />
                </div>
                <span className="w-12 text-right text-sm">{lookup[m.key] ?? 0}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card className="mt-4">
        <CardHeader><CardTitle>Recent responses</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && responses.length === 0 && <p className="text-sm text-muted-foreground">No responses yet.</p>}
          <div className="divide-y">
            {responses.slice(0, 30).map((r: any) => {
              const m = MOODS.find(x => x.key === r.mood);
              return (
                <div key={r.id} className="py-2 flex items-center gap-3">
                  <span className="text-2xl">{m?.icon}</span>
                  <Badge variant="outline">{r.source}</Badge>
                  {r.comment && <span className="text-sm text-muted-foreground flex-1">{r.comment}</span>}
                  <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}
