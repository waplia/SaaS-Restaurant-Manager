import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiFetch, apiPost } from "@/lib/api";
import { Megaphone } from "lucide-react";

interface Announcement { id: number; title: string; body: string; priority: string; publishedAt: string; expiresAt: string | null; read: boolean }

export default function PortalAnnouncementsPage() {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery<Announcement[]>({ queryKey: ["portal-announcements"], queryFn: () => apiFetch("/portal/announcements") });

  const markRead = useMutation({
    mutationFn: (id: number) => apiPost(`/portal/announcements/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-announcements"] }),
  });

  // Auto-mark unread items as read as the user views the page. We track the
  // ids we've already dispatched a mark-read for so re-renders (or refetches
  // that briefly include the same unread item before the backend reflects the
  // read flag) cannot retrigger the mutation and cause a render→mutate→
  // invalidate→refetch loop ("Maximum update depth exceeded").
  const dispatchedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const a of list) {
      if (a.read) continue;
      if (dispatchedRef.current.has(a.id)) continue;
      dispatchedRef.current.add(a.id);
      markRead.mutate(a.id);
    }
    // markRead is a stable mutation object; depending on `list` (reference) is
    // intentional — the ref guard above makes the body idempotent per id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-3 max-w-3xl mx-auto">
        <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2"><Megaphone className="w-6 h-6" />Announcements</h1>
        {list.length === 0 ? <p className="text-sm text-muted-foreground">No announcements.</p> : (
          <div className="space-y-2">
            {list.map(a => (
              <Card key={a.id}><CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{a.title}</p>
                    {a.priority !== "normal" && <Badge variant={a.priority === "urgent" ? "destructive" : "secondary"} className="text-[10px] capitalize">{a.priority}</Badge>}
                  </div>
                  {!a.read && <span className="w-2 h-2 rounded-full bg-primary" />}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{new Date(a.publishedAt).toLocaleString()}</p>
                <p className="text-sm whitespace-pre-wrap mt-2">{a.body}</p>
              </CardContent></Card>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
