import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiPatch, apiDelete, apiPut } from "@/lib/api";

function base(restaurantId: number) {
  return `/restaurants/${restaurantId}/advanced-growth`;
}

type UseApiOptions = { enabled?: boolean; refetchInterval?: number };
function useApi<T>(key: any[], path: string, options: boolean | UseApiOptions = true) {
  const opts: UseApiOptions = typeof options === "boolean" ? { enabled: options } : options;
  return useQuery<T>({
    queryKey: key,
    queryFn: () => apiGet<T>(path),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchInterval ?? 15000,
  });
}

// 1. LOCAL AREA MARKETING MAP
export function LocalMapPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useApi<{ items: any[] }>(["geo-points", rid], `${base(rid)}/geo-points`);
  const [form, setForm] = useState({ label: "", lat: "", lng: "" });
  const create = useMutation({
    mutationFn: () => apiPost(`${base(rid)}/geo-points`, { label: form.label, lat: Number(form.lat), lng: Number(form.lng) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["geo-points", rid] }); setForm({ label: "", lat: "", lng: "" }); toast({ title: "Point added" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`${base(rid)}/geo-points/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["geo-points", rid] }),
  });
  const [areas, setAreas] = useState<Array<{ lat: number; lng: number; count: number }>>([]);
  const loadAreas = useMutation({
    mutationFn: () => apiGet<{ areas: Array<{ lat: number; lng: number; count: number }> }>(`${base(rid)}/geo-points/areas`),
    onSuccess: (data) => { setAreas(data?.areas ?? []); toast({ title: `Found ${data?.areas?.length ?? 0} heat cells`, description: "Sized by customer density — target your largest cells first." }); },
    onError: (e: any) => toast({ title: "Heat map failed", description: e.message, variant: "destructive" }),
  });
  const exportSegment = useMutation({
    mutationFn: async () => {
      const lats = items.map((p: any) => Number(p.lat)).filter((n: number) => Number.isFinite(n));
      const lngs = items.map((p: any) => Number(p.lng)).filter((n: number) => Number.isFinite(n));
      if (lats.length === 0 || lngs.length === 0) throw new Error("Add at least one point first.");
      const bbox = { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
      return apiPost<{ customerIds: number[] }>(`${base(rid)}/geo-points/export-segment`, bbox);
    },
    onSuccess: (data) => toast({ title: "Segment exported", description: `${data?.customerIds?.length ?? 0} customers inside current bounding box — saved to audit log.` }),
    onError: (e: any) => toast({ title: "Export failed", description: e.message, variant: "destructive" }),
  });
  const items = data?.items ?? [];
  return (
    <Layout>
      <PageHeader title="Local Customer Map" description="Map customer locations to spot dense areas for local marketing pushes." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Add point</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label>Label</Label><Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></div>
            <div><Label>Lat</Label><Input value={form.lat} onChange={e => setForm({ ...form, lat: e.target.value })} placeholder="19.0760" /></div>
            <div><Label>Lng</Label><Input value={form.lng} onChange={e => setForm({ ...form, lng: e.target.value })} placeholder="72.8777" /></div>
            <Button onClick={() => create.mutate()} disabled={!form.lat || !form.lng || create.isPending}>Add point</Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Points ({items.length})</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={loadAreas.isPending} onClick={() => loadAreas.mutate()}>
                {loadAreas.isPending ? "Loading…" : "Show heat areas"}
              </Button>
              <Button size="sm" disabled={exportSegment.isPending || items.length === 0} onClick={() => exportSegment.mutate()}>
                {exportSegment.isPending ? "Exporting…" : "Export segment"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative bg-muted/30 rounded h-64 mb-3 overflow-hidden">
              {areas.map((a, i) => (
                <div key={`heat-${i}`} title={`${a.count} customers near ${a.lat.toFixed(2)}, ${a.lng.toFixed(2)}`}
                  className="absolute rounded-full bg-orange-500/30 border border-orange-500/60"
                  style={{
                    left: `${Math.min(95, Math.max(0, (a.lng % 1) * 100))}%`,
                    top: `${Math.min(95, Math.max(0, (a.lat % 1) * 100))}%`,
                    width: `${Math.min(60, 12 + a.count * 4)}px`,
                    height: `${Math.min(60, 12 + a.count * 4)}px`,
                    transform: "translate(-50%, -50%)",
                  }} />
              ))}
              {items.map((p: any) => (
                <div key={p.id} title={p.label ?? `(${p.lat},${p.lng})`}
                  className="absolute h-3 w-3 rounded-full bg-primary border-2 border-background"
                  style={{ left: `${Math.min(95, Math.max(0, (Number(p.lng) % 1) * 100))}%`, top: `${Math.min(95, Math.max(0, (Number(p.lat) % 1) * 100))}%` }} />
              ))}
              <span className="absolute bottom-2 right-3 text-xs text-muted-foreground">Lat/Lng schematic{areas.length > 0 ? ` · ${areas.length} heat cells` : ""}</span>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Label</TableHead><TableHead>Lat</TableHead><TableHead>Lng</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.label ?? "—"}</TableCell><TableCell>{p.lat}</TableCell><TableCell>{p.lng}</TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => del.mutate(p.id)}>Remove</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

// 2. FESTIVAL CALENDAR
export function FestivalCalendarPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useApi<{ items: any[] }>(["festivals", rid], `${base(rid)}/festivals`);
  const [form, setForm] = useState({ name: "", eventDate: "", suggestedCampaign: "" });
  const create = useMutation({
    mutationFn: () => apiPost(`${base(rid)}/festivals`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["festivals", rid] }); setForm({ name: "", eventDate: "", suggestedCampaign: "" }); toast({ title: "Festival added" }); },
  });
  const dismiss = useMutation({
    mutationFn: (id: number) => apiPatch(`${base(rid)}/festivals/${id}`, { isDismissed: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["festivals", rid] }),
  });
  const plan = useMutation({
    mutationFn: (id: number) => apiPost<{ campaign: { id: number; name: string } }>(`${base(rid)}/festivals/${id}/draft-campaign`),
    onSuccess: (data) => toast({ title: "Campaign drafted", description: `${data?.campaign?.name ?? "Draft"} created — open Campaigns to refine and schedule.` }),
    onError: (e: any) => toast({ title: "Couldn't draft campaign", description: e.message, variant: "destructive" }),
  });
  const items = data?.items ?? [];
  return (
    <Layout>
      <PageHeader title="Festival Calendar" description="Track upcoming festivals and plan campaign offers around them." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Add festival</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Date</Label><Input type="date" value={form.eventDate} onChange={e => setForm({ ...form, eventDate: e.target.value })} /></div>
            <div><Label>Suggested campaign</Label><Textarea value={form.suggestedCampaign} onChange={e => setForm({ ...form, suggestedCampaign: e.target.value })} /></div>
            <Button onClick={() => create.mutate()} disabled={!form.name || !form.eventDate || create.isPending}>Add</Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Upcoming</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Festival</TableHead><TableHead>Campaign</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((f: any) => (
                  <TableRow key={f.id}>
                    <TableCell>{f.eventDate}</TableCell>
                    <TableCell>{f.name}</TableCell>
                    <TableCell className="max-w-xs truncate">{f.suggestedCampaign ?? "—"}</TableCell>
                    <TableCell>{f.isDismissed ? <Badge variant="secondary">Dismissed</Badge> : <Badge>Active</Badge>}</TableCell>
                    <TableCell className="space-x-1">
                      {!f.isDismissed && (
                        <Button size="sm" variant="default" disabled={plan.isPending} onClick={() => plan.mutate(f.id)}>
                          Plan campaign
                        </Button>
                      )}
                      {!f.isDismissed && <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(f.id)}>Dismiss</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

// 3. OFFER CONFLICT DETECTOR
export function OfferConflictsPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { data } = useApi<{ items: any[] }>(["offer-conflicts", rid], `${base(rid)}/offer-conflicts`);
  const run = useMutation({
    mutationFn: () => apiPost(`${base(rid)}/offer-conflicts/run`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offer-conflicts", rid] }),
  });
  const items = data?.items ?? [];
  const latest = items[0];
  return (
    <Layout>
      <PageHeader title="Offer Conflict Detector"
        description="Check active coupons and pricing rules for overlaps that may stack or compete." />
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Latest check</CardTitle>
            <Button onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? "Running…" : "Run check now"}</Button>
          </CardHeader>
          <CardContent>
            {latest ? (
              <>
                <p className="text-sm text-muted-foreground mb-2">
                  Run {new Date(latest.createdAt).toLocaleString()} — {latest.conflictCount} conflict(s)
                </p>
                <Table>
                  <TableHeader><TableRow><TableHead>Kind</TableHead><TableHead>A</TableHead><TableHead>B</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(latest.conflicts ?? []).map((c: any, i: number) => (
                      <TableRow key={i}><TableCell><Badge variant="outline">{c.kind}</Badge></TableCell><TableCell>{c.a}</TableCell><TableCell>{c.b}</TableCell><TableCell>{c.reason}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : <p className="text-sm text-muted-foreground">No checks yet — click "Run check now".</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>History</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Conflicts</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((r: any) => (
                  <TableRow key={r.id}><TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell><TableCell>{r.conflictCount}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

// 4. MARGIN GUARDRAILS
export function MarginFloorsPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useApi<{ items: any[] }>(["margin-floors", rid], `${base(rid)}/margin-floors`);
  const [form, setForm] = useState({ scope: "global", minMarginPct: "20", action: "warn" });
  const create = useMutation({
    mutationFn: () => apiPost(`${base(rid)}/margin-floors`, { ...form, minMarginPct: Number(form.minMarginPct) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["margin-floors", rid] }); toast({ title: "Floor added" }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => apiDelete(`${base(rid)}/margin-floors/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["margin-floors", rid] }),
  });
  const items = data?.items ?? [];
  return (
    <Layout>
      <PageHeader title="Margin Floors" description="Block or warn when discounts would push an item below the configured margin." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Add floor rule</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label>Scope</Label>
              <Select value={form.scope} onValueChange={v => setForm({ ...form, scope: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="category">Category</SelectItem>
                  <SelectItem value="item">Item</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Minimum margin %</Label><Input type="number" value={form.minMarginPct} onChange={e => setForm({ ...form, minMarginPct: e.target.value })} /></div>
            <div><Label>Action</Label>
              <Select value={form.action} onValueChange={v => setForm({ ...form, action: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="block">Block</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>Add</Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Active rules</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Scope</TableHead><TableHead>Min margin</TableHead><TableHead>Action</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.scope}</TableCell>
                    <TableCell>{r.minMarginPct}%</TableCell>
                    <TableCell><Badge variant={r.action === "block" ? "destructive" : "secondary"}>{r.action}</Badge></TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}>Delete</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

// 5. SMART UPSELL SCRIPT
export function UpsellProPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useApi<{ scripts: any[] }>(["upsell-scripts", rid], `${base(rid)}/upsell-scripts`);
  const log = useMutation({
    mutationFn: (vars: { scriptKey: string; outcome: string; amountRupees?: number }) => apiPost(`${base(rid)}/upsell-events`, vars),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["upsell-scripts", rid] }); toast({ title: "Logged" }); },
  });
  const scripts = data?.scripts ?? [];
  return (
    <Layout>
      <PageHeader title="Smart Upsell Scripts" description="Field-tested lines waiters can use, with per-line acceptance tracking." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scripts.map((s: any) => (
          <Card key={s.key}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">{s.title}
                <Badge variant="outline">{s.stats.accepted}/{s.stats.total} accepted</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="italic text-sm mb-3">"{s.line}"</p>
              <p className="text-xs text-muted-foreground mb-3">Attributed revenue: ₹{Number(s.stats.revenue ?? 0).toFixed(2)}</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={() => log.mutate({ scriptKey: s.key, outcome: "accepted", amountRupees: 100 })}>Mark accepted</Button>
                <Button size="sm" variant="outline" onClick={() => log.mutate({ scriptKey: s.key, outcome: "declined" })}>Mark declined</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </Layout>
  );
}

// 6. QUEUE MANAGEMENT FOR TAKEAWAY
export function QueueManagerPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { data } = useApi<{ items: any[] }>(["queue", rid], `${base(rid)}/queue`);
  const [form, setForm] = useState({ customerName: "", phone: "", partySize: 1, estimatedMinutes: 15 });
  const create = useMutation({
    mutationFn: () => apiPost(`${base(rid)}/queue`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["queue", rid] }); setForm({ customerName: "", phone: "", partySize: 1, estimatedMinutes: 15 }); },
  });
  const update = useMutation({
    mutationFn: (v: { id: number; status: string }) => apiPatch(`${base(rid)}/queue/${v.id}`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue", rid] }),
  });
  const items = data?.items ?? [];
  return (
    <Layout>
      <PageHeader title="Takeaway Queue" description="Number-based queue for takeaway pickups, with notify and fulfil flow." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Add ticket</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label>Name</Label><Input value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Party size</Label><Input type="number" value={form.partySize} onChange={e => setForm({ ...form, partySize: Number(e.target.value) })} /></div>
            <div><Label>ETA (mins)</Label><Input type="number" value={form.estimatedMinutes} onChange={e => setForm({ ...form, estimatedMinutes: Number(e.target.value) })} /></div>
            <Button onClick={() => create.mutate()} disabled={!form.customerName || create.isPending}>Issue ticket</Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Active queue</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Name</TableHead><TableHead>ETA</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono">{t.ticketNumber}</TableCell>
                    <TableCell>{t.customerName}<div className="text-xs text-muted-foreground">{t.phone}</div></TableCell>
                    <TableCell>{t.estimatedMinutes}m</TableCell>
                    <TableCell><Badge variant={t.status === "fulfilled" ? "secondary" : t.status === "cancelled" ? "destructive" : "default"}>{t.status}</Badge></TableCell>
                    <TableCell className="space-x-1">
                      {t.status === "waiting" && <Button size="sm" onClick={() => update.mutate({ id: t.id, status: "notified" })}>Notify</Button>}
                      {(t.status === "waiting" || t.status === "notified") && <Button size="sm" variant="outline" onClick={() => update.mutate({ id: t.id, status: "fulfilled" })}>Fulfil</Button>}
                      {(t.status === "waiting" || t.status === "notified") && <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: t.id, status: "cancelled" })}>Cancel</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

// 7. PRE-ORDER SCHEDULING
export function PreorderPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { data: slotsData } = useApi<{ items: any[] }>(["preorder-slots", rid], `${base(rid)}/preorder-slots?from=${new Date().toISOString().slice(0, 10)}`);
  const { data: bkData } = useApi<{ items: any[] }>(["preorder-bookings", rid], `${base(rid)}/preorder-bookings`);
  const [slotForm, setSlotForm] = useState({ slotDate: "", startMinutes: "12:00", endMinutes: "13:00", capacity: 10 });
  const [bkForm, setBkForm] = useState({ slotId: "", customerName: "", phone: "" });
  const createSlot = useMutation({
    mutationFn: () => {
      const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
      return apiPost(`${base(rid)}/preorder-slots`, { slotDate: slotForm.slotDate, startMinutes: toMin(slotForm.startMinutes), endMinutes: toMin(slotForm.endMinutes), capacity: slotForm.capacity });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preorder-slots", rid] }),
  });
  const createBooking = useMutation({
    mutationFn: () => apiPost(`${base(rid)}/preorder-bookings`, { slotId: Number(bkForm.slotId), customerName: bkForm.customerName, phone: bkForm.phone }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["preorder-bookings", rid] }); qc.invalidateQueries({ queryKey: ["preorder-slots", rid] }); },
  });
  const slots = slotsData?.items ?? [];
  const bookings = bkData?.items ?? [];
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return (
    <Layout>
      <PageHeader title="Pre-Order Scheduling" description="Open delivery time-slots and let customers book pickup windows." />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Create slot</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label>Date</Label><Input type="date" value={slotForm.slotDate} onChange={e => setSlotForm({ ...slotForm, slotDate: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Start</Label><Input type="time" value={slotForm.startMinutes} onChange={e => setSlotForm({ ...slotForm, startMinutes: e.target.value })} /></div>
              <div><Label>End</Label><Input type="time" value={slotForm.endMinutes} onChange={e => setSlotForm({ ...slotForm, endMinutes: e.target.value })} /></div>
            </div>
            <div><Label>Capacity</Label><Input type="number" value={slotForm.capacity} onChange={e => setSlotForm({ ...slotForm, capacity: Number(e.target.value) })} /></div>
            <Button onClick={() => createSlot.mutate()} disabled={!slotForm.slotDate || createSlot.isPending}>Create slot</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Book customer into slot</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label>Slot</Label>
              <Select value={bkForm.slotId} onValueChange={v => setBkForm({ ...bkForm, slotId: v })}>
                <SelectTrigger><SelectValue placeholder="Pick a slot" /></SelectTrigger>
                <SelectContent>{slots.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.slotDate} {fmt(s.startMinutes)}–{fmt(s.endMinutes)} ({s.bookedCount}/{s.capacity})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Customer</Label><Input value={bkForm.customerName} onChange={e => setBkForm({ ...bkForm, customerName: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={bkForm.phone} onChange={e => setBkForm({ ...bkForm, phone: e.target.value })} /></div>
            <Button onClick={() => createBooking.mutate()} disabled={!bkForm.slotId || !bkForm.customerName || createBooking.isPending}>Book</Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Upcoming bookings</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Slot</TableHead><TableHead>Customer</TableHead><TableHead>Phone</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {bookings.map((b: any) => {
                  const s = slots.find((x: any) => x.id === b.slotId);
                  return <TableRow key={b.id}><TableCell>{s ? `${s.slotDate} ${fmt(s.startMinutes)}` : `#${b.slotId}`}</TableCell><TableCell>{b.customerName}</TableCell><TableCell>{b.phone ?? "—"}</TableCell><TableCell>{b.status}</TableCell></TableRow>;
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

// 8. DELIVERY ZONE PROFITABILITY
export function ZoneProfitabilityPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { data: zones } = useApi<{ items: any[] }>(["zones", rid], `${base(rid)}/zones`);
  const { data: metrics } = useApi<{ items: any[] }>(["zone-metrics", rid], `${base(rid)}/zones/metrics`);
  const [form, setForm] = useState({ name: "", pincodes: "", baseFeeRupees: "30", minOrderRupees: "200" });
  const create = useMutation({
    mutationFn: () => apiPost(`${base(rid)}/zones`, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["zones", rid] }); setForm({ name: "", pincodes: "", baseFeeRupees: "30", minOrderRupees: "200" }); },
  });
  const recompute = useMutation({
    mutationFn: () => apiPost(`${base(rid)}/zones/recompute`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zone-metrics", rid] }),
  });
  return (
    <Layout>
      <PageHeader title="Delivery Zone Profitability" description="Define zones and recompute revenue, cost, and profit per period." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Add zone</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Pincodes (csv)</Label><Input value={form.pincodes} onChange={e => setForm({ ...form, pincodes: e.target.value })} /></div>
            <div><Label>Base fee ₹</Label><Input type="number" value={form.baseFeeRupees} onChange={e => setForm({ ...form, baseFeeRupees: e.target.value })} /></div>
            <div><Label>Min order ₹</Label><Input type="number" value={form.minOrderRupees} onChange={e => setForm({ ...form, minOrderRupees: e.target.value })} /></div>
            <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>Add zone</Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Zones & latest metrics</CardTitle>
            <Button onClick={() => recompute.mutate()} disabled={recompute.isPending}>{recompute.isPending ? "Recomputing…" : "Recompute"}</Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Zone</TableHead><TableHead>Orders</TableHead><TableHead>Revenue</TableHead><TableHead>Cost</TableHead><TableHead>Profit</TableHead></TableRow></TableHeader>
              <TableBody>
                {(zones?.items ?? []).map((z: any) => {
                  const m = (metrics?.items ?? []).find((x: any) => x.zoneId === z.id);
                  return (
                    <TableRow key={z.id}>
                      <TableCell>{z.name}<div className="text-xs text-muted-foreground">{z.pincodes ?? "—"}</div></TableCell>
                      <TableCell>{m?.orderCount ?? 0}</TableCell>
                      <TableCell>₹{m?.revenueRupees ?? "0"}</TableCell>
                      <TableCell>₹{m?.costRupees ?? "0"}</TableCell>
                      <TableCell className={Number(m?.profitRupees ?? 0) >= 0 ? "text-green-600" : "text-red-600"}>₹{m?.profitRupees ?? "0"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

// 9. TABLE REVENUE OPTIMIZATION
export function TableOptimizationPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { data } = useApi<{ items: any[] }>(["table-metrics", rid], `${base(rid)}/table-metrics`);
  const snapshot = useMutation({
    mutationFn: () => apiPost(`${base(rid)}/table-metrics/snapshot`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["table-metrics", rid] }),
  });
  const items = data?.items ?? [];
  return (
    <Layout>
      <PageHeader title="Table Revenue Optimization" description="Rank tables by revenue per seat to spot under-performers." />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Table performance</CardTitle>
          <Button onClick={() => snapshot.mutate()} disabled={snapshot.isPending}>Save snapshot</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Table</TableHead><TableHead>Capacity</TableHead><TableHead>Orders</TableHead><TableHead>Revenue</TableHead><TableHead>₹/seat</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((t: any) => (
                <TableRow key={t.tableId}>
                  <TableCell>{t.tableNumber}</TableCell>
                  <TableCell>{t.capacity}</TableCell>
                  <TableCell>{t.orderCount}</TableCell>
                  <TableCell>₹{Number(t.revenueRupees).toFixed(2)}</TableCell>
                  <TableCell>₹{Number(t.revenuePerSeat).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Layout>
  );
}

// 10. STAFF TIP MANAGEMENT
export function TipsPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rulesData } = useApi<{ items: any[] }>(["tip-rules", rid], `${base(rid)}/tip-split-rules`);
  const { data: poolsData } = useApi<{ items: any[] }>(["tip-pools", rid], `${base(rid)}/tip-pools`);
  const [rules, setRules] = useState<Array<{ role: string; sharePct: number }>>([]);
  useEffect(() => {
    if (rulesData?.items) setRules(rulesData.items.map((r: any) => ({ role: r.role, sharePct: Number(r.sharePct) })));
  }, [rulesData]);
  const saveRules = useMutation({
    mutationFn: () => apiPut(`${base(rid)}/tip-split-rules`, { rules }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tip-rules", rid] }); toast({ title: "Rules saved" }); },
  });
  const [pool, setPool] = useState({ periodStart: "", periodEnd: "", totalRupees: "" });
  const createPool = useMutation({
    mutationFn: () => apiPost(`${base(rid)}/tip-pools`, { ...pool, totalRupees: Number(pool.totalRupees) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tip-pools", rid] }); setPool({ periodStart: "", periodEnd: "", totalRupees: "" }); },
  });
  const distribute = useMutation({
    mutationFn: (id: number) => apiPost(`${base(rid)}/tip-pools/${id}/distribute`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tip-pools", rid] }); toast({ title: "Distributed" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const totalPct = rules.reduce((s, r) => s + Number(r.sharePct || 0), 0);
  return (
    <Layout>
      <PageHeader title="Staff Tip Management" description="Split rules per role, plus pool periods that distribute to active staff." />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Split rules (total {totalPct.toFixed(2)}%)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {rules.map((r, i) => (
              <div key={i} className="flex gap-2 items-end">
                <div className="flex-1"><Label>Role</Label><Input value={r.role} onChange={e => { const next = [...rules]; next[i].role = e.target.value; setRules(next); }} /></div>
                <div className="w-24"><Label>%</Label><Input type="number" value={r.sharePct} onChange={e => { const next = [...rules]; next[i].sharePct = Number(e.target.value); setRules(next); }} /></div>
                <Button variant="ghost" onClick={() => setRules(rules.filter((_, x) => x !== i))}>×</Button>
              </div>
            ))}
            <Button variant="outline" onClick={() => setRules([...rules, { role: "waiter", sharePct: 0 }])}>+ Add role</Button>
            <Button className="w-full" onClick={() => saveRules.mutate()} disabled={saveRules.isPending}>Save rules</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>New tip pool</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label>Period start</Label><Input type="date" value={pool.periodStart} onChange={e => setPool({ ...pool, periodStart: e.target.value })} /></div>
            <div><Label>Period end</Label><Input type="date" value={pool.periodEnd} onChange={e => setPool({ ...pool, periodEnd: e.target.value })} /></div>
            <div><Label>Total ₹</Label><Input type="number" value={pool.totalRupees} onChange={e => setPool({ ...pool, totalRupees: e.target.value })} /></div>
            <Button onClick={() => createPool.mutate()} disabled={!pool.periodStart || !pool.totalRupees || createPool.isPending}>Create pool</Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Pool history</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {(poolsData?.items ?? []).map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.periodStart} → {p.periodEnd}</TableCell>
                    <TableCell>₹{p.totalRupees}</TableCell>
                    <TableCell><Badge variant={p.status === "distributed" ? "secondary" : "default"}>{p.status}</Badge></TableCell>
                    <TableCell>{p.status === "open" && <Button size="sm" onClick={() => distribute.mutate(p.id)}>Distribute</Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

// 11. STAFF LEADERBOARD TV MODE
type LeaderboardBoard = { key: string; title: string; leaders: any[] };
type LeaderboardTvResponse = {
  capturedAt: string;
  rotationSeconds?: number;
  boards?: LeaderboardBoard[];
  leaders?: any[];
};

function leaderSubline(boardKey: string, l: any): string {
  switch (boardKey) {
    case "upsells": return `${l.accepted ?? 0} upsells accepted`;
    case "tips": return `Tips earned`;
    case "service_speed": return `${l.ordersServed ?? l.orderCount ?? 0} orders served`;
    case "sales":
    default: return `${l.role ?? "—"} · ${l.orderCount ?? 0} orders · ${l.upsellsAccepted ?? 0} upsells`;
  }
}
function leaderValue(boardKey: string, l: any): string {
  switch (boardKey) {
    case "upsells": return `₹${Number(l.revenueRupees ?? 0).toLocaleString()}`;
    case "tips": return `₹${Number(l.amountRupees ?? 0).toLocaleString()}`;
    case "service_speed": return `${l.ordersServed ?? l.orderCount ?? 0}`;
    case "sales":
    default: return `₹${Number(l.revenueRupees ?? 0).toLocaleString()}`;
  }
}

export function LeaderboardTvPage() {
  const rid = useRestaurantId();
  // Refresh the underlying data every 30s so cast-mode screens stay fresh
  // without an operator nearby. The board carousel rotates faster (every
  // rotationSeconds, default 10s) between sales/upsells/tips/service.
  const { data } = useApi<LeaderboardTvResponse>(
    ["leaderboard-tv", rid],
    `${base(rid)}/leaderboard-tv`,
    { refetchInterval: 30000 },
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [boardIdx, setBoardIdx] = useState(0);
  useEffect(() => {
    if (fullscreen && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, [fullscreen]);
  const boards: LeaderboardBoard[] = data?.boards && data.boards.length > 0
    ? data.boards
    : [{ key: "sales", title: "Top Sales", leaders: data?.leaders ?? [] }];
  useEffect(() => {
    if (boards.length <= 1) return;
    const ms = Math.max(3, Number(data?.rotationSeconds ?? 10)) * 1000;
    const t = setInterval(() => setBoardIdx(i => (i + 1) % boards.length), ms);
    return () => clearInterval(t);
  }, [boards.length, data?.rotationSeconds]);
  const safeIdx = boards.length > 0 ? boardIdx % boards.length : 0;
  const current = boards[safeIdx] ?? { key: "sales", title: "Top Sales", leaders: [] };
  const leaders = current.leaders ?? [];
  return (
    <Layout>
      <PageHeader title="Staff Leaderboard TV" description="Big-screen scoreboard of top staff. Auto-rotates between sales, upsells, tips, and service speed. Click Fullscreen for cast mode." />
      <div className="flex justify-end mb-3 gap-2">
        {boards.length > 1 && (
          <div className="flex gap-1 items-center">
            {boards.map((b, i) => (
              <Button key={b.key} size="sm" variant={i === safeIdx ? "default" : "outline"} onClick={() => setBoardIdx(i)}>{b.title}</Button>
            ))}
          </div>
        )}
        <Button onClick={() => setFullscreen(true)}>Fullscreen</Button>
      </div>
      <div className={fullscreen ? "fixed inset-0 z-50 bg-black text-white p-8 overflow-auto" : "bg-card border rounded p-6"}>
        <div className="flex items-baseline justify-between max-w-3xl mx-auto mb-6">
          <h2 className="text-3xl font-bold">🏆 {current.title}</h2>
          {boards.length > 1 && (
            <div className="text-sm opacity-60">{safeIdx + 1} / {boards.length} · auto-rotates</div>
          )}
        </div>
        <div className="space-y-3 max-w-3xl mx-auto">
          {leaders.map((l: any) => (
            <div key={`${current.key}-${l.userId}`} className={`flex items-center gap-4 p-4 rounded ${fullscreen ? "bg-white/10" : "bg-muted"}`}>
              <div className={`text-4xl font-bold w-12 text-center ${l.rank === 1 ? "text-yellow-500" : l.rank === 2 ? "text-gray-400" : l.rank === 3 ? "text-orange-600" : ""}`}>#{l.rank}</div>
              <div className="flex-1">
                <div className="text-xl font-semibold">{l.name}</div>
                <div className="text-sm opacity-70">{leaderSubline(current.key, l)}</div>
              </div>
              <div className="text-2xl font-bold">{leaderValue(current.key, l)}</div>
            </div>
          ))}
          {leaders.length === 0 && <p className="text-center opacity-60">No data yet for this board.</p>}
        </div>
        {fullscreen && <Button className="fixed top-4 right-4" variant="secondary" onClick={() => { setFullscreen(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }}>Exit</Button>}
      </div>
    </Layout>
  );
}
