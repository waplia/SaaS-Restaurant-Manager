import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api";
import { Lock, Plus, Trash2, Copy, AlertTriangle, Info } from "lucide-react";

interface ScopeDef { key: string; label: string; description: string; category: string; write: boolean }
interface OauthApp {
  id: number; name: string; description: string | null; clientId: string;
  clientSecretPrefix: string; redirectUris: string[]; scopes: string[];
  status: "draft" | "published" | "suspended"; homepageUrl: string | null; createdAt: string;
}

export default function OauthAppsPage() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [homepage, setHomepage] = useState("");
  const [redirects, setRedirects] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<{ clientId: string; clientSecret: string; name: string } | null>(null);

  const { data: apps = [] } = useQuery({
    queryKey: ["oauth-apps", restaurantId],
    queryFn: () => apiGet<OauthApp[]>(`/restaurants/${restaurantId}/oauth-apps`),
  });
  const { data: scopeCatalog = { data: [] as ScopeDef[] } } = useQuery({
    queryKey: ["api-scopes", restaurantId],
    queryFn: () => apiGet<{ data: ScopeDef[] }>(`/restaurants/${restaurantId}/api-scopes`),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; description: string | null; homepageUrl: string | null; redirectUris: string[]; scopes: string[] }) =>
      apiPost<{ clientId: string; clientSecret: string; name: string }>(`/restaurants/${restaurantId}/oauth-apps`, body),
    onSuccess: data => {
      setCreated(data);
      setName(""); setDescription(""); setHomepage(""); setRedirects(""); setSelectedScopes(new Set());
      qc.invalidateQueries({ queryKey: ["oauth-apps", restaurantId] });
    },
    onError: (e: unknown) => toast({ title: "Failed", description: e instanceof ApiError ? e.message : "", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${restaurantId}/oauth-apps/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["oauth-apps", restaurantId] }); toast({ title: "App deleted" }); },
  });

  const onCreate = () => {
    if (!name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    const uris = redirects.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    if (uris.some(u => !/^https?:\/\//i.test(u))) { toast({ title: "Redirect URIs must start with http(s)://", variant: "destructive" }); return; }
    create.mutate({
      name: name.trim(),
      description: description.trim() || null,
      homepageUrl: homepage.trim() || null,
      redirectUris: uris,
      scopes: Array.from(selectedScopes),
    });
  };

  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast({ title: "Copied" }));

  return (
    <SettingsLayout activeKey="oauth-apps" title="OAuth Applications" subtitle="Register apps that will let other restaurants connect to your integration.">
      <div className="space-y-6">
        <div className="rounded border border-blue-500/30 bg-blue-50 dark:bg-blue-950/30 p-3 flex gap-2 text-xs">
          <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <p className="text-blue-900 dark:text-blue-100">
            OAuth client credentials let you build user-installable integrations. The OAuth authorization flow itself is on the roadmap —
            for now you can register clients and store credentials, but the live authorize/token endpoints are not yet active.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card/40 p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Plus className="w-4 h-4" /> Register new OAuth app</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">App name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="My Integration" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Homepage URL</Label><Input value={homepage} onChange={e => setHomepage(e.target.value)} placeholder="https://example.com" /></div>
          </div>
          <div className="space-y-1.5 mt-3"><Label className="text-xs">Description</Label><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What does your app do?" /></div>
          <div className="space-y-1.5 mt-3">
            <Label className="text-xs">Redirect URIs (one per line)</Label>
            <textarea value={redirects} onChange={e => setRedirects(e.target.value)} rows={3}
              className="w-full px-3 py-2 text-xs font-mono border border-border bg-background rounded" placeholder="https://example.com/oauth/callback" />
          </div>
          <div className="mt-3">
            <Label className="text-xs">Requested scopes ({selectedScopes.size})</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1.5">
              {scopeCatalog.data.map(s => (
                <label key={s.key} className="flex items-start gap-2 px-2.5 py-1.5 rounded border border-border bg-background text-xs cursor-pointer hover:bg-accent/40">
                  <input type="checkbox" checked={selectedScopes.has(s.key)}
                    onChange={() => setSelectedScopes(prev => { const n = new Set(prev); n.has(s.key) ? n.delete(s.key) : n.add(s.key); return n; })} className="mt-0.5" />
                  <div className="flex-1 min-w-0"><code className="font-mono text-[11px]">{s.key}</code><p className="text-[10px] text-muted-foreground truncate">{s.description}</p></div>
                </label>
              ))}
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button onClick={onCreate} disabled={create.isPending}>{create.isPending ? "Creating…" : "Create app"}</Button>
          </div>
        </div>

        {created && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Save the client secret — it will not be shown again.</p>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Client ID</Label>
                    <div className="flex gap-2 mt-1"><code className="flex-1 px-2 py-1.5 bg-background border border-border rounded text-xs font-mono break-all">{created.clientId}</code><Button size="sm" variant="outline" onClick={() => copy(created.clientId)}><Copy className="w-3.5 h-3.5" /></Button></div>
                  </div>
                  <div>
                    <Label className="text-xs">Client secret</Label>
                    <div className="flex gap-2 mt-1"><code className="flex-1 px-2 py-1.5 bg-background border border-border rounded text-xs font-mono break-all">{created.clientSecret}</code><Button size="sm" variant="outline" onClick={() => copy(created.clientSecret)}><Copy className="w-3.5 h-3.5" /></Button></div>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>I've saved it — dismiss</Button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <Lock className="w-4 h-4" /><h3 className="text-sm font-semibold">Your OAuth apps</h3>
            <span className="ml-auto text-xs text-muted-foreground">{apps.length} total</span>
          </div>
          {apps.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No OAuth apps registered yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr><th className="text-left px-4 py-2 font-medium">Name</th><th className="text-left px-4 py-2 font-medium">Client ID</th><th className="text-left px-4 py-2 font-medium">Status</th><th className="text-left px-4 py-2 font-medium">Scopes</th><th className="px-4 py-2"></th></tr>
              </thead>
              <tbody>
                {apps.map(a => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-medium">{a.name}{a.description && <p className="text-[10px] text-muted-foreground">{a.description}</p>}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{a.clientId}</td>
                    <td className="px-4 py-2.5"><span className="text-[10px] px-1.5 py-0.5 rounded bg-muted">{a.status}</span></td>
                    <td className="px-4 py-2.5 text-xs">{a.scopes.length}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete "${a.name}"?`)) remove.mutate(a.id); }}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </SettingsLayout>
  );
}
