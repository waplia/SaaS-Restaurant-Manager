import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Star, ExternalLink } from "lucide-react";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]!.toUpperCase())
    .join("") || "G";
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="h-8 w-8 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-semibold shrink-0" aria-hidden>
      {initials(name)}
    </div>
  );
}

interface PublicWallItem {
  id: number;
  branchId: number | null;
  branchName: string | null;
  source: string;
  isFeatured: boolean;
  rating: number | null;
  comment: string | null;
  authorName: string;
  externalUrl: string | null;
  occurredAt: string;
}

interface PublicWallData {
  restaurant: { id: number; name: string; slug: string; logoUrl: string | null };
  branches: Array<{ id: number; name: string }>;
  items: PublicWallItem[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
  summary: { total: number; avgRating: number | null };
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return null;
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`h-4 w-4 ${i <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
      ))}
    </div>
  );
}

export default function PublicFeedbackWallPage() {
  const [, params] = useRoute<{ slug: string }>("/wall/:slug");
  const slug = params?.slug;
  const [data, setData] = useState<PublicWallData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<number | "all">("all");
  const PAGE_SIZE = 24;

  const isEmbed = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("embed") === "1";
  }, []);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    const params = new URLSearchParams({ page: "1", limit: String(PAGE_SIZE) });
    if (branchId !== "all") params.set("branchId", String(branchId));
    fetch(`/api/public/feedback-wall/${encodeURIComponent(slug)}?${params}`).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load");
      return r.json();
    }).then((d: PublicWallData) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug, branchId]);

  const loadMore = async () => {
    if (!slug || !data?.pagination.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ page: String(data.pagination.page + 1), limit: String(data.pagination.limit) });
      if (branchId !== "all") params.set("branchId", String(branchId));
      const r = await fetch(`/api/public/feedback-wall/${encodeURIComponent(slug)}?${params}`);
      if (!r.ok) return;
      const next: PublicWallData = await r.json();
      setData({ ...next, items: [...data.items, ...next.items] });
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (data?.restaurant.name) {
      document.title = `Customer Reviews · ${data.restaurant.name}`;
    }
  }, [data]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center">
        <div>
          <p className="text-lg font-medium text-gray-900">Feedback wall not found</p>
          <p className="text-sm text-gray-500 mt-2">{error ?? "Please check the URL and try again."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isEmbed ? "bg-transparent" : "bg-gradient-to-b from-orange-50 to-white"} py-8 px-4 sm:px-6`}>
      <div className="max-w-5xl mx-auto">
        {!isEmbed && (
          <header className="text-center mb-8">
            {data.restaurant.logoUrl && (
              <img src={data.restaurant.logoUrl} alt="" className="h-16 mx-auto mb-3 rounded-full object-cover" />
            )}
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">{data.restaurant.name}</h1>
            <p className="text-gray-600 mt-1">What our guests are saying</p>
            {data.summary.avgRating != null && (
              <div className="inline-flex items-center gap-2 mt-3 px-3 py-1 rounded-full bg-white shadow-sm border">
                <Stars rating={Math.round(data.summary.avgRating)} />
                <span className="text-sm font-medium">{data.summary.avgRating.toFixed(1)} · {data.summary.total} reviews</span>
              </div>
            )}
          </header>
        )}

        {data.branches.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 mb-6 justify-center">
            <button
              onClick={() => setBranchId("all")}
              className={`px-3 py-1 rounded-full text-xs border ${branchId === "all" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700"}`}
            >All outlets</button>
            {data.branches.map(b => (
              <button
                key={b.id}
                onClick={() => setBranchId(b.id)}
                className={`px-3 py-1 rounded-full text-xs border ${branchId === b.id ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700"}`}
              >{b.name}</button>
            ))}
          </div>
        )}

        {data.items.length === 0 ? (
          <div className="text-center py-16 text-gray-500">No reviews yet — check back soon.</div>
        ) : (
          <>
            {(() => {
              const featured = data.items.filter(i => i.isFeatured);
              const rest = data.items.filter(i => !i.isFeatured);
              const renderCard = (item: PublicWallItem) => (
                <article
                  key={item.id}
                  className={`relative rounded-xl bg-white p-5 shadow-sm border ${item.isFeatured ? "border-yellow-300" : "border-gray-100"}`}
                >
                  {item.isFeatured && (
                    <span className="absolute -top-2 left-4 text-[10px] font-semibold uppercase tracking-wide bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded">Featured</span>
                  )}
                  <div className="flex items-center justify-between mb-2">
                    <Stars rating={item.rating} />
                    <span className="text-[10px] text-gray-400 uppercase">{item.source === "qr" ? "Verified guest" : item.source}</span>
                  </div>
                  {item.comment && <p className="text-sm text-gray-700 leading-relaxed">{item.comment}</p>}
                  <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar name={item.authorName} />
                      <span className="font-medium text-gray-700 truncate">
                        {item.authorName}{item.branchName ? ` · ${item.branchName}` : ""}
                        <span className="text-gray-400"> · {new Date(item.occurredAt).toLocaleDateString()}</span>
                      </span>
                    </div>
                    {item.externalUrl && (
                      <a href={item.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline shrink-0">
                        View <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </article>
              );
              return (
                <>
                  {featured.length > 0 && (
                    <section className="mb-8">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-yellow-700 mb-3">Featured reviews</h2>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {featured.map(renderCard)}
                      </div>
                    </section>
                  )}
                  {rest.length > 0 && (
                    <section>
                      {featured.length > 0 && (
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">More reviews</h2>
                      )}
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {rest.map(renderCard)}
                      </div>
                    </section>
                  )}
                </>
              );
            })()}
          </>
        )}

        {data.pagination.hasMore && (
          <div className="text-center mt-8">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-5 py-2 rounded-full bg-white border text-sm shadow-sm hover:bg-gray-50 disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : `Load more (${data.pagination.total - data.items.length} left)`}
            </button>
          </div>
        )}

        {!isEmbed && (
          <footer className="text-center mt-10 text-xs text-gray-400">
            Powered by Khana Lagao
          </footer>
        )}
      </div>
    </div>
  );
}
