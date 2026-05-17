import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { LeadForm } from "@/components/LeadForm";

export default function BookDemo() {
  useSeo({
    title: "Book a Demo — KhanaLagao",
    description: "Schedule a personalized demo of KhanaLagao with our restaurant experts.",
  });

  return (
    <SiteLayout>
      <div className="pt-12 md:pt-24 pb-16 md:pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-16">
            {/* Form first on mobile (lg:order-2 puts it right on desktop) */}
            <div className="order-1 lg:order-2">
              <div className="bg-card border border-border p-5 md:p-8 rounded-2xl shadow-xl">
                <h2 className="text-xl md:text-2xl font-bold font-serif mb-4 md:mb-6">Schedule your session</h2>
                <LeadForm source="book_demo" buttonText="Request Demo" showDetails showMessage />
              </div>
            </div>

            <div className="order-2 lg:order-1 space-y-6 md:space-y-8">
              <div>
                <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-3 md:mb-4 text-foreground">
                  See KhanaLagao in action
                </h1>
                <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
                  Join a 30-minute walkthrough tailored to your restaurant's specific needs. Learn how you can streamline operations, reduce costs, and delight your guests.
                </p>
              </div>

              <details className="lg:hidden border border-border rounded-xl bg-card group">
                <summary className="cursor-pointer list-none p-4 flex items-center justify-between font-semibold text-sm">
                  What to expect
                  <span className="text-primary text-xs group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <ul className="px-4 pb-4 space-y-3">
                  {WHAT.map((item, i) => <Item key={i} i={i} item={item} />)}
                </ul>
              </details>

              <div className="hidden lg:block space-y-6">
                <h3 className="font-bold text-xl font-serif">What to expect:</h3>
                <ul className="space-y-4">
                  {WHAT.map((item, i) => <Item key={i} i={i} item={item} />)}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}

const WHAT = [
  "A brief discussion about your current operations and challenges",
  "Live product demonstration of relevant features",
  "Deep dive into POS, inventory, or analytics based on your needs",
  "Q&A session with a hospitality tech expert",
  "Pricing overview tailored to your venue size",
];

function Item({ i, item }: { i: number; item: string }) {
  return (
    <li className="flex items-start">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center mr-3 mt-0.5">
        <span className="text-sm font-bold">{i + 1}</span>
      </div>
      <span className="text-sm md:text-base text-foreground">{item}</span>
    </li>
  );
}
