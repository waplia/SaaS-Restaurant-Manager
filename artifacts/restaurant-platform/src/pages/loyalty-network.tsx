import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Globe2, Settings2, BarChart3, ListOrdered, LogOut } from "lucide-react";
import { apiFetch, apiPut, apiPost } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

interface Member {
  id: number; restaurantId: number;
  displayName: string | null; blurb: string | null;
  allowCrossEarn: boolean; allowCrossRedeem: boolean;
  crossRedeemMaxPct: number; crossRedeemMinOrder: string;
  status: string; optedInAt: string | null; optedOutAt: string | null;
}
interface Analytics {
  walletAdoption: number; networkSize: number;
  incoming: { count: number; amount: string };
  outgoing: { count: number; amount: string };
}
interface LedgerEntry {
  id: number; kind: string; amount: string; currency: string;
  direction: "incoming" | "outgoing";
  counterpartyName: string | null;
  customerName: string | null; customerPhone: string | null;
  reference: string | null; createdAt: string;
}
interface DirectoryEntry {
  restaurantId: number; name: string; city: string | null;
  logoUrl: string | null; blurb: string | null;
  allowCrossEarn: boolean; allowCrossRedeem: boolean; crossRedeemMaxPct: number;
}

export default function LoyaltyNetworkPage() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: settingsData, isLoading: loadingSettings } = useQuery<{ member: Member | null }>({
    queryKey: ["loyalty-network", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/loyalty-network`),
    enabled: !!rid,
  });
  const member = settingsData?.member ?? null;

  const { data: analytics } = useQuery<Analytics>({
    queryKey: ["loyalty-network-analytics", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/loyalty-network/analytics`),
    enabled: !!rid,
  });

  const { data: ledger = [] } = useQuery<LedgerEntry[]>({
    queryKey: ["loyalty-network-ledger", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/loyalty-network/ledger`),
    enabled: !!rid,
  });

  const { data: directory = [] } = useQuery<DirectoryEntry[]>({
    queryKey: ["loyalty-network-directory", rid],
    queryFn: () => apiFetch(`/restaurants/${rid}/loyalty-network/directory`),
    enabled: !!rid,
  });

  const [form, setForm] = useState({
    displayName: "", blurb: "",
    allowCrossEarn: true, allowCrossRedeem: true,
    crossRedeemMaxPct: 50, crossRedeemMinOrder: "0.00",
    status: "active" as "active" | "paused",
  });

  useEffect(() => {
    if (member) {
      setForm({
        displayName: member.displayName ?? "",
        blurb: member.blurb ?? "",
        allowCrossEarn: member.allowCrossEarn,
        allowCrossRedeem: member.allowCrossRedeem,
        crossRedeemMaxPct: member.crossRedeemMaxPct,
        crossRedeemMinOrder: member.crossRedeemMinOrder,
        status: (member.status as "active" | "paused") ?? "active",
      });
    }
  }, [member?.id, member?.updatedAt as unknown as string]);

  const save = useMutation({
    mutationFn: () => apiPut<{ member: Member }>(`/restaurants/${rid}/loyalty-network`, form),
    onSuccess: () => {
      toast({ title: member ? "Loyalty network updated" : "Joined loyalty network" });
      void qc.invalidateQueries({ queryKey: ["loyalty-network", rid] });
      void qc.invalidateQueries({ queryKey: ["loyalty-network-analytics", rid] });
    },
    onError: (err) => toast({ title: "Failed to save", description: (err as Error).message, variant: "destructive" }),
  });

  const optOut = useMutation({
    mutationFn: () => apiPost(`/restaurants/${rid}/loyalty-network/opt-out`),
    onSuccess: () => {
      toast({ title: "Left loyalty network" });
      void qc.invalidateQueries({ queryKey: ["loyalty-network", rid] });
    },
  });

  return (
    <Layout>
      <PageHeader
        title="Loyalty Network"
        description="Let your customers spend cashback at partner restaurants — and welcome theirs into yours."
        icon={Globe2}
      />

      <Tabs defaultValue="settings" className="space-y-4">
        <TabsList>
          <TabsTrigger value="settings" data-testid="tab-settings"><Settings2 className="h-4 w-4 mr-1" /> Settings</TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics"><BarChart3 className="h-4 w-4 mr-1" /> Analytics</TabsTrigger>
          <TabsTrigger value="ledger" data-testid="tab-ledger"><ListOrdered className="h-4 w-4 mr-1" /> Ledger</TabsTrigger>
          <TabsTrigger value="directory" data-testid="tab-directory"><Globe2 className="h-4 w-4 mr-1" /> Directory</TabsTrigger>
        </TabsList>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Network membership</CardTitle>
                {member && (
                  <Badge variant={member.status === "active" ? "default" : "secondary"} data-testid="badge-status">
                    {member.status}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingSettings ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="displayName">Display name</Label>
                      <Input id="displayName" data-testid="input-display-name"
                        placeholder="Shown to wallet users"
                        value={form.displayName}
                        onChange={(e) => setForm(f => ({ ...f, displayName: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="status">Status</Label>
                      <select id="status" data-testid="select-status"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={form.status}
                        onChange={(e) => setForm(f => ({ ...f, status: e.target.value as "active" | "paused" }))}
                      >
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="blurb">Network blurb</Label>
                    <Textarea id="blurb" rows={2} data-testid="input-blurb"
                      placeholder="A short tagline shown in the loyalty network directory"
                      value={form.blurb}
                      onChange={(e) => setForm(f => ({ ...f, blurb: e.target.value }))}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium text-sm">Accept cross-network customers</p>
                      <p className="text-xs text-muted-foreground">Network customers earn points & cashback when they dine here.</p>
                    </div>
                    <Switch checked={form.allowCrossEarn} data-testid="switch-allow-earn"
                      onCheckedChange={(v) => setForm(f => ({ ...f, allowCrossEarn: v }))} />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium text-sm">Allow my customers to redeem elsewhere</p>
                      <p className="text-xs text-muted-foreground">Your cashback balance becomes spendable at other network restaurants.</p>
                    </div>
                    <Switch checked={form.allowCrossRedeem} data-testid="switch-allow-redeem"
                      onCheckedChange={(v) => setForm(f => ({ ...f, allowCrossRedeem: v }))} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="maxPct">Max cross-redeem % of order</Label>
                      <Input id="maxPct" type="number" min={0} max={100} data-testid="input-max-pct"
                        value={form.crossRedeemMaxPct}
                        onChange={(e) => setForm(f => ({ ...f, crossRedeemMaxPct: Number(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="minOrder">Min order amount</Label>
                      <Input id="minOrder" type="number" step="0.01" min={0} data-testid="input-min-order"
                        value={form.crossRedeemMinOrder}
                        onChange={(e) => setForm(f => ({ ...f, crossRedeemMinOrder: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between pt-2">
                    <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save">
                      {save.isPending ? "Saving…" : member ? "Save changes" : "Join the network"}
                    </Button>
                    {member && member.status === "active" && (
                      <Button variant="outline" onClick={() => optOut.mutate()} disabled={optOut.isPending} data-testid="button-opt-out">
                        <LogOut className="h-4 w-4 mr-1" /> Opt out
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Wallet customers" value={analytics?.walletAdoption ?? 0} testid="stat-adoption" />
            <StatCard label="Network restaurants" value={analytics?.networkSize ?? 0} testid="stat-network-size" />
            <StatCard label="Incoming redeems" value={`${analytics?.incoming.count ?? 0} (${fmt(analytics?.incoming.amount)})`} testid="stat-incoming" />
            <StatCard label="Outgoing redeems" value={`${analytics?.outgoing.count ?? 0} (${fmt(analytics?.outgoing.amount)})`} testid="stat-outgoing" />
          </div>
        </TabsContent>

        <TabsContent value="ledger">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead><TableHead>Kind</TableHead>
                    <TableHead>Direction</TableHead><TableHead>Counterparty</TableHead>
                    <TableHead>Customer</TableHead><TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No ledger entries yet.</TableCell></TableRow>
                  ) : ledger.map(e => (
                    <TableRow key={e.id} data-testid={`row-ledger-${e.id}`}>
                      <TableCell className="text-xs">{new Date(e.createdAt).toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline">{e.kind}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={e.direction === "incoming" ? "default" : "secondary"}>{e.direction}</Badge>
                      </TableCell>
                      <TableCell>{e.counterpartyName ?? "—"}</TableCell>
                      <TableCell>{e.customerName ?? e.customerPhone ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(e.amount, e.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="directory">
          {directory.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No other restaurants are in the network yet.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {directory.map(d => (
                <Card key={d.restaurantId} data-testid={`card-directory-${d.restaurantId}`}>
                  <CardContent className="py-4 flex items-start gap-3">
                    {d.logoUrl
                      ? <img src={d.logoUrl} alt="" className="w-12 h-12 rounded-lg object-cover bg-muted" />
                      : <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center font-semibold">{d.name.charAt(0)}</div>
                    }
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{d.name}</p>
                      <p className="text-xs text-muted-foreground">{d.city ?? ""}</p>
                      {d.blurb && <p className="text-sm mt-1 text-muted-foreground">{d.blurb}</p>}
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {d.allowCrossEarn && <Badge variant="outline">Earn here</Badge>}
                        {d.allowCrossRedeem && <Badge variant="outline">Redeem here</Badge>}
                        <Badge variant="secondary">{d.crossRedeemMaxPct}% max</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Layout>
  );
}

function StatCard({ label, value, testid }: { label: string; value: string | number; testid: string }) {
  return (
    <Card><CardContent className="py-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold mt-1" data-testid={testid}>{value}</p>
    </CardContent></Card>
  );
}

function fmt(amount: string | undefined, currency = "INR"): string {
  const n = Number(amount ?? 0);
  if (!isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}
