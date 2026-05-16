import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Coins, TrendingUp, X, Save, AlertTriangle, Clock, Users, Truck, Boxes, ArrowRight } from "lucide-react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useAiWallet } from "@/lib/aiHooks";
import { useToast } from "@/hooks/use-toast";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { format } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface ForecastItem {
  menuItemId: number;
  name: string;
  categoryName: string | null;
  forecastUnits: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
}

interface PeakHour { hour: number; expectedOrders: number; intensity: "quiet" | "normal" | "busy" | "peak" }
interface ShiftStaff { shift: string; window: string; recommendedHeadcount: number; currentlyScheduled: number; rationale: string }
interface RawMaterial { inventoryItemId: number | null; name: string; unit: string; requiredQuantity: number; currentStock: number; shortfall: number }

interface ForecastPayload {
  summary: string;
  horizonDays: number;
  totalForecastUnits: number;
  estimatedRevenue: number;
  items: ForecastItem[];
  byCategory: Array<{ category: string; forecastUnits: number }>;
  peakHours?: PeakHour[];
  slowHours?: number[];
  shiftStaffing?: ShiftStaff[];
  deliveryDemand?: { dineInUnits: number; deliveryUnits: number; takeawayUnits: number; deliveryShare: number };
  rawMaterialNeeds?: RawMaterial[];
  generatedAt?: string;
}

interface ForecastRow {
  id: number;
  status: string;
  horizonDays: number;
  payload: ForecastPayload;
  generatedAt: string;
  notes: string | null;
}

const CONF_COLOR: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300",
};

const COST = 5;

const INTENSITY_BG: Record<PeakHour["intensity"], string> = {
  quiet: "bg-slate-100 dark:bg-slate-800/40",
  normal: "bg-emerald-100 dark:bg-emerald-950/40",
  busy: "bg-amber-200 dark:bg-amber-900/50",
  peak: "bg-rose-300 dark:bg-rose-800/60",
};

