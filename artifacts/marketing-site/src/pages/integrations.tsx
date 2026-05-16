import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SiStripe, SiRazorpay, SiZomato, SiSwiggy, SiUbereats, SiDoordash, SiQuickbooks, SiXero } from "react-icons/si";

export default function Integrations() {
  useSeo({
    title: "Integrations",
    description: "KhanaLagao integrates with the tools you already use. Payments, delivery, accounting, and more.",
  });

  const partners = [
    { name: "Stripe", icon: SiStripe, category: "Payments" },
    { name: "Razorpay", icon: SiRazorpay, category: "Payments" },
    { name: "UberEats", icon: SiUbereats, category: "Delivery" },
    { name: "DoorDash", icon: SiDoordash, category: "Delivery" },
    { name: "Zomato", icon: SiZomato, category: "Delivery" },
    { name: "Swiggy", icon: SiSwiggy, category: "Delivery" },
    { name: "QuickBooks", icon: SiQuickbooks, category: "Accounting" },
    { name: "Xero", icon: SiXero, category: "Accounting" }
  ];

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">Plays well with others</h1>
            <p className="text-xl text-muted-foreground">Connect KhanaLagao to your favorite tools for a seamless operational flow.</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
            {partners.map((partner, i) => (
              <div key={i} className="flex flex-col items-center justify-center p-8 bg-card border border-border rounded-2xl shadow-sm hover:shadow-md transition-shadow">
                <partner.icon className="h-12 w-12 text-foreground mb-4 opacity-80 hover:opacity-100 transition-opacity" />
                <h3 className="font-bold">{partner.name}</h3>
                <p className="text-sm text-muted-foreground">{partner.category}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
