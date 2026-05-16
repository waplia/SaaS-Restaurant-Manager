import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, TrendingDown, TrendingUp, Minus, Tag, AlertCircle } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useRestaurantId, useMenuItems } from "@/lib/hooks";
import { formatCurrency } from "@/lib/utils";

interface Competitor {
  id: number;
  name: string;
  area: string | null;
}
interface CompetitorItem {
  id: number;
  competitorId: number;
  name: string;
  category: string | null;
  price: string | null;
  offer: string | null;
  notes: string | null;
  isNew: boolean;
  linkedMenuItemId: number | null;
}
interface OverviewResponse {
  competitors: Competitor[];
  items: CompetitorItem[];
}
interface MyMenuItem {
  id: number;
  name: string;
  price: string | number;
  isActive?: boolean;
}
interface MyCoupon {
  id: number;
  code: string;
  discountType: string;
  discountValue: string;
  isActive: boolean;
}

export default function CompetitorComparisonPage() {
  const restaurantId = useRestaurantId();

  const { data, isLoading } = useQuery({
    queryKey: ["competitors-overview", restaurantId],
    queryFn: () => apiGet<OverviewResponse>(`/restaurants/${restaurantId}/competitors-overview`),
  });
  const { data: myMenuItemsRaw = [], isLoading: loadingMenu } = useMenuItems();
  const { data: myCoupons = [] } = useQuery({
    queryKey: ["my-coupons", restaurantId],
    queryFn: () => apiGet<MyCoupon[]>(`/restaurants/${restaurantId}/coupons`),
  });

  const myMenuItems = myMenuItemsRaw as MyMenuItem[];
  const competitors = data?.competitors ?? [];
  const items = data?.items ?? [];

  const competitorById = useMemo(() => {
    const m = new Map<number, Competitor>();
    for (const c of competitors) m.set(c.id, c);
    return m;
  }, [competitors]);

  // Match competitor items to my menu items: prefer manual link, else case-insensitive name match.
  const matchedByMyItemId = useMemo(() => {
    const map = new Map<number, CompetitorItem[]>();
    const myByLowerName = new Map<string, MyMenuItem>();
    for (const m of myMenuItems) myByLowerName.set(m.name.trim().toLowerCase(), m);
    for (const it of items) {
      let myId: number | null = null;
      if (it.linkedMenuItemId) myId = it.linkedMenuItemId;
      else {
        const m = myByLowerName.get(it.name.trim().toLowerCase());
        if (m) myId = m.id;
      }
      if (myId !== null) {
        if (!map.has(myId)) map.set(myId, []);
        map.get(myId)!.push(it);
      }
    }
    return map;
  }, [items, myMenuItems]);

  const matchedItemIds = useMemo(() => new Set(
    items
      .filter((it) => {
        if (it.linkedMenuItemId) return true;
        return myMenuItems.some((m) => m.name.trim().toLowerCase() === it.name.trim().toLowerCase());
      })
      .map((it) => it.id),
  ), [items, myMenuItems]);

  const missingByCategory = useMemo(() => {
    const groups: Record<string, CompetitorItem[]> = {};
    for (const it of items) {
      if (matchedItemIds.has(it.id)) continue;
      const k = it.category?.trim() || "Uncategorised";
      if (!groups[k]) groups[k] = [];
      groups[k].push(it);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [items, matchedItemIds]);

  const offers = useMemo(() => items.filter((it) => it.offer), [items]);
  const myOffers = useMemo(() => myCoupons.filter((c) => c.isActive), [myCoupons]);

  if (isLoading || loadingMenu) {
    return (
      <Layout>
        <PageHeader title="Comparison views" />
        <div className="p-6"><Skeleton className="h-64" /></div>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageHeader
        title="Comparison views"
        subtitle="Side-by-side analysis across tracked competitors and your own menu."
        actions={
          <Link href="/competitors">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back to competitors</Button>
          </Link>
        }
      />

      {competitors.length === 0 ? (
        <div className="p-6">
          <Card>
            <CardContent className="py-16 text-center">
              <AlertCircle className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-base font-medium">No competitors tracked</p>
              <p className="text-sm text-muted-foreground mt-1">Add a competitor to get started.</p>
              <Link href="/competitors">
                <Button className="mt-4">Add a competitor</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="p-6">
          <Tabs defaultValue="price">
            <TabsList>
              <TabsTrigger value="price" data-testid="tab-price">Price comparison</TabsTrigger>
              <TabsTrigger value="offers" data-testid="tab-offer">Offer comparison</TabsTrigger>
              <TabsTrigger value="missing" data-testid="tab-missing">Missing items</TabsTrigger>
            </TabsList>

            <TabsContent value="price" className="mt-4">
              <PriceComparison
                myMenuItems={myMenuItems}
                matchedByMyItemId={matchedByMyItemId}
                competitorById={competitorById}
              />
            </TabsContent>

            <TabsContent value="offers" className="mt-4">
              <OfferComparison
                offers={offers}
                myOffers={myOffers}
                competitorById={competitorById}
              />
            </TabsContent>

            <TabsContent value="missing" className="mt-4">
              <MissingOpportunities
                groups={missingByCategory}
                competitorById={competitorById}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Layout>
  );
}

function priceDelta(my: number, theirs: number): "cheaper" | "costlier" | "same" {
  const diff = my - theirs;
  if (Math.abs(diff) < 0.01) return "same";
  return diff < 0 ? "cheaper" : "costlier";
}

function PriceComparison({
  myMenuItems, matchedByMyItemId, competitorById,
}: {
  myMenuItems: MyMenuItem[];
  matchedByMyItemId: Map<number, CompetitorItem[]>;
  competitorById: Map<number, Competitor>;
}) {
  const itemsWithMatches = myMenuItems.filter((m) => matchedByMyItemId.has(m.id));

  if (itemsWithMatches.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No price differences yet. Add competitor items with matching names, or manually link them on a competitor's detail page.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Price comparison vs my menu</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>My item</TableHead>
              <TableHead>My price</TableHead>
              <TableHead>Competitor</TableHead>
              <TableHead>Their price</TableHead>
              <TableHead>vs me</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itemsWithMatches.flatMap((m) => {
              const matches = matchedByMyItemId.get(m.id) ?? [];
              const myPrice = Number(m.price);
              return matches.map((it) => {
                const theirs = it.price !== null ? Number(it.price) : null;
                const cmp = theirs === null ? null : priceDelta(myPrice, theirs);
                return (
                  <TableRow key={`${m.id}-${it.id}`} data-testid={`price-row-${m.id}-${it.id}`}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{formatCurrency(m.price)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {competitorById.get(it.competitorId)?.name ?? "—"}
                    </TableCell>
                    <TableCell>{theirs !== null ? formatCurrency(theirs) : "—"}</TableCell>
                    <TableCell>
                      {cmp === null ? (
                        <span className="text-xs text-muted-foreground">No price</span>
                      ) : cmp === "cheaper" ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-700">
                          <TrendingDown className="h-3 w-3 mr-1" />You're cheaper
                        </Badge>
                      ) : cmp === "costlier" ? (
                        <Badge variant="destructive">
                          <TrendingUp className="h-3 w-3 mr-1" />You're costlier
                        </Badge>
                      ) : (
                        <Badge variant="secondary"><Minus className="h-3 w-3 mr-1" />Same</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              });
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function OfferComparison({
  offers, myOffers, competitorById,
}: {
  offers: CompetitorItem[];
  myOffers: MyCoupon[];
  competitorById: Map<number, Competitor>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">My active offers</CardTitle></CardHeader>
        <CardContent>
          {myOffers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No active coupons or offers.</p>
          ) : (
            <div className="space-y-2">
              {myOffers.map((c) => (
                <div key={c.id} className="border rounded-md p-2 flex items-center justify-between">
                  <div className="font-medium">{c.code}</div>
                  <Badge variant="secondary">
                    {c.discountType === "percentage"
                      ? `${c.discountValue}% off`
                      : `${formatCurrency(c.discountValue)} off`}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Competitor offers</CardTitle></CardHeader>
        <CardContent>
          {offers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No competitor offers tracked yet.</p>
          ) : (
            <div className="space-y-2">
              {offers.map((it) => (
                <div key={it.id} className="border rounded-md p-2" data-testid={`offer-${it.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm">{it.name}</div>
                    <Badge variant="outline" className="text-xs">
                      {competitorById.get(it.competitorId)?.name ?? "—"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Tag className="h-3 w-3 text-muted-foreground" />
                    <span className="text-sm">{it.offer}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MissingOpportunities({
  groups, competitorById,
}: {
  groups: [string, CompetitorItem[]][];
  competitorById: Map<number, Competitor>;
}) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Every tracked competitor item already matches one of yours. No missing-item opportunities right now.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {groups.map(([category, items]) => (
        <Card key={category}>
          <CardHeader><CardTitle className="text-base">{category} ({items.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Competitor</TableHead>
                  <TableHead>Their price</TableHead>
                  <TableHead>Offer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id} data-testid={`missing-${it.id}`}>
                    <TableCell className="font-medium">{it.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {competitorById.get(it.competitorId)?.name ?? "—"}
                    </TableCell>
                    <TableCell>{it.price ? formatCurrency(it.price) : "—"}</TableCell>
                    <TableCell className="text-sm">{it.offer ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
