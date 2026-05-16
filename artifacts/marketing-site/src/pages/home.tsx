import { useEffect, useState } from "react";
import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, BarChart3, ChefHat, Smartphone, Store, Star, Quote } from "lucide-react";

interface Testimonial {
  id: number;
  source: string;
  rating: number | null;
  comment: string | null;
  authorName: string;
  restaurantName: string;
  restaurantSlug: string;
  restaurantLogo: string | null;
  externalUrl: string | null;
}

function TestimonialsSection() {
  const [items, setItems] = useState<Testimonial[] | null>(null);
  useEffect(() => {
    fetch("/api/marketing/testimonials")
      .then(r => r.ok ? r.json() : [])
      .then((data: Testimonial[]) => setItems(data))
      .catch(() => setItems([]));
  }, []);

  if (!items) return null;
  const top = items.slice(0, 6);

  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="font-serif text-4xl md:text-5xl font-bold mb-4">Loved by restaurants across India</h2>
          <p className="text-lg text-muted-foreground">Real feedback from guests of restaurants running on Khana Lagao.</p>
        </div>
        {top.length === 0 && (
          <div className="text-center text-muted-foreground py-10">
            Highlighted guest reviews will appear here as restaurants opt in to share them.
          </div>
        )}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {top.map(t => (
            <article key={t.id} className="rounded-xl border border-border bg-card p-6 flex flex-col">
              <Quote className="h-6 w-6 text-primary/40 mb-3" />
              {t.rating != null && (
                <div className="flex items-center gap-0.5 mb-3">
                  {[1, 2, 3, 4, 5].map(i => (
                    <Star key={i} className={`h-4 w-4 ${i <= (t.rating ?? 0) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}`} />
                  ))}
                </div>
              )}
              {t.comment && <p className="text-sm leading-relaxed text-foreground/90 line-clamp-6 flex-1">{t.comment}</p>}
              <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
                {t.restaurantLogo
                  ? <img src={t.restaurantLogo} alt="" className="h-9 w-9 rounded-full object-cover" />
                  : <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">{t.restaurantName.slice(0, 1)}</div>}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.authorName}</div>
                  <a href={`/app/wall/${t.restaurantSlug}`} className="text-xs text-muted-foreground hover:text-primary truncate block">
                    {t.restaurantName}
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  useSeo({
    title: "Khana Lagao | The Operating System for Modern Restaurants",
    description: "Khana Lagao powers POS billing, QR menus, inventory, and payroll for restaurants that treat their kitchen like a craft and their numbers like a sport.",
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      
      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative pt-24 pb-32 md:pt-32 md:pb-40 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background -z-10" />
          
          <div className="container mx-auto px-4 md:px-6 flex flex-col lg:flex-row items-center gap-12">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="flex-1 space-y-8 max-w-2xl"
            >
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-medium text-primary mb-2">
                <span className="flex h-2 w-2 rounded-full bg-primary mr-2 animate-pulse"></span>
                Now available for multi-outlet chains
              </div>
              <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-foreground leading-[1.1]">
                Run your restaurant with <span className="text-primary">confidence.</span>
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed">
                The complete operating system for owners who treat their kitchen like a craft and their numbers like a sport. POS, inventory, payroll, and insights—all in one place.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <a href="/app/register">
                  <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8" data-testid="btn-hero-cta">
                    Start your free trial <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </a>
                <Link href="/book-demo">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 border-2" data-testid="btn-hero-demo">
                    Book a demo
                  </Button>
                </Link>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground pt-2">
                <div className="flex items-center"><CheckCircle2 className="h-4 w-4 text-primary mr-1" /> No credit card required</div>
                <div className="flex items-center"><CheckCircle2 className="h-4 w-4 text-primary mr-1" /> Setup in 15 mins</div>
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="flex-1 w-full max-w-2xl relative"
            >
              <div className="aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl border border-border bg-card relative">
                {/* Fallback box if image not present, otherwise image */}
                <div className="absolute inset-0 bg-gradient-to-br from-card to-accent flex items-center justify-center p-8">
                   <div className="w-full h-full border border-border/50 rounded-lg shadow-sm bg-background/50 backdrop-blur flex flex-col">
                      <div className="h-12 border-b border-border/50 flex items-center px-4 gap-2">
                         <div className="h-3 w-3 rounded-full bg-red-500/50"></div>
                         <div className="h-3 w-3 rounded-full bg-amber-500/50"></div>
                         <div className="h-3 w-3 rounded-full bg-green-500/50"></div>
                      </div>
                      <div className="flex-1 p-6 grid grid-cols-3 gap-6">
                         <div className="col-span-2 space-y-4">
                            <div className="h-8 w-1/3 bg-muted rounded"></div>
                            <div className="h-48 w-full bg-muted rounded"></div>
                         </div>
                         <div className="space-y-4">
                            <div className="h-24 w-full bg-primary/10 border border-primary/20 rounded"></div>
                            <div className="h-24 w-full bg-muted rounded"></div>
                         </div>
                      </div>
                   </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="py-24 bg-card">
          <div className="container mx-auto px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="font-serif text-3xl md:text-5xl font-bold mb-6">Everything you need. Nothing you don't.</h2>
              <p className="text-lg text-muted-foreground">Replace your messy stack of legacy tools with a single, elegant platform designed for modern hospitality.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              <FeatureCard 
                icon={<Smartphone className="h-8 w-8 text-primary" />}
                title="POS & QR Menus"
                desc="Lightning-fast order taking, contactless dining, and seamless checkout."
                href="/features/pos-billing"
              />
              <FeatureCard 
                icon={<Store className="h-8 w-8 text-primary" />}
                title="Inventory & Stock"
                desc="Track every ingredient. Get alerts before you run out. Reduce waste."
                href="/features/inventory-management"
              />
              <FeatureCard 
                icon={<BarChart3 className="h-8 w-8 text-primary" />}
                title="Real-time Analytics"
                desc="Know your margins, best-sellers, and busy hours instantly."
                href="/features/reports"
              />
            </div>
            
            <div className="mt-12 text-center">
              <Link href="/features">
                <Button variant="ghost" className="text-primary hover:text-primary hover:bg-primary/5">
                  See all features <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <TestimonialsSection />

        {/* CTA Section */}
        <section className="py-32 relative overflow-hidden bg-foreground text-background">
          <div className="container mx-auto px-4 md:px-6 text-center max-w-4xl relative z-10">
            <h2 className="font-serif text-4xl md:text-6xl font-bold mb-8">Ready to bring order to the kitchen?</h2>
            <p className="text-xl text-muted/80 mb-10 max-w-2xl mx-auto">
              Join hundreds of top-tier restaurants running their entire operation on Khana Lagao.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <a href="/app/register">
                <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 bg-primary text-primary-foreground hover:bg-primary/90">
                  Start your free trial
                </Button>
              </a>
              <Link href="/contact">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 border-border/20 text-foreground hover:bg-white/10 hover:text-white">
                  Talk to Sales
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
      
      <Footer />
    </div>
  );
}

function FeatureCard({ icon, title, desc, href }: { icon: React.ReactNode, title: string, desc: string, href: string }) {
  return (
    <Link href={href}>
      <motion.div 
        whileHover={{ y: -5 }}
        className="block group h-full p-8 rounded-2xl border border-border bg-background hover:shadow-lg transition-all duration-300"
      >
        <div className="mb-6 inline-flex p-4 rounded-xl bg-primary/5 group-hover:bg-primary/10 transition-colors">
          {icon}
        </div>
        <h3 className="text-2xl font-bold mb-3">{title}</h3>
        <p className="text-muted-foreground leading-relaxed">{desc}</p>
        <div className="mt-6 flex items-center text-sm font-medium text-primary opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all">
          Learn more <ArrowRight className="ml-1 h-4 w-4" />
        </div>
      </motion.div>
    </Link>
  );
}
