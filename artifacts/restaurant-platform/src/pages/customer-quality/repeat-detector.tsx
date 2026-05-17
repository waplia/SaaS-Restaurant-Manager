import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Repeat, RefreshCw, X } from "lucide-react";
import { useRepeatClusters, useDismissCluster, useRebuildClusters } from "@/lib/hooks-customer-quality";

export default function RepeatDetectorPage() {
  const { data, isLoading } = useRepeatClusters();
  const dismiss = useDismissCluster();
  const rebuild = useRebuildClusters();
  const clusters = data?.clusters ?? [];

  return (
    <Layout>
      <PageHeader title="Repeat Complaint Detector" description="Clusters of repeating issues by category, item, or staff" icon={Repeat}
        actions={<Button variant="outline" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}><RefreshCw className="h-4 w-4 mr-1" />Rebuild now</Button>} />
      <div className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && clusters.length === 0 && (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No repeat patterns detected. The nightly job builds these from complaint history.</CardContent></Card>
        )}
        {clusters.map((c: any) => (
          <Card key={c.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <CardTitle className="text-base">{c.clusterLabel}</CardTitle>
              <Badge variant="destructive">{c.complaintCount} complaints</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Window: {new Date(c.windowStart).toLocaleDateString()} – {new Date(c.windowEnd).toLocaleDateString()}</p>
              <p className="text-xs text-muted-foreground mt-1">Sample complaint IDs: {(c.sampleComplaintIds ?? []).join(", ")}</p>
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="outline" onClick={() => dismiss.mutate({ id: c.id, reason: "addressed" })}>
                  <X className="h-4 w-4 mr-1" /> Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
