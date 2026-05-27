import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Upload, Trash2, Star, Archive, Copy, ExternalLink, Loader2, Smartphone, Apple, Monitor, Globe } from "lucide-react";
import { apiFetch, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type Platform = "android" | "ios" | "windows" | "macos" | "web";
type Status = "available" | "coming_soon" | "deprecated" | "archived";
type DownloadType = "uploaded_file" | "external_link" | "store_link";

interface DownloadRow {
  id: number;
  platform: Platform;
  appName: string;
  description: string | null;
  version: string;
  buildNumber: string | null;
  releaseDate: string | null;
  status: Status;
  downloadType: DownloadType;
  downloadUrl: string | null;
  uploadedFileUrl: string | null;
  fileSize: number | null;
  iconUrl: string | null;
  minimumOsVersion: string | null;
  systemRequirements: string | null;
  releaseNotes: string | null;
  installationGuide: string | null;
  isLatest: boolean;
  isVisible: boolean;
  forceUpdate: boolean;
  recommendedUpdate: boolean;
  allowedPlansJson: number[] | null;
  allowedRestaurantsJson: number[] | null;
  createdAt: string;
  updatedAt: string;
}

const PLATFORM_META: Record<Platform, { label: string; icon: typeof Smartphone }> = {
  android: { label: "Android", icon: Smartphone },
  ios: { label: "iOS", icon: Apple },
  windows: { label: "Windows", icon: Monitor },
  macos: { label: "macOS", icon: Apple },
  web: { label: "Web / PWA", icon: Globe },
};

const STATUS_LABEL: Record<Status, string> = {
  available: "Available",
  coming_soon: "Coming soon",
  deprecated: "Deprecated",
  archived: "Archived",
};

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type FormState = Partial<DownloadRow> & { platform: Platform };

function emptyForm(platform: Platform): FormState {
  return {
    platform,
    appName: platform === "android" ? "TableTrack for Android"
      : platform === "ios" ? "TableTrack for iOS"
      : platform === "windows" ? "TableTrack Desktop (Windows)"
      : platform === "macos" ? "TableTrack Desktop (macOS)"
      : "TableTrack Web App",
    version: "1.0.0",
    status: "available",
    downloadType: platform === "ios" ? "store_link" : "uploaded_file",
    isLatest: true,
    isVisible: true,
    forceUpdate: false,
    recommendedUpdate: false,
  };
}

async function uploadAsset(file: File, platform: Platform, kind: "binary" | "icon"): Promise<{ publicUrl: string; size: number | null }> {
  const presign = await apiPost<{ uploadURL: string; objectPath: string; maxBytes?: number }>(
    "/admin/app-downloads/uploads/request-url",
    { kind, platform, name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
  );
  if (presign.maxBytes && file.size > presign.maxBytes) {
    throw new Error(`File too large. Max ${Math.round(presign.maxBytes / 1024 / 1024)} MB.`);
  }
  const put = await fetch(presign.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);
  let lastErr: unknown;
  for (const wait of [0, 400, 900]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const fin = await apiPost<{ publicUrl: string; size: number | null }>(
        "/admin/app-downloads/uploads/finalize",
        { objectPath: presign.objectPath, kind },
      );
      return { publicUrl: fin.publicUrl, size: fin.size ?? file.size };
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      if (status !== 404) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Couldn't finalize the upload");
}

export default function AdminAppDownloadsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<FormState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: list } = useQuery<{ items: DownloadRow[] }>({
    queryKey: ["admin-app-downloads"],
    queryFn: () => apiFetch("/admin/app-downloads"),
  });
  const { data: analytics } = useQuery<{
    totals: Array<{ platform: Platform; action: string; count: number }>;
    topApps: Array<{ appDownloadId: number; platform: Platform; version: string; count: number }>;
    restaurantsOnOldVersions: Record<string, number>;
  }>({
    queryKey: ["admin-app-downloads-analytics"],
    queryFn: () => apiFetch("/admin/app-downloads/analytics/summary"),
  });

  const grouped = useMemo(() => {
    const out: Record<Platform, DownloadRow[]> = { android: [], ios: [], windows: [], macos: [], web: [] };
    for (const row of list?.items ?? []) out[row.platform]?.push(row);
    return out;
  }, [list]);

  const markLatest = useMutation({
    mutationFn: (id: number) => apiPost(`/admin/app-downloads/${id}/mark-latest`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin-app-downloads"] }); toast({ title: "Marked as latest" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const archive = useMutation({
    mutationFn: (id: number) => apiPost(`/admin/app-downloads/${id}/archive`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin-app-downloads"] }); toast({ title: "Archived" }); },
  });
  const removeMut = useMutation({
    mutationFn: (id: number) => apiDelete(`/admin/app-downloads/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin-app-downloads"] }); toast({ title: "Deleted" }); },
  });

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = {
        platform: editing.platform,
        appName: editing.appName,
        description: editing.description ?? null,
        version: editing.version,
        buildNumber: editing.buildNumber ?? null,
        releaseDate: editing.releaseDate ?? null,
        status: editing.status ?? "available",
        downloadType: editing.downloadType ?? "uploaded_file",
        downloadUrl: editing.downloadUrl ?? null,
        uploadedFileUrl: editing.uploadedFileUrl ?? null,
        fileSize: editing.fileSize ?? null,
        iconUrl: editing.iconUrl ?? null,
        minimumOsVersion: editing.minimumOsVersion ?? null,
        systemRequirements: editing.systemRequirements ?? null,
        releaseNotes: editing.releaseNotes ?? null,
        installationGuide: editing.installationGuide ?? null,
        isLatest: !!editing.isLatest,
        isVisible: editing.isVisible !== false,
        forceUpdate: !!editing.forceUpdate,
        recommendedUpdate: !!editing.recommendedUpdate,
        allowedPlansJson: editing.allowedPlansJson ?? null,
        allowedRestaurantsJson: editing.allowedRestaurantsJson ?? null,
      };
      if (editing.id) {
        await apiPatch(`/admin/app-downloads/${editing.id}`, payload);
      } else {
        await apiPost("/admin/app-downloads", payload);
      }
      toast({ title: editing.id ? "Updated" : "Created" });
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["admin-app-downloads"] });
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = (row: DownloadRow) => {
    const url = row.downloadType === "uploaded_file" ? row.uploadedFileUrl : row.downloadUrl;
    if (!url) return;
    const full = url.startsWith("http") ? url : `${window.location.origin}${url}`;
    navigator.clipboard.writeText(full).then(() => toast({ title: "Link copied" }));
  };

  return (
    <AdminLayout
      title="App Downloads"
      subtitle="Publish and manage installable apps shown to restaurants"
      actions={
        <Button variant="outline" asChild>
          <a href="/download-apps" target="_blank" rel="noreferrer">
            <ExternalLink className="w-4 h-4 mr-2" /> Preview restaurant page
          </a>
        </Button>
      }
    >
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Analytics summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Downloads by platform</p>
            <div className="mt-2 grid grid-cols-5 gap-2 text-center">
              {(Object.keys(PLATFORM_META) as Platform[]).map((p) => {
                const n = (analytics?.totals ?? []).filter((t) => t.platform === p && t.action === "downloaded").reduce((s, x) => s + x.count, 0);
                return (
                  <div key={p}>
                    <div className="text-lg font-semibold">{n}</div>
                    <div className="text-[10px] text-muted-foreground uppercase">{PLATFORM_META[p].label}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Most downloaded</p>
            <div className="mt-2 space-y-1 text-sm">
              {(analytics?.topApps ?? []).slice(0, 3).map((t, i) => (
                <div key={i} className="flex justify-between">
                  <span>{PLATFORM_META[t.platform]?.label ?? t.platform} v{t.version ?? "?"}</span>
                  <span className="font-medium">{t.count}</span>
                </div>
              ))}
              {(analytics?.topApps ?? []).length === 0 && <p className="text-muted-foreground">No downloads yet</p>}
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Restaurants on old versions</p>
            <div className="mt-2 space-y-1 text-sm">
              {(Object.keys(PLATFORM_META) as Platform[]).map((p) => (
                <div key={p} className="flex justify-between">
                  <span>{PLATFORM_META[p].label}</span>
                  <span className="font-medium">{analytics?.restaurantsOnOldVersions?.[p] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {(Object.keys(PLATFORM_META) as Platform[]).map((platform) => {
          const Icon = PLATFORM_META[platform].icon;
          const rows = grouped[platform];
          const latest = rows.find((r) => r.isLatest);
          return (
            <section key={platform} className="bg-card border border-border rounded-xl overflow-hidden">
              <header className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold">{PLATFORM_META[platform].label}</h2>
                    <p className="text-xs text-muted-foreground">
                      {latest ? `Latest: v${latest.version}${latest.releaseDate ? ` · ${latest.releaseDate}` : ""}` : "No version published"}
                    </p>
                  </div>
                </div>
                <Button size="sm" onClick={() => setEditing(emptyForm(platform))}>
                  <Plus className="w-4 h-4 mr-2" /> Add version
                </Button>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-4 py-2">Version</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2">Size</th>
                      <th className="px-4 py-2">Released</th>
                      <th className="px-4 py-2">Visibility</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No versions yet</td></tr>
                    )}
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">v{r.version}</span>
                            {r.isLatest && <Badge variant="default" className="text-[10px]">LATEST</Badge>}
                            {r.forceUpdate && <Badge variant="destructive" className="text-[10px]">FORCE</Badge>}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{r.appName}</div>
                        </td>
                        <td className="px-4 py-2">{STATUS_LABEL[r.status]}</td>
                        <td className="px-4 py-2 capitalize">{r.downloadType.replace("_", " ")}</td>
                        <td className="px-4 py-2">{formatSize(r.fileSize)}</td>
                        <td className="px-4 py-2">{r.releaseDate ?? "—"}</td>
                        <td className="px-4 py-2">
                          {r.isVisible ? "Visible" : "Hidden"}
                          {(r.allowedPlansJson?.length || r.allowedRestaurantsJson?.length)
                            ? <span className="ml-1 text-[10px] text-muted-foreground">(restricted)</span> : null}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="inline-flex gap-1">
                            <Button size="sm" variant="ghost" title="Copy link" onClick={() => copyUrl(r)}>
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            {!r.isLatest && (
                              <Button size="sm" variant="ghost" title="Mark latest" onClick={() => markLatest.mutate(r.id)}>
                                <Star className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setEditing(r as FormState)}>Edit</Button>
                            {r.status !== "archived" && (
                              <Button size="sm" variant="ghost" title="Archive" onClick={() => archive.mutate(r.id)}>
                                <Archive className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" title="Delete"
                              onClick={() => { if (confirm(`Delete v${r.version}?`)) removeMut.mutate(r.id); }}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit version" : "Add version"}</DialogTitle>
            <DialogDescription>
              {editing ? PLATFORM_META[editing.platform].label : ""}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>App name</Label>
                  <Input value={editing.appName ?? ""} onChange={(e) => setEditing({ ...editing, appName: e.target.value })} />
                </div>
                <div>
                  <Label>Version</Label>
                  <Input value={editing.version ?? ""} onChange={(e) => setEditing({ ...editing, version: e.target.value })} />
                </div>
                <div>
                  <Label>Build number</Label>
                  <Input value={editing.buildNumber ?? ""} onChange={(e) => setEditing({ ...editing, buildNumber: e.target.value })} />
                </div>
                <div>
                  <Label>Release date</Label>
                  <Input type="date" value={editing.releaseDate ?? ""} onChange={(e) => setEditing({ ...editing, releaseDate: e.target.value || null })} />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={editing.status ?? "available"} onValueChange={(v) => setEditing({ ...editing, status: v as Status })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Min OS version</Label>
                  <Input value={editing.minimumOsVersion ?? ""} onChange={(e) => setEditing({ ...editing, minimumOsVersion: e.target.value })} />
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <Textarea rows={2} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>

              <div>
                <Label>Download type</Label>
                <Select value={editing.downloadType ?? "uploaded_file"} onValueChange={(v) => setEditing({ ...editing, downloadType: v as DownloadType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="uploaded_file">Uploaded file (APK/AAB/EXE/DMG/ZIP)</SelectItem>
                    <SelectItem value="external_link">External link</SelectItem>
                    <SelectItem value="store_link">App Store / Play Store link</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editing.downloadType === "uploaded_file" ? (
                <div className="space-y-2">
                  <Label>Binary file</Label>
                  {editing.uploadedFileUrl && (
                    <p className="text-xs text-muted-foreground break-all">Current: {editing.uploadedFileUrl}</p>
                  )}
                  <input type="file" disabled={uploading} onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setUploading(true);
                    try {
                      const { publicUrl, size } = await uploadAsset(f, editing.platform, "binary");
                      setEditing({ ...editing, uploadedFileUrl: publicUrl, fileSize: size });
                      toast({ title: "Uploaded" });
                    } catch (err) {
                      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
                    } finally {
                      setUploading(false);
                      e.target.value = "";
                    }
                  }} />
                  {uploading && <p className="text-xs flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</p>}
                </div>
              ) : (
                <div>
                  <Label>Download URL</Label>
                  <Input placeholder="https://…" value={editing.downloadUrl ?? ""} onChange={(e) => setEditing({ ...editing, downloadUrl: e.target.value })} />
                </div>
              )}

              <div className="space-y-2">
                <Label>App icon (optional)</Label>
                <div className="flex items-center gap-3">
                  {editing.iconUrl && (
                    <img src={editing.iconUrl} alt="" className="w-12 h-12 rounded-xl object-cover ring-1 ring-border" />
                  )}
                  <div className="flex-1">
                    <input type="file" accept="image/*" disabled={uploading} onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setUploading(true);
                      try {
                        const { publicUrl } = await uploadAsset(f, editing.platform, "icon");
                        setEditing({ ...editing, iconUrl: publicUrl });
                        toast({ title: "Icon uploaded" });
                      } catch (err) {
                        toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
                      } finally {
                        setUploading(false);
                        e.target.value = "";
                      }
                    }} />
                    {editing.iconUrl && (
                      <button type="button" className="text-xs text-muted-foreground mt-1 hover:text-foreground"
                        onClick={() => setEditing({ ...editing, iconUrl: null })}>
                        Remove icon
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <Label>System requirements</Label>
                <Textarea rows={2} value={editing.systemRequirements ?? ""} onChange={(e) => setEditing({ ...editing, systemRequirements: e.target.value })} />
              </div>
              <div>
                <Label>Release notes</Label>
                <Textarea rows={4} value={editing.releaseNotes ?? ""} onChange={(e) => setEditing({ ...editing, releaseNotes: e.target.value })} />
              </div>
              <div>
                <Label>Installation guide</Label>
                <Textarea rows={4} value={editing.installationGuide ?? ""} onChange={(e) => setEditing({ ...editing, installationGuide: e.target.value })} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Allowed plan IDs (comma-separated; empty = all)</Label>
                  <Input
                    value={editing.allowedPlansJson?.join(", ") ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
                      setEditing({ ...editing, allowedPlansJson: v.length ? v : null });
                    }}
                  />
                </div>
                <div>
                  <Label>Allowed restaurant IDs (comma-separated; empty = all)</Label>
                  <Input
                    value={editing.allowedRestaurantsJson?.join(", ") ?? ""}
                    onChange={(e) => {
                      const v = e.target.value.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
                      setEditing({ ...editing, allowedRestaurantsJson: v.length ? v : null });
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center justify-between border rounded-md px-3 py-2">
                  <span className="text-sm">Mark as latest</span>
                  <Switch checked={!!editing.isLatest} onCheckedChange={(v) => setEditing({ ...editing, isLatest: v })} />
                </label>
                <label className="flex items-center justify-between border rounded-md px-3 py-2">
                  <span className="text-sm">Visible to restaurants</span>
                  <Switch checked={editing.isVisible !== false} onCheckedChange={(v) => setEditing({ ...editing, isVisible: v })} />
                </label>
                <label className="flex items-center justify-between border rounded-md px-3 py-2">
                  <span className="text-sm">Recommended update</span>
                  <Switch checked={!!editing.recommendedUpdate} onCheckedChange={(v) => setEditing({ ...editing, recommendedUpdate: v })} />
                </label>
                <label className="flex items-center justify-between border rounded-md px-3 py-2">
                  <span className="text-sm">Force update</span>
                  <Switch checked={!!editing.forceUpdate} onCheckedChange={(v) => setEditing({ ...editing, forceUpdate: v })} />
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving || uploading}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
