import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export function FinalCTA() {
  return (
    <section className="relative py-28 overflow-hidden bg-foreground text-background">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(249,115,22,0.25),_transparent_60%)]" />
      <div className="container mx-auto px-4 md:px-6 text-center max-w-3xl relative">
        <h2 className="font-serif text-4xl md:text-6xl font-bold mb-6 leading-tight">
          Ready to run your restaurant <span className="text-primary">smarter?</span>
        </h2>
        <p className="text-lg md:text-xl text-white/70 mb-10">
          Join the restaurants, cafes, cloud kitchens and chains running their entire operation on Khana Lagao.
          14-day free trial. No credit card. Live human onboarding.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-3">
          <Link href="/book-demo">
            <Button size="lg" className="w-full sm:w-auto text-base h-12 px-7 bg-primary hover:bg-primary/90 text-primary-foreground">
              Book Free Demo <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <a href="/app/register">
            <Button size="lg" variant="outline" className="w-full sm:w-auto text-base h-12 px-7 border-white/30 text-white bg-white/0 hover:bg-white/10 hover:text-white">
              Start Free Trial
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}
