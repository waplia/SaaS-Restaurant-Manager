import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Megaphone, Gift, RefreshCw, Tag, Share2, Heart, Star, Users, ArrowRight,
} from "lucide-react";

const ITEMS = [
  { icon: Megaphone, title: "Campaigns", desc: "Targeted WhatsApp, SMS and email blasts that actually open." },
  { icon: Gift, title: "Birthday offers", desc: "Automated greetings with a coupon they can't resist." },
  { icon: RefreshCw, title: "Win-back", desc: "Reach guests who haven't visited in 30, 60 or 90 days." },
  { icon: Tag, title: "Coupons", desc: "Single-use, multi-use, stackable — with full redemption tracking." },
  { icon: Share2, title: "Referrals", desc: "Reward guests for bringing friends, automatically." },
  { icon: Heart, title: "Loyalty", desc: "Points, tiers and stored value with no third-party app needed." },
  { icon: Star, title: "Review booster", desc: "Auto-ask happy guests for a 5-star Google review." },
  { icon: Users, title: "Segmentation", desc: "Slice guests by spend, frequency, item, location and more." },
];

export function GrowthEngineSection() {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-4">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-4">
              Growth Engine
            </div>
            <h2 className="font-serif text-3xl md:text-5xl font-bold mb-5 leading-tight">
              Turn first visits into <span className="text-primary">loyal regulars.</span>
            </h2>
            <p className="text-lg text-muted-foreground mb-7">
              Every guest tracked. Every campaign measured. Every rupee of marketing ROI accountable.
              The Growth Engine is built into the platform, not bolted on as a costly add-on.
            </p>
            <Link href="/features">
              <Button size="lg" variant="outline" className="border-2">
                See growth tools <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="lg:col-span-8 grid sm:grid-cols-2 gap-4">
            {ITEMS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-5 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
