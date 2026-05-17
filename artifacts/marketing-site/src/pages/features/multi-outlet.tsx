import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { LeadForm } from "@/components/LeadForm";

export default function MultiOutlet() {
  useSeo({
    title: "Multi-Outlet Management",
    description: "Scale across locations with centralized control and reporting.",
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
              <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-4 md:mb-6">Multi-Outlet Management</h1>
              <p className="text-base md:text-xl text-muted-foreground">Scale your brand without losing control.</p>
            </div>
            
            <div className="prose prose-base md:prose-lg dark:prose-invert max-w-none">
              <p>Manage dozens of locations from a single dashboard. Ensure consistency across your brand while empowering local managers.</p>
              
              <h3>Features</h3>
              <ul>
                <li><strong>Centralized Menus:</strong> Push menu updates to all locations instantly.</li>
                <li><strong>Consolidated Reporting:</strong> Compare performance across your entire portfolio.</li>
                <li><strong>Central Kitchens:</strong> Manage prep and distribution to satellite branches.</li>
                <li><strong>Role-Based Access:</strong> Granular permissions for staff at every level.</li>
              </ul>
            </div>

            <div className="mt-10 md:mt-16 bg-card p-5 md:p-8 rounded-2xl border border-border shadow-lg">
              <h3 className="text-xl md:text-2xl font-bold font-serif mb-4 md:mb-6 text-center">Ready to scale your empire?</h3>
              <LeadForm source="feature_multi_outlet" showDetails />
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
