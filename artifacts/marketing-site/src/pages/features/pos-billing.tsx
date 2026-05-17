import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { LeadForm } from "@/components/LeadForm";

export default function POSBilling() {
  useSeo({
    title: "POS & Billing",
    description: "Fast, reliable point of sale designed for high-volume environments.",
    schema: {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "KhanaLagao",
      "description": "Complete restaurant operating system for POS, QR menu, inventory, payroll, finance, growth and AI.",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "INR" },
      "brand": { "@type": "Brand", "name": "KhanaLagao" }
    }
  });

  return (
    <SiteLayout>
      <div className="pt-12 md:pt-24 pb-16 md:pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto space-y-8 md:space-y-12">
            <div className="text-center">
              <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-4 md:mb-6">POS & Billing</h1>
              <p className="text-base md:text-xl text-muted-foreground">Speed meets reliability. The point of sale built for the rush hour.</p>
            </div>
            
            <div className="prose prose-base md:prose-lg dark:prose-invert max-w-none">
              <p>During the dinner rush, every second counts. Our POS system is designed to minimize taps, prevent errors, and keep your line moving.</p>
              
              <h3>Features</h3>
              <ul>
                <li><strong>Lightning Fast Entry:</strong> Optimized touch targets and intuitive modifiers.</li>
                <li><strong>Offline Mode:</strong> Keep taking orders even when the internet drops.</li>
                <li><strong>Split Bills:</strong> Handle complex payment splits with a single tap.</li>
                <li><strong>Kitchen Routing:</strong> Automatically send items to the right prep station.</li>
              </ul>
            </div>

            <div className="mt-10 md:mt-16 bg-card p-5 md:p-8 rounded-2xl border border-border shadow-lg">
              <h3 className="text-xl md:text-2xl font-bold font-serif mb-4 md:mb-6 text-center">Ready to speed up your service?</h3>
              <LeadForm source="feature_pos_billing" showDetails />
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
