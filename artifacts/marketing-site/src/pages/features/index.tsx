import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Smartphone, Store, BarChart3, ChefHat, Wallet, Clock, Users, ArrowRight } from "lucide-react";

export default function FeaturesIndex() {
  useSeo({
    title: "All Features",
    description: "Explore the complete suite of tools Khana Lagao offers to run your restaurant operation smoothly.",
  });

  const features = [
    { title: "POS & Billing", icon: Smartphone, href: "/features/pos-billing", desc: "Fast, reliable point of sale designed for high-volume environments." },
    { title: "QR Menu Ordering", icon: Smartphone, href: "/features/qr-menu", desc: "Contactless dining experience that increases average order value." },
    { title: "Online Ordering", icon: Store, href: "/features/online-ordering", desc: "Direct delivery & takeout without the massive commission fees." },
    { title: "Inventory Management", icon: ChefHat, href: "/features/inventory-management", desc: "Real-time stock tracking and automated reordering alerts." },
    { title: "Staff & Payroll", icon: Users, href: "/features/payroll", desc: "Manage shifts, calculate wages, and track staff performance." },
    { title: "Reports & Analytics", icon: BarChart3, href: "/features/reports", desc: "Actionable business insights to improve your bottom line." },
    { title: "Multi-Outlet", icon: Store, href: "/features/multi-outlet", desc: "Scale across locations with centralized control and reporting." }
  ];

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow pt-24 pb-32">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">Everything you need to run your restaurant</h1>
            <p className="text-xl text-muted-foreground">From the front of house to the back office, Khana Lagao connects every part of your operation.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feat, i) => (
              <Link href={feat.href} key={i}>
                <motion.div 
                  whileHover={{ y: -5 }}
                  className="block group h-full p-8 rounded-2xl border border-border bg-card hover:shadow-lg transition-all duration-300"
                >
                  <div className="mb-6 inline-flex p-4 rounded-xl bg-primary/5 group-hover:bg-primary/10 transition-colors">
                    <feat.icon className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3 font-serif">{feat.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feat.desc}</p>
                  <div className="mt-6 flex items-center text-sm font-medium text-primary opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all">
                    Explore feature <ArrowRight className="ml-1 h-4 w-4" />
                  </div>
                </motion.div>
              </Link>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
