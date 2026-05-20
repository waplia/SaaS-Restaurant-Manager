import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout as Layout } from "@/components/layout/AdminLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiGet, apiPut, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Smartphone } from "lucide-react";

interface PhonePeConfig {
  id: number | null;
  isEnabled: boolean;
  env: "uat" | "prod";
  merchantId: string | null;
  saltKeyMasked: string | null;
  saltIndex: number;
  callbackUsername: string | null;
  hasCallbackPassword: boolean;
  defaultTimeoutSec: number;
  enabledSolutions: Record<string, boolean>;
  uatBaseUrl: string | null;
  prodBaseUrl: string | null;
  refundApiEnabled: boolean;
  callbackUrl: string;
  updatedAt: string | null;
}

const SOLUTIONS = ["EDC", "DYNAMIC_QR", "COLLECT", "PAYLINK", "STATIC_QR"] as const;

export default function AdminPhonePePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<PhonePeConfig>({
    queryKey: ["admin-phonepe-config"],
    queryFn: () => apiGet(`/admin/phonepe/config`),
  });

  const [form, setForm] = useState<Partial<PhonePeConfig & { saltKey: string; callbackPassword: string }>>({});
  useEffect(() => {
    if (data) setForm({
      isEnabled: data.isEnabled,
      env: data.env,
      merchantId: data.merchantId ?? "",
      saltIndex: data.saltIndex,
      callbackUsername: data.callbackUsername ?? "",
      defaultTimeoutSec: data.defaultTimeoutSec,
      enabledSolutions: { ...data.enabledSolutions },
      uatBaseUrl: data.uatBaseUrl ?? "",
      prodBaseUrl: data.prodBaseUrl ?? "",
      refundApiEnabled: data.refundApiEnabled,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPut(`/admin/phonepe/config`, body),
    onSuccess: () => { toast({ title: "PhonePe config saved" }); qc.invalidateQueries({ queryKey: ["admin-phonepe-config"] }); },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const testConn = useMutation({
    mutationFn: () => apiPost(`/admin/phonepe/config/test-connection`, {}),
    onSuccess: (r: { ok: boolean; message: string; phonepeCode?: string }) => {
      toast({ title: r.ok ? "Connection OK" : "Connection failed", description: `${r.message}${r.phonepeCode ? ` (${r.phonepeCode})` : ""}`, variant: r.ok ? "default" : "destructive" });
    },
  });

  if (isLoading || !data) {
    return <Layout><PageHeader title="PhonePe Offline" icon={Smartphone} /><div className="p-6">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <PageHeader title="PhonePe Offline" subtitle="Merchant credentials, callback URL and enabled solutions" icon={Smartphone} />
      <div className="p-6 space-y-4 max-w-3xl">
        <Card>
          <CardHeader><CardTitle>Merchant credentials</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch checked={!!form.isEnabled} onCheckedChange={v => setForm({ ...form, isEnabled: v })} />
              <span>Enable PhonePe Offline globally</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Environment</Label>
                <Select value={form.env} onValueChange={(v: "uat" | "prod") => setForm({ ...form, env: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="uat">UAT (testing)</SelectItem>
                    <SelectItem value="prod">Production</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Salt index</Label>
                <Input type="number" value={form.saltIndex ?? 1} onChange={e => setForm({ ...form, saltIndex: Number(e.target.value) })} />
              </div>
            </div>

            <div>
              <Label>Merchant ID</Label>
              <Input value={form.merchantId ?? ""} onChange={e => setForm({ ...form, merchantId: e.target.value })} placeholder="MERCHANTUAT" />
            </div>

            <div>
              <Label>Salt key</Label>
              <Input type="password" placeholder={data.saltKeyMasked ?? "Enter to set / change"} value={form.saltKey ?? ""} onChange={e => setForm({ ...form, saltKey: e.target.value })} />
              <p className="text-xs text-muted-foreground mt-1">Encrypted at rest. Current value: {data.saltKeyMasked ?? "(not set)"}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Default timeout (seconds)</Label>
                <Input type="number" value={form.defaultTimeoutSec ?? 120} onChange={e => setForm({ ...form, defaultTimeoutSec: Number(e.target.value) })} />
              </div>
              <div className="flex items-end gap-3">
                <Switch checked={!!form.refundApiEnabled} onCheckedChange={v => setForm({ ...form, refundApiEnabled: v })} />
                <span>Refund API enabled on MID</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>UAT base URL override</Label>
                <Input value={form.uatBaseUrl ?? ""} onChange={e => setForm({ ...form, uatBaseUrl: e.target.value })} placeholder="https://mercury-uat.phonepe.com" />
              </div>
              <div>
                <Label>Production base URL override</Label>
                <Input value={form.prodBaseUrl ?? ""} onChange={e => setForm({ ...form, prodBaseUrl: e.target.value })} placeholder="https://mercury-t2.phonepe.com" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Callback (S2S)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Callback URL (register this in PhonePe Business)</Label>
              <Input readOnly value={data.callbackUrl} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Callback username (optional)</Label>
                <Input value={form.callbackUsername ?? ""} onChange={e => setForm({ ...form, callbackUsername: e.target.value })} />
              </div>
              <div>
                <Label>Callback password (optional)</Label>
                <Input type="password" placeholder={data.hasCallbackPassword ? "(set)" : "Enter to set"} value={form.callbackPassword ?? ""} onChange={e => setForm({ ...form, callbackPassword: e.target.value })} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Enabled solutions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {SOLUTIONS.map(s => (
              <div key={s} className="flex items-center gap-3">
                <Switch
                  checked={!!form.enabledSolutions?.[s]}
                  onCheckedChange={v => setForm({ ...form, enabledSolutions: { ...(form.enabledSolutions ?? {}), [s]: v } })}
                />
                <span className="font-medium">{s.replace("_", " ")}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button onClick={() => save.mutate({
            isEnabled: form.isEnabled,
            env: form.env,
            merchantId: form.merchantId,
            saltKey: form.saltKey || undefined,
            saltIndex: form.saltIndex,
            callbackUsername: form.callbackUsername,
            callbackPassword: form.callbackPassword || undefined,
            defaultTimeoutSec: form.defaultTimeoutSec,
            enabledSolutions: form.enabledSolutions,
            uatBaseUrl: form.uatBaseUrl || null,
            prodBaseUrl: form.prodBaseUrl || null,
            refundApiEnabled: form.refundApiEnabled,
          })} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save configuration"}
          </Button>
          <Button variant="outline" onClick={() => testConn.mutate()} disabled={testConn.isPending || !data.merchantId}>
            {testConn.isPending ? "Testing…" : "Test connection"}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
