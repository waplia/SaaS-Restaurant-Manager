import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import NotFound from "@/pages/not-found";
import { Skeleton } from "@/components/ui/skeleton";

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
      return res.json() as Promise<{ post: any; related: any[] } | null>;
    },
    enabled: !!slug
  });
  const post = data?.post;
  const related = data?.related ?? [];

  useSeo({
    title: post?.title || "Blog",
    description: post?.excerpt || "",
    ogType: "article",
    schema: post ? {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": post.title,
      "author": { "@type": "Person", "name": post.author },
      "datePublished": post.publishedAt
    } : undefined
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
        <article className="container mx-auto px-4 max-w-3xl">
          <div className="mb-12 text-center space-y-4">
            <div className="flex items-center justify-center gap-2 text-sm text-primary font-medium">
              <span>{post.category}</span>
            </div>
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">{post.title}</h1>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>By {post.author}</span>
              <span>•</span>
              <span>{new Date(post.publishedAt).toLocaleDateString()}</span>
              <span>•</span>
              <span>{post.readMinutes} min read</span>
            </div>
          </div>

          {post.coverImage && (
            <div className="mb-12 aspect-[21/9] rounded-2xl overflow-hidden bg-muted">
              <img src={post.coverImage} alt={post.title} className="w-full h-full object-cover" />
            </div>
          )}

          <div className="prose prose-lg dark:prose-invert prose-p:leading-relaxed prose-a:text-primary mx-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {post.content}
            </ReactMarkdown>
          </div>

          {related.length > 0 && (
            <section className="mt-20 pt-10 border-t">
              <h2 className="font-serif text-2xl font-bold mb-6">Related reading</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {related.map((r: any) => (
                  <a
                    key={r.id}
                    href={`/blog/${r.slug}`}
                    className="block p-5 rounded-xl border hover:border-primary/50 hover:bg-primary/5 transition-colors"
                    data-testid={`link-related-${r.slug}`}
                  >
                    <div className="text-xs text-primary font-medium mb-1">{r.category}</div>
                    <div className="font-semibold leading-snug">{r.title}</div>
                    {r.excerpt && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{r.excerpt}</p>}
                  </a>
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
