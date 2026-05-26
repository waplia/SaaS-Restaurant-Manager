import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { apiGet, apiPut } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert } from "lucide-react";

type GVSettings = { enabled: boolean };
const DEFAULTS: GVSettings = { enabled: true };
const SECTION = "guest-verification";

export default function SettingsGuestVerificationPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["settings", restaurantId, SECTION],
    queryFn: async () => {
      const res = await apiGet<{ data: Partial<GVSettings> }>(
        `/restaurants/${restaurantId}/settings/${SECTION}`,
      );
      return { ...DEFAULTS, ...(res?.data ?? {}) } as GVSettings;
    },
  });

  const [form, setForm] = useState<GVSettings>(DEFAULTS);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: (next: GVSettings) =>
      apiPut(`/restaurants/${restaurantId}/settings/${SECTION}`, next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", restaurantId, SECTION] });
      toast({ title: "Settings saved" });
    },
    onError: (e) => toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }),
  });

  if (isLoading) return <Layout><div className="p-6">Loading…</div></Layout>;

  return (
    <Layout>
      <PageHeader title="Guest Verification" subtitle="Anti-fraud hold for QR dine-in orders" />
      <div className="p-6 max-w-3xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex items-center justify-center flex-shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold">Hold QR orders for staff verification</h3>
              <p className="text-sm text-muted-foreground mt-1">
                When a guest places a QR dine-in order at a table not yet opened by staff,
                the kitchen ticket is held in <span className="font-medium">pending acceptance</span>.
                A waiter must physically verify the guest and accept before the kitchen starts.
                Staff-opened tables and online-paid orders are never held.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Turn this off if you trust QR orders implicitly — every QR order will fire to the kitchen immediately.
              </p>
            </div>
          </div>

          <label className="flex items-center justify-between py-2 cursor-pointer border-t border-border pt-4">
            <span className="text-sm font-medium">Enable guest verification hold</span>
            <input
              type="checkbox"
              className="w-5 h-5 cursor-pointer"
              checked={form.enabled}
              onChange={e => setForm({ ...form, enabled: e.target.checked })}
              data-testid="toggle-guest-verification"
            />
          </label>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => save.mutate(form)}
            disabled={save.isPending || form.enabled === data?.enabled}
            data-testid="button-save"
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
