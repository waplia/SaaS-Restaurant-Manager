import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

export default function BlogIndex() {
  useSeo({
    title: "Blog | TableTrack",
    description: "Insights, news, and guides for modern restaurant operations.",
  });

  const { data: posts, isLoading } = useQuery({
    queryKey: ["blog-posts"],
    queryFn: async () => {
      const res = await fetch("/api/blog/posts");
      if (!res.ok) throw new Error("Failed to fetch posts");
      return res.json() as Promise<any[]>;
    }
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">The TableTrack Blog</h1>
            <p className="text-xl text-muted-foreground">Insights, news, and guides for modern restaurant operations.</p>
          </div>
          
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="space-y-4">
                  <Skeleton className="h-48 w-full rounded-xl" />
                  <Skeleton className="h-6 w-1/4" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ))}
            </div>
          ) : !posts || posts.length === 0 ? (
            <div className="text-center py-24 bg-card rounded-2xl border border-border">
              <h3 className="text-xl font-bold mb-2">No posts yet</h3>
              <p className="text-muted-foreground">Check back soon for insights and updates.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {posts.map(post => (
                <Link href={`/blog/${post.slug}`} key={post.id} className="group block space-y-4">
                  <div className="aspect-[16/9] bg-muted rounded-xl overflow-hidden relative">
                    {post.coverImage ? (
                      <img src={post.coverImage} alt={post.title} className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full bg-primary/10 flex items-center justify-center text-primary font-serif font-bold text-2xl">TT</div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="text-primary font-medium">{post.category}</span>
                      <span>•</span>
                      <span>{post.readMinutes} min read</span>
                    </div>
                    <h3 className="text-xl font-bold font-serif group-hover:text-primary transition-colors">{post.title}</h3>
                    <p className="text-muted-foreground line-clamp-2">{post.excerpt}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
