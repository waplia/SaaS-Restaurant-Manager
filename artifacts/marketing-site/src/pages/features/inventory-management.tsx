import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { LeadForm } from "@/components/LeadForm";

export default function InventoryManagement() {
  useSeo({
    title: "Inventory Management",
    description: "Real-time stock tracking and automated reordering alerts.",
    schema: {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Khana Lagao Inventory",
      "description": "Real-time stock tracking and automated reordering alerts."
    }
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto space-y-12">
            <div className="text-center">
              <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">Inventory Management</h1>
              <p className="text-xl text-muted-foreground">Know exactly what's in your pantry, down to the gram.</p>
            </div>
            
            <div className="prose prose-lg dark:prose-invert max-w-none">
              <p>Control your food costs with precision. Our inventory system links directly to your recipes, deducting ingredients automatically with every sale.</p>
              
              <h3>Features</h3>
              <ul>
                <li><strong>Recipe Management:</strong> Track cost-per-plate accurately.</li>
                <li><strong>Auto-Depletion:</strong> Ingredients are deducted as sales are made.</li>
                <li><strong>Low Stock Alerts:</strong> Never run out of your best-sellers.</li>
                <li><strong>Vendor Management:</strong> Track supplier prices and send purchase orders.</li>
              </ul>
            </div>

            <div className="mt-16 bg-card p-8 rounded-2xl border border-border shadow-lg">
              <h3 className="text-2xl font-bold font-serif mb-6 text-center">Take control of your food costs</h3>
              <LeadForm source="feature_inventory" showDetails />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
