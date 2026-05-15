import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { LeadForm } from "@/components/LeadForm";

export default function MultiOutlet() {
  useSeo({
    title: "Multi-Outlet Management",
    description: "Scale across locations with centralized control and reporting.",
    schema: {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Khana Lagao Multi-Outlet",
      "description": "Scale across locations with centralized control and reporting."
    }
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto space-y-12">
            <div className="text-center">
              <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">Multi-Outlet Management</h1>
              <p className="text-xl text-muted-foreground">Scale your brand without losing control.</p>
            </div>
            
            <div className="prose prose-lg dark:prose-invert max-w-none">
              <p>Manage dozens of locations from a single dashboard. Ensure consistency across your brand while empowering local managers.</p>
              
              <h3>Features</h3>
              <ul>
                <li><strong>Centralized Menus:</strong> Push menu updates to all locations instantly.</li>
                <li><strong>Consolidated Reporting:</strong> Compare performance across your entire portfolio.</li>
                <li><strong>Central Kitchens:</strong> Manage prep and distribution to satellite branches.</li>
                <li><strong>Role-Based Access:</strong> Granular permissions for staff at every level.</li>
              </ul>
            </div>

            <div className="mt-16 bg-card p-8 rounded-2xl border border-border shadow-lg">
              <h3 className="text-2xl font-bold font-serif mb-6 text-center">Ready to scale your empire?</h3>
              <LeadForm source="feature_multi_outlet" showDetails />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