export default function AiForecastPage() {
  const restaurantId = useRestaurantId();
  const wallet = useAiWallet();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [horizon, setHorizon] = useState(7);

  const list = useQuery<{ data: ForecastRow[] }>({
    queryKey: ["ai-forecasts", restaurantId, "active"],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ai-ops/forecast/list?status=active`),
    enabled: !!restaurantId,
  });

  const generate = useMutation({
    mutationFn: () => apiPost<{ forecast: ForecastRow }>(`/restaurants/${restaurantId}/ai-ops/forecast/run`, { horizonDays: horizon }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-forecasts", restaurantId] });
      qc.invalidateQueries({ queryKey: ["ai-wallet"] });
      toast({ title: "Forecast generated" });
    },
    onError: (e: unknown) => {
      toast({ title: (e as { message?: string })?.message ?? "Failed to generate", variant: "destructive" });
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "saved" | "dismissed" }) =>
      apiPatch(`/restaurants/${restaurantId}/ai-ops/forecast/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-forecasts", restaurantId] }),
  });

  const balance = wallet.data?.balance ?? 0;
  const planEnabled = wallet.data?.planKhanaAiEnabled ?? wallet.data?.planAiEnabled ?? false;
  const insufficient = !wallet.isLoading && balance < COST;

  return (
    <Layout>
      <PageHeader
        title="AI Demand Forecasting"
        subtitle="Predict next-week demand by item and category from your order history."
        actions={
          <div className="flex gap-2 items-center">
            <select
              value={horizon}
              onChange={e => setHorizon(Number(e.target.value))}
              className="text-xs border border-input rounded-md px-2 py-1 bg-background"
            >
              <option value={1}>Tomorrow (1 day)</option>
              <option value={7}>Next 7 days</option>
              <option value={14}>Next 14 days</option>
              <option value={30}>Next 30 days</option>
            </select>
            <Badge variant="secondary" className="gap-1"><Coins className="w-3 h-3" />{balance} cr</Badge>
            <Button
              size="sm"
              onClick={() => generate.mutate()}
              disabled={!planEnabled || insufficient || generate.isPending}
              className="gap-1.5"
            >
              {generate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Run forecast ({COST} cr)
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-4">
        {!planEnabled && !wallet.isLoading && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Khana AI is not in your plan</p>
                <p className="text-sm text-muted-foreground">Upgrade to use AI forecasting.</p>
              </div>
              <Link href="/subscription"><Button size="sm">Upgrade</Button></Link>
            </CardContent>
          </Card>
        )}

        {insufficient && planEnabled && (
          <Card className="border-rose-300 bg-rose-50 dark:bg-rose-950/20">
            <CardContent className="p-4 flex items-start gap-3">
              <Coins className="w-5 h-5 text-rose-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Out of credits</p>
                <p className="text-sm text-muted-foreground">You need {COST} credits to run a forecast.</p>
              </div>
              <Link href="/ai/usage"><Button size="sm">Recharge</Button></Link>
            </CardContent>
          </Card>
        )}

        {list.isLoading ? (
          <Skeleton className="h-64" />
        ) : !list.data?.data.length ? (
          <Card>
            <CardContent className="p-10 text-center space-y-3">
              <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto" />
              <p className="font-semibold">No active forecasts</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Run a forecast to see expected demand for the next {horizon} days.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {list.data.data.map((fc) => {
              const p = fc.payload;
              return (
                <Card key={fc.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <CardTitle className="text-base flex items-center gap-2">
                          Forecast #{fc.id} · next {fc.horizonDays} days <AiGeneratedBadge />
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(fc.generatedAt), "PP p")} ·{" "}
                          {p.totalForecastUnits.toLocaleString()} units · ₹{p.estimatedRevenue.toLocaleString()} revenue
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: fc.id, status: "saved" })} className="gap-1">
                          <Save className="w-3.5 h-3.5" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: fc.id, status: "dismissed" })} className="gap-1 text-muted-foreground">
                          <X className="w-3.5 h-3.5" /> Dismiss
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {p.summary && <p className="text-sm text-muted-foreground italic">{p.summary}</p>}

                    {p.deliveryDemand && (p.deliveryDemand.dineInUnits + p.deliveryDemand.deliveryUnits + p.deliveryDemand.takeawayUnits) > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="border border-border rounded-lg p-3">
                          <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Dine-in</p>
                          <p className="text-lg font-bold">{p.deliveryDemand.dineInUnits.toLocaleString()}</p>
                        </div>
                        <div className="border border-border rounded-lg p-3">
                          <p className="text-[10px] uppercase text-muted-foreground tracking-wide flex items-center gap-1"><Truck className="w-3 h-3" /> Delivery</p>
                          <p className="text-lg font-bold">{p.deliveryDemand.deliveryUnits.toLocaleString()}</p>
                          <p className="text-[10px] text-muted-foreground">{p.deliveryDemand.deliveryShare}% of mix</p>
                        </div>
                        <div className="border border-border rounded-lg p-3">
                          <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Takeaway</p>
                          <p className="text-lg font-bold">{p.deliveryDemand.takeawayUnits.toLocaleString()}</p>
                        </div>
                        <div className="border border-border rounded-lg p-3">
                          <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Total units</p>
                          <p className="text-lg font-bold">{p.totalForecastUnits.toLocaleString()}</p>
                          <p className="text-[10px] text-muted-foreground">₹{p.estimatedRevenue.toLocaleString()}</p>
                        </div>
                      </div>
                    )}

                    {p.peakHours && p.peakHours.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Hourly demand heatmap
                        </p>
                        <div className="grid grid-cols-12 gap-0.5">
                          {Array.from({ length: 24 }).map((_, h) => {
                            const ph = p.peakHours!.find((x) => x.hour === h);
                            const intensity = ph?.intensity ?? "quiet";
                            return (
                              <div
                                key={h}
                                className={`h-10 rounded text-[10px] flex flex-col items-center justify-center ${INTENSITY_BG[intensity]}`}
                                title={`${h}:00 — ${ph?.expectedOrders ?? 0} orders (${intensity})`}
                              >
                                <span className="font-medium">{h}</span>
                                {ph && <span className="text-[9px] opacity-70">{ph.expectedOrders}</span>}
                              </div>
                            );
                          })}
                        </div>
                        {p.slowHours && p.slowHours.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Slow hours: {p.slowHours.map((h) => `${h}:00`).join(", ")} — consider running specials.
                          </p>
                        )}
                      </div>
                    )}

                    {p.shiftStaffing && p.shiftStaffing.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                            <Users className="w-3 h-3" /> Recommended staffing
                          </p>
                          <Link href="/staff">
                            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
                              Open scheduling <ArrowRight className="w-3 h-3" />
                            </Button>
                          </Link>
                        </div>
                        <div className="border border-border rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                              <tr className="text-left">
                                <th className="px-3 py-2 font-medium">Shift</th>
                                <th className="px-3 py-2 font-medium">Window</th>
                                <th className="px-3 py-2 font-medium text-right">Recommended</th>
                                <th className="px-3 py-2 font-medium text-right">Scheduled</th>
                                <th className="px-3 py-2 font-medium">Rationale</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.shiftStaffing.map((s, i) => {
                                const gap = s.recommendedHeadcount - s.currentlyScheduled;
                                return (
                                  <tr key={i} className="border-t border-border">
                                    <td className="px-3 py-2 font-medium">{s.shift}</td>
                                    <td className="px-3 py-2 text-muted-foreground">{s.window}</td>
                                    <td className="px-3 py-2 text-right font-semibold">{s.recommendedHeadcount}</td>
                                    <td className={`px-3 py-2 text-right ${gap > 0 ? "text-rose-600 font-semibold" : "text-muted-foreground"}`}>
                                      {s.currentlyScheduled}{gap > 0 ? ` (-${gap})` : ""}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground line-clamp-1 max-w-xs">{s.rationale}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {p.rawMaterialNeeds && p.rawMaterialNeeds.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                            <Boxes className="w-3 h-3" /> Raw-material needs (next {fc.horizonDays}d)
                          </p>
                          <Link href="/inventory">
                            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
                              Open inventory <ArrowRight className="w-3 h-3" />
                            </Button>
                          </Link>
                        </div>
                        <div className="border border-border rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                              <tr className="text-left">
                                <th className="px-3 py-2 font-medium">Ingredient</th>
                                <th className="px-3 py-2 font-medium text-right">Required</th>
                                <th className="px-3 py-2 font-medium text-right">In stock</th>
                                <th className="px-3 py-2 font-medium text-right">Shortfall</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.rawMaterialNeeds.slice(0, 15).map((rm, i) => (
                                <tr key={i} className="border-t border-border">
                                  <td className="px-3 py-2 font-medium">{rm.name}</td>
                                  <td className="px-3 py-2 text-right">{rm.requiredQuantity} {rm.unit}</td>
                                  <td className="px-3 py-2 text-right text-muted-foreground">{rm.currentStock} {rm.unit}</td>
                                  <td className={`px-3 py-2 text-right font-semibold ${rm.shortfall > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                                    {rm.shortfall > 0 ? `${rm.shortfall} ${rm.unit}` : "OK"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {p.byCategory.length > 0 && (
                      <div className="h-56">
                        <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">By category</p>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={p.byCategory} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="category" fontSize={11} />
                            <YAxis fontSize={11} allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="forecastUnits" name="Forecast units" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr className="text-left">
                            <th className="px-3 py-2 font-medium">Item</th>
                            <th className="px-3 py-2 font-medium">Category</th>
                            <th className="px-3 py-2 font-medium text-right">Forecast units</th>
                            <th className="px-3 py-2 font-medium">Confidence</th>
                            <th className="px-3 py-2 font-medium">Rationale</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.items.slice(0, 30).map((it) => (
                            <tr key={it.menuItemId} className="border-t border-border">
                              <td className="px-3 py-2 font-medium">{it.name}</td>
                              <td className="px-3 py-2 text-muted-foreground">{it.categoryName ?? "—"}</td>
                              <td className="px-3 py-2 text-right font-semibold">{it.forecastUnits}</td>
                              <td className="px-3 py-2">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${CONF_COLOR[it.confidence]}`}>
                                  {it.confidence}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground line-clamp-1 max-w-xs">{it.rationale}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
