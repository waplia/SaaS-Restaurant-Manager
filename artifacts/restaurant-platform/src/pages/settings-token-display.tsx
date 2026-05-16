import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useTokenSettings, useSaveTokenSettings, type TokenSettings } from "@/lib/hooks-tokens";
import { useToast } from "@/hooks/use-toast";

const ORDER_TYPES = ["dine_in", "takeaway", "delivery"];

export default function SettingsTokenDisplayPage() {
  const { data, isLoading } = useTokenSettings();
  const save = useSaveTokenSettings();
  const { toast } = useToast();
  const [form, setForm] = useState<TokenSettings | null>(null);

  useEffect(() => { if (data) setForm(data); }, [data]);

  if (isLoading || !form) return <Layout><div className="p-6">Loading…</div></Layout>;

  function set<K extends keyof TokenSettings>(k: K, v: TokenSettings[K]) {
    setForm(prev => prev ? { ...prev, [k]: v } : prev);
  }

  function toggleOrderType(t: string) {
    if (!form) return;
    const has = form.enabledOrderTypes.includes(t);
    set("enabledOrderTypes", has ? form.enabledOrderTypes.filter(x => x !== t) : [...form.enabledOrderTypes, t]);
  }

  return (
    <Layout>
      <PageHeader title="Token Display" subtitle="Configure customer token issuance and TV board" />
      <div className="p-6 max-w-3xl space-y-6">
        <Section title="General">
          <Toggle label="Enable token display" value={form.enabled} onChange={v => set("enabled", v)} testId="toggle-enabled" />
          <Field label="Reset mode">
            <select className="w-full border border-border rounded-md bg-background h-9 px-3"
              value={form.resetMode} onChange={e => set("resetMode", e.target.value as TokenSettings["resetMode"])}
              data-testid="select-reset-mode">
              <option value="daily">Daily (auto)</option>
              <option value="manual">Manual only</option>
            </select>
          </Field>
        </Section>

        <Section title="Numbering">
          <Field label="Prefix"><Input value={form.prefix} onChange={e => set("prefix", e.target.value.slice(0, 6))} data-testid="input-prefix" /></Field>
          <Field label="Start number"><Input type="number" min={1} value={form.startNumber} onChange={e => set("startNumber", Number(e.target.value))} data-testid="input-start" /></Field>
          <Field label="Max number"><Input type="number" min={1} value={form.maxNumber} onChange={e => set("maxNumber", Number(e.target.value))} data-testid="input-max" /></Field>
          <Field label="Padding (digits)"><Input type="number" min={1} max={6} value={form.padding} onChange={e => set("padding", Number(e.target.value))} data-testid="input-padding" /></Field>
          <Field label="Default counter"><Input type="number" min={1} value={form.defaultCounter} onChange={e => set("defaultCounter", Number(e.target.value))} data-testid="input-counter" /></Field>
        </Section>

        <Section title="Issuance">
          <div className="space-y-2">
            <Label>Issue tokens for these order types</Label>
            <div className="flex gap-3">
              {ORDER_TYPES.map(t => (
                <label key={t} className="flex items-center gap-2 text-sm capitalize cursor-pointer">
                  <input type="checkbox" checked={form.enabledOrderTypes.includes(t)} onChange={() => toggleOrderType(t)} data-testid={`check-ordertype-${t}`} />
                  {t.replace("_", " ")}
                </label>
              ))}
            </div>
          </div>
          <Toggle label="Show first name on display" value={form.showCustomerName} onChange={v => set("showCustomerName", v)} testId="toggle-show-name" />
          <Toggle label="Voice announcement on TV display" value={form.recallTtsEnabled} onChange={v => set("recallTtsEnabled", v)} testId="toggle-tts" />
        </Section>

        <Section title="WhatsApp">
          <Toggle label="Send WhatsApp when token is ready" value={form.whatsappOnReady} onChange={v => set("whatsappOnReady", v)} testId="toggle-whatsapp" />
          <Field label="Message template"
            hint="Variables: {name}, {token}, {counter}">
            <Textarea rows={3} value={form.whatsappTemplate} onChange={e => set("whatsappTemplate", e.target.value)} data-testid="input-template" />
          </Field>
        </Section>

        <div className="flex justify-end">
          <Button
            onClick={() => save.mutate(form, {
              onSuccess: () => toast({ title: "Settings saved" }),
              onError: (e) => toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }),
            })}
            disabled={save.isPending}
            data-testid="button-save"
          >
            Save
          </Button>
        </div>
      </div>
    </Layout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Toggle({ label, value, onChange, testId }: { label: string; value: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-center justify-between py-2 cursor-pointer">
      <span className="text-sm">{label}</span>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} data-testid={testId} />
    </label>
  );
}
