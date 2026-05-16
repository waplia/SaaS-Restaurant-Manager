import { useMemo } from "react";
import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import NotFound from "@/pages/not-found";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowRight, ListTree } from "lucide-react";

interface BlogPostFull {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  coverImage: string | null;
  category: string;
  tags: string | null;
  author: string;
  readMinutes: number;
  publishedAt: string;
}

interface BlogPostSummary {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  category: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
}

export default function BlogPost() {
  const { slug } = useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["blog-post", slug],
    queryFn: async () => {
      const res = await fetch(`/api/blog/posts/${slug}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch post");
      }
      return res.json() as Promise<{ post: BlogPostFull; related: BlogPostSummary[] } | null>;
    },
    enabled: !!slug,
  });
  const post = data?.post;
  const related = data?.related ?? [];

  const headings = useMemo(() => {
    if (!post?.content) return [];
    const lines = post.content.split("\n");
    return lines
      .filter((l) => /^##\s+/.test(l))
      .map((l) => {
        const text = l.replace(/^##\s+/, "").trim();
        return { id: slugify(text), text };
      });
  }, [post?.content]);

  useSeo({
    title: post?.title || "Blog",
    description: post?.excerpt || "Insights, news, and guides for modern restaurant operations from the KhanaLagao team.",
    ogType: "article",
    ogImage: post?.coverImage || undefined,
    breadcrumbs: post
      ? [
          { label: "Home", href: "/" },
          { label: "Blog", href: "/blog" },
          { label: post.title },
        ]
      : undefined,
    schema: post
      ? {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.excerpt || undefined,
          image: post.coverImage || undefined,
          author: { "@type": "Person", name: post.author },
          datePublished: post.publishedAt,
          dateModified: post.publishedAt,
          mainEntityOfPage: {
            "@type": "WebPage",
            "@id": `https://khanalagao.com/blog/${post.slug}`,
          },
          publisher: {
            "@type": "Organization",
            name: "Waplia Digital Solutions",
            logo: {
              "@type": "ImageObject",
              url: "https://khanalagao.com/logo.png",
            },
          },
          articleSection: post.category,
          keywords: post.tags || undefined,
        }
      : undefined,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col font-sans">
        <Header />
        <main className="flex-grow pt-24 pb-32">
          <div className="container mx-auto px-4 max-w-3xl space-y-6">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-6 w-1/4" />
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!post || error) {
    return <NotFound />;
  }

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <article className="container mx-auto px-4 max-w-6xl">
          <div className="mb-12 text-center space-y-4 max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-2 text-sm text-primary font-medium capitalize">
              <span>{post.category}</span>
            </div>
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground" data-testid="text-post-title">
              {post.title}
            </h1>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>By {post.author}</span>
              <span>•</span>
              <span>{new Date(post.publishedAt).toLocaleDateString()}</span>
              <span>•</span>
              <span>{post.readMinutes} min read</span>
            </div>
          </div>

          {post.coverImage && (
            <div className="mb-12 aspect-[21/9] rounded-2xl overflow-hidden bg-muted max-w-4xl mx-auto">
              <img
                src={post.coverImage}
                alt={post.title}
                width={1680}
                height={720}
                loading="eager"
                fetchPriority="high"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div className="grid lg:grid-cols-[1fr_280px] gap-12 max-w-5xl mx-auto">
            <div className="prose prose-lg dark:prose-invert prose-p:leading-relaxed prose-a:text-primary prose-headings:font-serif prose-headings:scroll-mt-24 max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({ children, ...props }) => {
                    const text = String(children);
                    return (
                      <h2 id={slugify(text)} {...props}>
                        {children}
                      </h2>
                    );
                  },
                }}
              >
                {post.content}
              </ReactMarkdown>

              <div className="not-prose mt-12 p-8 rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20">
                <h3 className="font-serif text-2xl font-bold mb-2">See KhanaLagao in your kitchen</h3>
                <p className="text-muted-foreground mb-6">
                  Get a 20-minute walkthrough on real data from a venue like yours. No slides, no pressure.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild data-testid="button-cta-book-demo">
                    <Link href="/book-demo">
                      Book a free demo <ArrowRight className="w-4 h-4 ml-2" />
                    </Link>
                  </Button>
                  <Button variant="outline" asChild data-testid="button-cta-pricing">
                    <Link href="/pricing">See pricing</Link>
                  </Button>
                </div>
              </div>
            </div>

            {headings.length > 1 && (
              <aside className="hidden lg:block">
                <div className="sticky top-28 p-5 rounded-2xl border border-border bg-card">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-4">
                    <ListTree className="w-3.5 h-3.5" /> On this page
                  </div>
                  <nav className="space-y-2 text-sm">
                    {headings.map((h) => (
                      <a
                        key={h.id}
                        href={`#${h.id}`}
                        className="block text-muted-foreground hover:text-primary transition-colors leading-snug"
                        data-testid={`link-toc-${h.id}`}
                      >
                        {h.text}
                      </a>
                    ))}
                  </nav>
                </div>
              </aside>
            )}
          </div>

          {related.length > 0 && (
            <section className="mt-20 pt-10 border-t max-w-5xl mx-auto">
              <h2 className="font-serif text-2xl font-bold mb-6">Related reading</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {related.map((r) => (
                  <Link
                    key={r.id}
                    href={`/blog/${r.slug}`}
                    className="block p-5 rounded-xl border hover:border-primary/50 hover:bg-primary/5 transition-colors"
                    data-testid={`link-related-${r.slug}`}
                  >
                    <div className="text-xs text-primary font-medium mb-1 capitalize">{r.category}</div>
                    <div className="font-semibold leading-snug">{r.title}</div>
                    {r.excerpt && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{r.excerpt}</p>}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </article>
      </main>
      <Footer />
    </div>
  );
}
