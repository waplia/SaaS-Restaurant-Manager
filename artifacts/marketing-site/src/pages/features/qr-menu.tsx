import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { LeadForm } from "@/components/LeadForm";

export default function QRMenu() {
  useSeo({
    title: "QR Menu Ordering",
    description: "Contactless dining experience that increases average order value.",
    schema: {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "KhanaLagao QR Menu",
      "description": "Contactless dining experience that increases average order value."
    }
  });

  return (
    <SiteLayout>
      <div className="pt-12 md:pt-24 pb-16 md:pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto space-y-8 md:space-y-12">
            <div className="text-center">
              <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-4 md:mb-6">QR Menu Ordering</h1>
              <p className="text-base md:text-xl text-muted-foreground">Empower your guests to order and pay from their phones.</p>
            </div>
            
            <div className="prose prose-base md:prose-lg dark:prose-invert max-w-none">
              <p>Turn tables faster and increase ticket sizes. Our beautiful mobile menus let guests browse photos, customize orders, and checkout on their terms.</p>
              
              <h3>Features</h3>
              <ul>
                <li><strong>Beautiful Visual Menus:</strong> Showcase your dishes with high-quality photos.</li>
                <li><strong>Instant Updates:</strong> Mark items out of stock in real-time.</li>
                <li><strong>Upselling:</strong> Automated pairings and add-on suggestions.</li>
                <li><strong>Pay at Table:</strong> Eliminate the wait for the check.</li>
              </ul>
            </div>

            <div className="mt-10 md:mt-16 bg-card p-5 md:p-8 rounded-2xl border border-border shadow-lg">
              <h3 className="text-xl md:text-2xl font-bold font-serif mb-4 md:mb-6 text-center">Modernize your dining experience</h3>
              <LeadForm source="feature_qr_menu" showDetails />
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
