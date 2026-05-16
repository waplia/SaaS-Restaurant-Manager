import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, Sparkles } from "lucide-react";
import { useAiSettings, useUpdateAiSettings, type AiSettings } from "@/lib/aiHooks";
import { AI_TONES, AI_LANGUAGES, AI_LENGTHS } from "@/lib/aiOptions";
import { useToast } from "@/hooks/use-toast";

const FEATURE_TOGGLES = [
  { key: "ai_description", label: "AI Item Descriptions", help: "Generate menu copy for individual dishes." },
  { key: "ai_food_image", label: "AI Food Images", help: "Generate professional food photographs." },
];

export default function AiSettingsPage() {
  const settings = useAiSettings();
  const update = useUpdateAiSettings();
  const { toast } = useToast();

  const [form, setForm] = useState<Partial<AiSettings>>({});

  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  function patch<K extends keyof AiSettings>(key: K, value: AiSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function patchToggle(key: string, value: boolean) {
    setForm((f) => ({ ...f, featureToggles: { ...(f.featureToggles ?? {}), [key]: value } }));
  }

  async function save() {
    try {
      await update.mutateAsync(form);
      toast({ title: "AI settings saved" });
    } catch (err) {
      toast({ title: "Could not save", description: (err as Error).message, variant: "destructive" });
    }
  }

  return (
    <Layout>
      <PageHeader
        title="AI Settings"
        subtitle="Defaults for tone, language and approval flow."
        actions={
          <Button onClick={save} disabled={update.isPending} className="gap-1.5">
            {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save changes
          </Button>
        }
      />

      <div className="p-6 max-w-3xl space-y-5">
        {settings.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-500" /> Generation defaults</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Default tone</Label>
                    <Select value={form.defaultTone ?? "simple"} onValueChange={(v) => patch("defaultTone", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AI_TONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Default language</Label>
                    <Select value={form.defaultLanguage ?? "en"} onValueChange={(v) => patch("defaultLanguage", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AI_LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Default length</Label>
                    <Select value={form.defaultLength ?? "short"} onValueChange={(v) => patch("defaultLength", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AI_LENGTHS.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">These defaults are applied whenever a staff member opens an AI tool. They can override per generation.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Approval flow</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <ToggleRow
                  label="Require approval for AI descriptions"
                  help="When on, generated text is saved as a draft and an owner/manager must approve before it replaces the item description."
                  value={!!form.requireApprovalForDescriptions}
                  onChange={(v) => patch("requireApprovalForDescriptions", v)}
                />
                <ToggleRow
                  label="Require approval for AI food images"
                  help="Recommended. Generated photos always need explicit approval before going live on the menu."
                  value={!!form.requireApprovalForImages}
                  onChange={(v) => patch("requireApprovalForImages", v)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Feature toggles</CardTitle></CardHeader>
              <CardContent className="divide-y divide-border">
                {FEATURE_TOGGLES.map((f) => {
                  const enabled = form.featureToggles?.[f.key] !== false; // default ON
                  return (
                    <div key={f.key} className="py-3 first:pt-0 last:pb-0">
                      <ToggleRow
                        label={f.label}
                        help={f.help}
                        value={enabled}
                        onChange={(v) => patchToggle(f.key, v)}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}

function ToggleRow({ label, help, value, onChange }: { label: string; help?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label className="cursor-pointer">{label}</Label>
        {help && <p className="text-xs text-muted-foreground mt-0.5">{help}</p>}
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}
