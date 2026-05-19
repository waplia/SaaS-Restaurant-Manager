import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles } from "lucide-react";
import { useRestaurantId } from "@/lib/hooks";
import { apiGet } from "@/lib/api";

interface ImportRow {
  id: number;
  source: string;
  status: string;
  fileName: string | null;
  totalRows: number;
  savedItemCount: number;
  needsReviewCount: number;
  estimatedCredits: number;
  actualCredits: number;
  createdAt: string;
  savedAt: string | null;
  rolledBackAt: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
  summary?: {
    photos?: { total: number; done: number; failed: number; skippedCredits: number };
  } | null;
}

function PhotosCell({ row }: { row: ImportRow }) {
  const p = row.summary?.photos;
  if (!p || p.total === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const allDone = p.done === p.total;
  const inFlight = p.done + p.failed + p.skippedCredits < p.total;
  let tone = "text-emerald-600";
  if (inFlight) tone = "text-amber-600";
  else if (!allDone) tone = "text-rose-600";
  const detailBits: string[] = [];
  if (p.failed > 0) detailBits.push(`${p.failed} failed`);
  if (p.skippedCredits > 0) detailBits.push(`${p.skippedCredits} no credits`);
  return (
    <div className="text-xs">
      <div className={`font-medium ${tone}`}>{p.done}/{p.total}</div>
      {detailBits.length > 0 && (
        <div className="text-muted-foreground">{detailBits.join(", ")}</div>
      )}
    </div>
  );
}

export default function AiMenuImportHistoryPage() {
  const restaurantId = useRestaurantId();
  const { data, isLoading } = useQuery({
    queryKey: ["ai-menu-imports", restaurantId],
    queryFn: () => apiGet<ImportRow[]>(`/restaurants/${restaurantId}/ai/menu-import/imports`),
  });

  return (
    <Layout>
      <PageHeader
        title="AI Menu Import — History"
        subtitle="All your past menu imports. Click any to view extracted items, save more, or roll back."
        actions={
          <Link href="/ai/menu-import">
            <Button size="sm" className="gap-1.5"><Sparkles className="w-3.5 h-3.5" /> New import</Button>
          </Link>
        }
      />

      <div className="p-6">
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : !data || data.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No imports yet. <Link href="/ai/menu-import" className="text-violet-600 underline">Run your first import</Link>.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left">When</th>
                    <th className="px-3 py-2 text-left">By</th>
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-left">File</th>
                    <th className="px-3 py-2 text-right">Items</th>
                    <th className="px-3 py-2 text-right">Saved</th>
                    <th className="px-3 py-2 text-right">Review</th>
                    <th className="px-3 py-2 text-right">Credits</th>
                    <th className="px-3 py-2 text-right">Photos</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(row => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{new Date(row.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs">
                        <div className="font-medium">{row.createdByName ?? "—"}</div>
                        {row.createdByEmail && <div className="text-muted-foreground">{row.createdByEmail}</div>}
                      </td>
                      <td className="px-3 py-2 capitalize">{row.source}</td>
                      <td className="px-3 py-2 truncate max-w-[260px]">{row.fileName ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{row.totalRows}</td>
                      <td className="px-3 py-2 text-right">{row.savedItemCount}</td>
                      <td className="px-3 py-2 text-right">{row.needsReviewCount}</td>
                      <td className="px-3 py-2 text-right">{row.actualCredits || row.estimatedCredits}</td>
                      <td className="px-3 py-2 text-right"><PhotosCell row={row} /></td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px] capitalize">{row.status.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/ai/menu-import/${row.id}`}>
                          <Button size="sm" variant="outline">Open</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
