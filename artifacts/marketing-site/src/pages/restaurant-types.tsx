import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useParams, Link } from "wouter";
import NotFound from "@/pages/not-found";
import { LeadForm } from "@/components/LeadForm";

const TYPES: Record<string, { title: string, desc: string }> = {
  "fine-dining": { title: "Fine Dining", desc: "Elevate your guest experience with elegant tableside service and detailed guest profiles." },
  "cafe": { title: "Cafes & Coffee Shops", desc: "Keep the morning line moving with lightning-fast entry and loyalty integrations." },
  "bakery": { title: "Bakeries", desc: "Manage complex pre-orders, wholesale accounts, and daily production runs." },
  "cloud-kitchen": { title: "Cloud Kitchens", desc: "Aggregate delivery platforms and streamline your prep stations." },
  "bar-pub": { title: "Bars & Pubs", desc: "Handle open tabs, split checks, and high-volume nights effortlessly." },
  "qsr": { title: "Quick Service", desc: "Maximize throughput with self-serve kiosks and kitchen display systems." },
  "food-truck": { title: "Food Trucks", desc: "Take your business anywhere with our robust offline mode and mobile POS." },
  "multi-outlet-chain": { title: "Multi-Outlet Chains", desc: "Standardize operations and gain portfolio-wide insights from HQ." }
};

export default function RestaurantTypes() {
  const params = useParams();
  const type = params.type as string;
  
  if (!type || !TYPES[type]) {
    return <NotFound />;
  }

  const data = TYPES[type];

  useSeo({
    title: `TableTrack for ${data.title}`,
    description: data.desc,
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-16">
              <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">Built for {data.title}</h1>
              <p className="text-xl text-muted-foreground">{data.desc}</p>
            </div>
            
            <div className="bg-card p-8 rounded-2xl border border-border shadow-lg mb-16">
              <h3 className="text-2xl font-bold font-serif mb-6 text-center">Talk to a specialist</h3>
              <LeadForm source={`type_${type}`} showDetails />
            </div>
            
            <div className="mt-24">
              <h4 className="font-bold text-lg mb-6 text-center">Explore other business types</h4>
              <div className="flex flex-wrap gap-3 justify-center">
                {Object.entries(TYPES).map(([key, val]) => (
                  <Link key={key} href={`/restaurant-types/${key}`} className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors ${key === type ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-accent'}`}>
                    {val.title}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
