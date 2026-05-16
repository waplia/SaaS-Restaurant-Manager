import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export default function About() {
  useSeo({
    title: "About Us",
    description: "The story behind KhanaLagao and our mission to empower restaurant owners.",
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto space-y-16">
            <div className="text-center">
              <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">Our Mission</h1>
              <p className="text-xl text-muted-foreground leading-relaxed">
                To build the tools that let chefs be chefs and owners be owners, removing the friction from hospitality.
              </p>
            </div>
            
            <div className="prose prose-lg dark:prose-invert max-w-none">
              <p>KhanaLagao was born out of frustration. Our founders grew up in the restaurant industry, watching brilliant chefs struggle with clunky, outdated software that crashed during the rush and provided terrible insights.</p>
              <p>We decided to build something different. A system that respects the craft of hospitality. Fast, reliable, and beautiful.</p>
            </div>

            <div>
              <h2 className="font-serif text-3xl font-bold mb-8 text-center">Our Values</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="p-6 bg-card border border-border rounded-xl">
                  <h3 className="font-bold text-xl mb-2">Speed is a Feature</h3>
                  <p className="text-muted-foreground">In a kitchen, seconds matter. We obsess over milliseconds and keystrokes.</p>
                </div>
                <div className="p-6 bg-card border border-border rounded-xl">
                  <h3 className="font-bold text-xl mb-2">Reliability Above All</h3>
                  <p className="text-muted-foreground">The system cannot go down. Period. We architect for the worst-case scenario.</p>
                </div>
                <div className="p-6 bg-card border border-border rounded-xl">
                  <h3 className="font-bold text-xl mb-2">Clarity Brings Profit</h3>
                  <p className="text-muted-foreground">Data should be actionable, not overwhelming. We surface what matters.</p>
                </div>
                <div className="p-6 bg-card border border-border rounded-xl">
                  <h3 className="font-bold text-xl mb-2">Respect the Craft</h3>
                  <p className="text-muted-foreground">We build tools for professionals. No gimmicks, just robust engineering.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
