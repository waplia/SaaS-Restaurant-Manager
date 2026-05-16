import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Brain, LineChart, MessageCircle, Megaphone, ChefHat, Wallet, ArrowRight,
} from "lucide-react";

const AI_FEATURES = [
  { icon: LineChart, title: "Sales forecasting", desc: "Predict tomorrow's covers and revenue per outlet, hour by hour." },
  { icon: ChefHat, title: "Menu intelligence", desc: "Spot stars, dogs and dishes you should re-engineer or retire." },
  { icon: Wallet, title: "Smart pricing", desc: "AI-suggested price changes based on demand, cost and competition." },
  { icon: Megaphone, title: "Campaign copilot", desc: "Auto-write WhatsApp, SMS and email campaigns that convert." },
  { icon: MessageCircle, title: "Review responder", desc: "Draft thoughtful replies to every Google and Zomato review in seconds." },
  { icon: Brain, title: "Demand planner", desc: "Recommend prep quantities so the kitchen stops over- and under-cooking." },
  { icon: Sparkles, title: "Insights digest", desc: "A daily brief: what's working, what's leaking, what to fix today." },
];

export function KhanaAIHighlight() {
  return (
    <section className="relative py-14 md:py-28 overflow-hidden bg-[#0b0b10] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(249,115,22,0.25),_transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(168,85,247,0.18),_transparent_55%)]" />
      <div className="container mx-auto px-4 md:px-6 relative">
        <div className="max-w-3xl mx-auto text-center mb-8 md:mb-14">
          <div className="inline-flex items-center rounded-full border border-white/15 bg-white/5 backdrop-blur px-3 py-1 text-xs font-medium text-white/80 mb-3 md:mb-5">
            <Sparkles className="h-3.5 w-3.5 mr-1.5 text-primary" />
            Khana AI
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold mb-3 md:mb-5 leading-tight">
            Your <span className="bg-gradient-to-r from-primary via-amber-400 to-pink-400 bg-clip-text text-transparent">AI co-pilot</span> for the restaurant business.
          </h2>
          <p className="text-base md:text-lg text-white/70">
            Khana AI watches every sale, KOT, review and stock movement — and turns it into decisions
            you can act on before the next service starts.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5 mb-8 md:mb-12">
          {AI_FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="p-4 md:p-6 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur hover:bg-white/[0.07] transition-colors">
              <div className="mb-3 md:mb-4 inline-flex p-2 md:p-2.5 rounded-lg bg-gradient-to-br from-primary/30 to-pink-500/20 border border-white/10">
                <Icon className="h-4 w-4 md:h-5 md:w-5 text-primary" />
              </div>
              <h3 className="text-base md:text-lg font-bold mb-1 md:mb-1.5">{title}</h3>
              <p className="text-xs md:text-sm text-white/65 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link href="/features">
            <Button size="lg" className="w-full sm:w-auto text-base h-12 px-7 bg-primary hover:bg-primary/90 text-primary-foreground">
              Explore Khana AI <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
