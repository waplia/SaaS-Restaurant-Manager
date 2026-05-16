import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { LeadForm } from "@/components/LeadForm";

export default function OnlineOrdering() {
  useSeo({
    title: "Online Ordering",
    description: "Direct delivery & takeout without the massive commission fees.",
    schema: {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "KhanaLagao Online Ordering",
      "description": "Direct delivery & takeout without the massive commission fees."
    }
  });

  return (
    <SiteLayout>
      <div className="pt-12 md:pt-24 pb-16 md:pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto space-y-8 md:space-y-12">
            <div className="text-center">
              <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-4 md:mb-6">Online Ordering</h1>
              <p className="text-base md:text-xl text-muted-foreground">Take back control of your delivery business.</p>
            </div>
            
            <div className="prose prose-base md:prose-lg dark:prose-invert max-w-none">
              <p>Stop paying 30% to third-party delivery apps. Launch your own branded ordering site and keep your margins intact.</p>
              
              <h3>Features</h3>
              <ul>
                <li><strong>Zero Commissions:</strong> You keep 100% of the revenue.</li>
                <li><strong>Branded Experience:</strong> Your logo, your colors, your website.</li>
                <li><strong>Loyalty Integration:</strong> Reward repeat customers automatically.</li>
                <li><strong>Delivery Integration:</strong> Connect with local delivery fleets seamlessly.</li>
              </ul>
            </div>

            <div className="mt-10 md:mt-16 bg-card p-5 md:p-8 rounded-2xl border border-border shadow-lg">
              <h3 className="text-xl md:text-2xl font-bold font-serif mb-4 md:mb-6 text-center">Stop paying high commissions</h3>
              <LeadForm source="feature_online_ordering" showDetails />
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
