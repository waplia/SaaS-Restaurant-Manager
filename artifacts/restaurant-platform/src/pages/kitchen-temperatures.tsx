import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Flame } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Log { id: number; deviceLabel: string; location: string | null; tempCelsius: string; minThreshold: string | null; maxThreshold: string | null; readingAt: string; alertSent: boolean; }
const LOCS = ["fridge", "freezer", "kitchen", "hot_hold", "other"];

export default function KitchenTemperaturesPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data = [] } = useQuery<Log[]>({ queryKey: ["kitchen", "temps", restaurantId], queryFn: () => apiGet(`/restaurants/${restaurantId}/kitchen/temperatures`) });
  const [form, setForm] = useState({ deviceLabel: "", location: "fridge", tempCelsius: "", minThreshold: "", maxThreshold: "" });
  const create = useMutation({
    mutationFn: () => apiPost(`/restaurants/${restaurantId}/kitchen/temperatures`, {
      deviceLabel: form.deviceLabel,
      location: form.location,
      tempCelsius: Number(form.tempCelsius),
      minThreshold: form.minThreshold ? Number(form.minThreshold) : undefined,
      maxThreshold: form.maxThreshold ? Number(form.maxThreshold) : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kitchen", "temps"] }); setForm({ ...form, tempCelsius: "" }); toast({ title: "Reading logged" }); },
  });
  return (
    <Layout>
      <PageHeader title="Temperature Log" subtitle="Fridge / freezer / hot-hold readings" icon={Flame} />
      <div className="p-6 space-y-6">
        <Card><CardContent className="p-4 space-y-3">
          <h3 className="font-semibold">Log reading</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Input placeholder="Device label" value={form.deviceLabel} onChange={e => setForm({ ...form, deviceLabel: e.target.value })} />
            <Select value={form.location} onValueChange={v => setForm({ ...form, location: v })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{LOCS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select>
            <Input type="number" placeholder="Temp °C" value={form.tempCelsius} onChange={e => setForm({ ...form, tempCelsius: e.target.value })} />
            <Input type="number" placeholder="Min °C" value={form.minThreshold} onChange={e => setForm({ ...form, minThreshold: e.target.value })} />
            <Input type="number" placeholder="Max °C" value={form.maxThreshold} onChange={e => setForm({ ...form, maxThreshold: e.target.value })} />
          </div>
          <Button onClick={() => create.mutate()} disabled={!form.deviceLabel || !form.tempCelsius}>Log reading</Button>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <h3 className="font-semibold mb-3">Recent readings</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b"><th>Device</th><th>Loc</th><th>Temp</th><th>Range</th><th>When</th></tr></thead>
            <tbody>
              {data.map(l => (
                <tr key={l.id} className={`border-b ${l.alertSent ? "bg-red-50" : ""}`}>
                  <td className="py-1">{l.deviceLabel}</td><td>{l.location}</td>
                  <td><Badge variant={l.alertSent ? "destructive" : "outline"}>{l.tempCelsius}°C</Badge></td>
                  <td className="text-muted-foreground">{l.minThreshold ?? "-"} / {l.maxThreshold ?? "-"}</td>
                  <td className="text-xs text-muted-foreground">{new Date(l.readingAt).toLocaleString()}</td>
                </tr>
              ))}
              {data.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground text-center">No readings.</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      </div>
    </Layout>
  );
}
