import { useMemo, useState } from "react";
import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface BlogPostListItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImage: string | null;
  category: string;
  readMinutes: number;
  publishedAt: string;
  author: string;
}

export default function BlogIndex() {
  useSeo({
    title: "Blog | KhanaLagao",
    description: "Insights, news, and guides for modern restaurant operations.",
  });

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [query, setQuery] = useState("");

  const { data: posts, isLoading } = useQuery<BlogPostListItem[]>({
    queryKey: ["blog-posts"],
    queryFn: async () => {
      const res = await fetch("/api/blog/posts");
      if (!res.ok) throw new Error("Failed to fetch posts");
      return res.json();
    },
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    (posts ?? []).forEach((p) => set.add(p.category));
    return ["all", ...Array.from(set).sort()];
  }, [posts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (posts ?? []).filter((p) => {
      const matchesCat = activeCategory === "all" || p.category === activeCategory;
      const matchesQuery =
        !q ||
        p.title.toLowerCase().includes(q) ||
        (p.excerpt ?? "").toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [posts, activeCategory, query]);

  return (
    <SiteLayout>
      <div className="pt-12 md:pt-24 pb-16 md:pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-3xl mx-auto mb-6 md:mb-12">
            <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-3 md:mb-6">The KhanaLagao Blog</h1>
            <p className="text-base md:text-xl text-muted-foreground">Insights, news, and guides for modern restaurant operations.</p>
          </div>

          <div className="max-w-5xl mx-auto mb-6 md:mb-10 space-y-3 md:space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search articles…"
                className="pl-9 h-11 md:h-12"
                data-testid="input-blog-search"
              />
            </div>
            {!isLoading && categories.length > 1 && (
              <div className="-mx-4 px-4 flex md:flex-wrap gap-2 md:justify-center overflow-x-auto no-scrollbar">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors whitespace-nowrap ${
                      activeCategory === cat
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-foreground border-border hover:bg-accent"
                    }`}
                    data-testid={`button-category-${cat}`}
                  >
                    {cat === "all" ? "All posts" : cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="space-y-4">
                  <Skeleton className="h-40 md:h-48 w-full rounded-xl" />
                  <Skeleton className="h-6 w-1/4" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ))}
            </div>
          ) : !visible || visible.length === 0 ? (
            <div className="text-center py-16 md:py-24 bg-card rounded-2xl border border-border px-4">
              <h3 className="text-lg md:text-xl font-bold mb-2">No posts match your search</h3>
              <p className="text-sm md:text-base text-muted-foreground">Try a different search term or category.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              {visible.map((post) => (
                <Link href={`/blog/${post.slug}`} key={post.id} className="group block space-y-3 md:space-y-4" data-testid={`link-post-${post.slug}`}>
                  <div className="aspect-[16/9] bg-muted rounded-xl overflow-hidden relative">
                    {post.coverImage ? (
                      <img src={post.coverImage} alt={post.title} loading="lazy" className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full bg-primary/10 flex items-center justify-center text-primary font-serif font-bold text-2xl">TT</div>
                    )}
                  </div>
                  <div className="space-y-1.5 md:space-y-2">
                    <div className="flex items-center gap-2 text-xs md:text-sm text-muted-foreground">
                      <span className="text-primary font-medium capitalize">{post.category}</span>
                      <span>•</span>
                      <span>{post.readMinutes} min read</span>
                    </div>
                    <h3 className="text-lg md:text-xl font-bold font-serif group-hover:text-primary transition-colors leading-snug">{post.title}</h3>
                    <p className="text-sm md:text-base text-muted-foreground line-clamp-2">{post.excerpt}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </SiteLayout>
  );
}
