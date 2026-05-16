import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, ShieldCheck, IndianRupee, Activity, ChefHat, Sparkles,
  AlertTriangle, Users, Star, Wallet,
} from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative pt-20 pb-28 md:pt-28 md:pb-36 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/15 via-background to-background -z-10" />
      <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-primary/10 blur-3xl -z-10" />

      <div className="container mx-auto px-4 md:px-6 grid lg:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="space-y-7 max-w-2xl"
        >
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            One platform. POS, KOT, Inventory, Finance, AI &amp; Growth.
          </div>
          <h1 className="font-serif text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]">
            Run Your Restaurant Smarter with{" "}
            <span className="text-primary">One Powerful Operating System</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
            From the first order to the last rupee — billing, kitchen, tables, stock, staff,
            customers, finance and AI insights in one connected system built for modern restaurants.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link href="/book-demo">
              <Button size="lg" className="w-full sm:w-auto text-base h-12 px-7" data-testid="btn-hero-demo">
                Book Free Demo <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/features">
              <Button size="lg" variant="outline" className="w-full sm:w-auto text-base h-12 px-7 border-2" data-testid="btn-hero-explore">
                Explore Platform
              </Button>
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground pt-2">
            <span className="inline-flex items-center"><ShieldCheck className="h-4 w-4 text-primary mr-1.5" /> Trusted by restaurants, cafes, cloud kitchens &amp; chains across India</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="relative w-full max-w-xl mx-auto"
        >
          <DashboardMockup />
        </motion.div>
      </div>
    </section>
  );
}

function DashboardMockup() {
  return (
    <div className="relative">
      <div className="aspect-[5/4] rounded-2xl overflow-hidden shadow-2xl border border-border bg-card relative">
        <div className="absolute inset-0 bg-gradient-to-br from-card via-background to-accent/30 flex flex-col">
          <div className="h-9 border-b border-border/60 flex items-center px-4 gap-2 bg-background/60 backdrop-blur">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            <div className="ml-3 h-3 w-28 rounded bg-muted" />
          </div>
          <div className="flex-1 p-5 grid grid-cols-3 gap-4">
            <div className="col-span-1 space-y-3">
              <div className="h-6 w-3/4 rounded bg-primary/20" />
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-5/6 rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
              <div className="h-16 w-full rounded-lg bg-primary/10 border border-primary/20" />
              <div className="h-16 w-full rounded-lg bg-muted" />
            </div>
            <div className="col-span-2 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className="h-14 rounded-lg bg-background border border-border/60 p-2 flex flex-col justify-center">
                    <div className="h-2 w-10 rounded bg-muted mb-1.5" />
                    <div className="h-3 w-14 rounded bg-foreground/70" />
                  </div>
                ))}
              </div>
              <div className="h-32 rounded-lg bg-background border border-border/60 p-3 flex items-end gap-1.5">
                {[40, 65, 55, 80, 50, 90, 70, 60, 95, 75, 85, 55].map((h, i) => (
                  <div key={i} style={{ height: `${h}%` }} className="flex-1 rounded-t bg-gradient-to-t from-primary/60 to-primary" />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="h-16 rounded-lg bg-background border border-border/60" />
                <div className="h-16 rounded-lg bg-background border border-border/60" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating cards */}
      <FloatCard className="-top-6 -left-6 hidden sm:flex" delay={0.4}>
        <IndianRupee className="h-4 w-4 text-primary" />
        <div>
          <div className="text-[10px] text-muted-foreground">Today Sales</div>
          <div className="text-sm font-bold">₹ 1,42,800</div>
        </div>
      </FloatCard>
      <FloatCard className="top-10 -right-4 sm:-right-8" delay={0.55}>
        <Activity className="h-4 w-4 text-green-500" />
        <div>
          <div className="text-[10px] text-muted-foreground">Live Orders</div>
          <div className="text-sm font-bold">37 active</div>
        </div>
      </FloatCard>
      <FloatCard className="top-1/2 -left-8 hidden md:flex" delay={0.7}>
        <ChefHat className="h-4 w-4 text-amber-500" />
        <div>
          <div className="text-[10px] text-muted-foreground">Kitchen</div>
          <div className="text-sm font-bold">12 KOTs cooking</div>
        </div>
      </FloatCard>
      <FloatCard className="bottom-16 -right-6 hidden sm:flex" delay={0.85}>
        <Sparkles className="h-4 w-4 text-primary" />
        <div>
          <div className="text-[10px] text-muted-foreground">Khana AI</div>
          <div className="text-sm font-bold">Push Paneer Tikka tonight</div>
        </div>
      </FloatCard>
      <FloatCard className="-bottom-4 left-8" delay={1}>
        <AlertTriangle className="h-4 w-4 text-red-500" />
        <div>
          <div className="text-[10px] text-muted-foreground">Stock Alert</div>
          <div className="text-sm font-bold">Cheese low</div>
        </div>
      </FloatCard>
      <FloatCard className="-bottom-6 right-10 hidden md:flex" delay={1.15}>
        <Users className="h-4 w-4 text-blue-500" />
        <div>
          <div className="text-[10px] text-muted-foreground">Attendance</div>
          <div className="text-sm font-bold">14 / 16 in</div>
        </div>
      </FloatCard>
      <FloatCard className="top-1/3 -right-10 hidden lg:flex" delay={1.3}>
        <Star className="h-4 w-4 text-yellow-500 fill-yellow-400" />
        <div>
          <div className="text-[10px] text-muted-foreground">Reviews</div>
          <div className="text-sm font-bold">4.7 · 312</div>
        </div>
      </FloatCard>
      <FloatCard className="bottom-1/3 -left-10 hidden lg:flex" delay={1.45}>
        <Wallet className="h-4 w-4 text-emerald-500" />
        <div>
          <div className="text-[10px] text-muted-foreground">Wallet</div>
          <div className="text-sm font-bold">₹ 8,420</div>
        </div>
      </FloatCard>
    </div>
  );
}

function FloatCard({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className={`absolute z-10 flex items-center gap-2 rounded-xl border border-border bg-background/95 backdrop-blur shadow-lg px-3 py-2 ${className}`}
    >
      {children}
    </motion.div>
  );
}
