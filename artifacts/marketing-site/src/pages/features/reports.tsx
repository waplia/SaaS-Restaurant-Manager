import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { LeadForm } from "@/components/LeadForm";

export default function Reports() {
  useSeo({
    title: "Reports & Analytics",
    description: "Actionable business insights to improve your bottom line.",
    schema: {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "TableTrack Reports",
      "description": "Actionable business insights to improve your bottom line."
    }
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto space-y-12">
            <div className="text-center">
              <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">Reports & Analytics</h1>
              <p className="text-xl text-muted-foreground">Turn raw data into profitable decisions.</p>
            </div>
            
            <div className="prose prose-lg dark:prose-invert max-w-none">
              <p>Get a clear view of your business performance. Our dashboards highlight what's working and what needs attention.</p>
              
              <h3>Features</h3>
              <ul>
                <li><strong>Sales Dashboards:</strong> Track revenue, discounts, and voids in real-time.</li>
                <li><strong>Item Performance:</strong> Identify your most and least profitable menu items.</li>
                <li><strong>Staff Analytics:</strong> See who sells the most and turns tables fastest.</li>
                <li><strong>Automated Reports:</strong> Get daily summaries delivered to your inbox.</li>
              </ul>
            </div>

            <div className="mt-16 bg-card p-8 rounded-2xl border border-border shadow-lg">
              <h3 className="text-2xl font-bold font-serif mb-6 text-center">Start making data-driven decisions</h3>
              <LeadForm source="feature_reports" showDetails />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
