import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
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
    <SiteLayout>
      <div className="pt-12 md:pt-24 pb-16 md:pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-3xl mx-auto mb-10 md:mb-16">
            <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight mb-4 md:mb-6">Plays well with others</h1>
            <p className="text-base md:text-xl text-muted-foreground">Connect KhanaLagao to your favorite tools for a seamless operational flow.</p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 max-w-4xl mx-auto">
            {partners.map((partner, i) => (
              <div key={i} className="flex flex-col items-center justify-center p-5 md:p-8 bg-card border border-border rounded-2xl shadow-sm hover:shadow-md transition-shadow">
                <partner.icon className="h-10 w-10 md:h-12 md:w-12 text-foreground mb-3 md:mb-4 opacity-80 hover:opacity-100 transition-opacity" />
                <h3 className="font-bold text-sm md:text-base">{partner.name}</h3>
                <p className="text-xs md:text-sm text-muted-foreground">{partner.category}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
