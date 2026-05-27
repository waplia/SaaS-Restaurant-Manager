import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Smartphone, Apple, Monitor, Globe, Download, BookOpen, FileText, ExternalLink, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { apiFetch, apiPost } from "@/lib/api";
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
  forceUpdate: boolean;
  recommendedUpdate: boolean;
}

interface ApiResponse {
  platforms: Record<Platform, { latest: DownloadRow | null; versions: DownloadRow[] }>;
}

const PLATFORM_META: Record<Platform, { label: string; icon: typeof Smartphone; description: string }> = {
  android: { label: "Android", icon: Smartphone, description: "Install the TableTrack app on Android phones and tablets" },
  ios: { label: "iOS", icon: Apple, description: "Install the TableTrack app on iPhone and iPad" },
  windows: { label: "Windows", icon: Monitor, description: "Desktop POS client for Windows 10 / 11" },
  macos: { label: "macOS", icon: Apple, description: "Desktop POS client for macOS" },
  web: { label: "Web / PWA", icon: Globe, description: "Install the TableTrack web app to your home screen" },
};

function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DownloadAppsPage() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey: ["app-downloads"],
    queryFn: () => apiFetch("/app-downloads"),
  });

  const track = useMutation({
    mutationFn: (payload: { platform: Platform; action: "viewed" | "downloaded" | "opened_guide"; appDownloadId?: number; version?: string }) =>
      apiPost("/app-downloads/track", payload).catch(() => null),
  });

  const [guideFor, setGuideFor] = useState<DownloadRow | null>(null);
  const [notesFor, setNotesFor] = useState<DownloadRow | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  // Resolve a short-lived signed URL on the fly so uploaded binaries are
  // never exposed as long-lived public links. External / store links come
  // straight back from the same endpoint, so the UI flow stays the same.
  const startDownload = async (row: DownloadRow) => {
    setResolvingId(row.id);
    try {
      const res = await apiFetch<{ url: string; kind: string }>(`/app-downloads/${row.id}/download-url`);
      track.mutate({ platform: row.platform, action: "downloaded", appDownloadId: row.id, version: row.version });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "Download failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setResolvingId(null);
    }
  };

  const platforms: Platform[] = ["android", "ios", "windows", "macos", "web"];
  const anyConfigured = platforms.some((p) => data?.platforms?.[p]?.latest);

  return (
    <Layout>
      <PageHeader
        title="Download Apps"
        subtitle="Get the TableTrack app for your phone, tablet, or desktop"
      />
      <div className="p-6 max-w-6xl mx-auto">
        {isLoading && (
          <div className="text-center py-16 text-muted-foreground">Loading…</div>
        )}

        {!isLoading && !anyConfigured && (
          <div className="text-center py-16 bg-card border border-border rounded-xl">
            <Smartphone className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold">No app downloads are available yet</h2>
            <p className="text-sm text-muted-foreground mt-2">Please contact support to get installation links.</p>
          </div>
        )}

        {!isLoading && anyConfigured && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {platforms.map((p) => {
              const entry = data?.platforms?.[p];
              const row = entry?.latest;
              const Icon = PLATFORM_META[p].icon;
              const isAvailable = !!row && row.status === "available";
              const isComingSoon = !row || row.status === "coming_soon";
              const hasDownload = !!row && (row.downloadType === "uploaded_file" ? !!row.uploadedFileUrl : !!row.downloadUrl);
              const isResolving = row ? resolvingId === row.id : false;

              return (
                <div key={p} className="bg-card border border-border rounded-xl p-5 flex flex-col">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                      {row?.iconUrl
                        ? <img src={row.iconUrl} alt="" className="w-12 h-12 rounded-xl object-cover" />
                        : <Icon className="w-6 h-6" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold leading-tight truncate">{row?.appName ?? PLATFORM_META[p].label}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{PLATFORM_META[p].label}</p>
                    </div>
                    <div>
                      {isAvailable && <Badge variant="default" className="text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />Available</Badge>}
                      {isComingSoon && <Badge variant="secondary" className="text-[10px]"><Clock className="w-3 h-3 mr-1" />Coming soon</Badge>}
                      {!isComingSoon && !isAvailable && <Badge variant="outline" className="text-[10px]">{row?.status}</Badge>}
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mt-3 line-clamp-2">
                    {row?.description ?? PLATFORM_META[p].description}
                  </p>

                  <dl className="mt-3 text-xs grid grid-cols-2 gap-y-1">
                    {row?.version && (<><dt className="text-muted-foreground">Version</dt><dd className="text-right font-medium">v{row.version}</dd></>)}
                    {row?.releaseDate && (<><dt className="text-muted-foreground">Updated</dt><dd className="text-right">{row.releaseDate}</dd></>)}
                    {row?.fileSize ? (<><dt className="text-muted-foreground">Size</dt><dd className="text-right">{formatSize(row.fileSize)}</dd></>) : null}
                    {(p === "windows" || p === "macos") && row?.minimumOsVersion && (
                      <><dt className="text-muted-foreground">Min OS</dt><dd className="text-right">{row.minimumOsVersion}</dd></>
                    )}
                  </dl>

                  <div className="mt-4 flex flex-col gap-2">
                    {isAvailable && hasDownload && row ? (
                      <Button disabled={isResolving} onClick={() => startDownload(row)}>
                        {isResolving ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Preparing…</>
                        ) : row.downloadType === "uploaded_file" ? (
                          <><Download className="w-4 h-4 mr-2" />Download</>
                        ) : (
                          <><ExternalLink className="w-4 h-4 mr-2" />Open {row.downloadType === "store_link" ? "Store" : "Link"}</>
                        )}
                      </Button>
                    ) : (
                      <Button disabled variant="outline">{isComingSoon ? "Coming soon" : "Not available"}</Button>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm" variant="ghost" disabled={!row?.installationGuide}
                        onClick={() => { if (row) { setGuideFor(row); track.mutate({ platform: p, action: "opened_guide", appDownloadId: row.id, version: row.version }); } }}
                      >
                        <BookOpen className="w-4 h-4 mr-2" /> Install guide
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!row?.releaseNotes} onClick={() => row && setNotesFor(row)}>
                        <FileText className="w-4 h-4 mr-2" /> Release notes
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <ViewedTracker />
      </div>

      <Dialog open={!!guideFor} onOpenChange={(o) => !o && setGuideFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Installation guide — {guideFor ? PLATFORM_META[guideFor.platform].label : ""}</DialogTitle>
            <DialogDescription>{guideFor?.appName} v{guideFor?.version}</DialogDescription>
          </DialogHeader>
          <div className="whitespace-pre-wrap text-sm text-foreground max-h-[60vh] overflow-y-auto">
            {guideFor?.installationGuide ?? ""}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!notesFor} onOpenChange={(o) => !o && setNotesFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Release notes — {notesFor?.appName} v{notesFor?.version}</DialogTitle>
            {notesFor?.releaseDate && <DialogDescription>{notesFor.releaseDate}</DialogDescription>}
          </DialogHeader>
          <div className="whitespace-pre-wrap text-sm text-foreground max-h-[60vh] overflow-y-auto">
            {notesFor?.releaseNotes ?? ""}
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function ViewedTracker() {
  // Fire one "viewed" event per platform on every page mount so analytics
  // reflects total page views, not unique sessions.
  const { data } = useQuery<ApiResponse>({ queryKey: ["app-downloads"] });
  const track = useMutation({
    mutationFn: (payload: { platform: Platform; action: "viewed"; appDownloadId?: number; version?: string }) =>
      apiPost("/app-downloads/track", payload).catch(() => null),
  });
  useEffect(() => {
    if (!data?.platforms) return;
    for (const p of Object.keys(data.platforms) as Platform[]) {
      const row = data.platforms[p]?.latest;
      if (row) track.mutate({ platform: p, action: "viewed", appDownloadId: row.id, version: row.version });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return null;
}
