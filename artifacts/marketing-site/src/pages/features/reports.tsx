import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { LeadForm } from "@/components/LeadForm";

export default function Reports() {
  useSeo({
    title: "Reports & Analytics",
    description: "Actionable business insights to improve your bottom line.",
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
              <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-4 md:mb-6">Reports & Analytics</h1>
              <p className="text-base md:text-xl text-muted-foreground">Turn raw data into profitable decisions.</p>
            </div>
            
            <div className="prose prose-base md:prose-lg dark:prose-invert max-w-none">
              <p>Get a clear view of your business performance. Our dashboards highlight what's working and what needs attention.</p>
              
              <h3>Features</h3>
              <ul>
                <li><strong>Sales Dashboards:</strong> Track revenue, discounts, and voids in real-time.</li>
                <li><strong>Item Performance:</strong> Identify your most and least profitable menu items.</li>
                <li><strong>Staff Analytics:</strong> See who sells the most and turns tables fastest.</li>
                <li><strong>Automated Reports:</strong> Get daily summaries delivered to your inbox.</li>
              </ul>
            </div>

            <div className="mt-10 md:mt-16 bg-card p-5 md:p-8 rounded-2xl border border-border shadow-lg">
              <h3 className="text-xl md:text-2xl font-bold font-serif mb-4 md:mb-6 text-center">Start making data-driven decisions</h3>
              <LeadForm source="feature_reports" showDetails />
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
