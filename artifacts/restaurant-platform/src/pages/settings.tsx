import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Link } from "wouter";
import { Settings, Store, Bell, Shield, Palette, CreditCard, ChevronRight, ChefHat } from "lucide-react";

export default function SettingsPage() {
  const items = [
    { icon: Store, title: "Restaurant Profile", desc: "Name, address, contact, hours", href: null },
    { icon: ChefHat, title: "Kitchens & Stations", desc: "Define kitchens, route items, printer & auto-print", href: "/settings/kitchens" },
    { icon: CreditCard, title: "Subscription & Billing", desc: "Manage your plan, upgrade, view usage", href: "/settings/subscription" },
    { icon: Palette, title: "Branding", desc: "Logo, colors, theme", href: null },
    { icon: Bell, title: "Notifications", desc: "Alert preferences and channels", href: "/notifications" },
    { icon: Shield, title: "Security", desc: "Password, permissions, 2FA", href: null },
    { icon: Settings, title: "Integrations", desc: "Payment gateways, delivery platforms", href: null },
  ];

  return (
    <Layout>
      <PageHeader title="Settings" subtitle="Configure your restaurant" />
      <div className="p-6 max-w-2xl space-y-3">
        {items.map(({ icon: Icon, title, desc, href }) => {
          const inner = (
            <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl hover:border-primary/30 cursor-pointer transition-colors">
              <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center text-accent-foreground flex-shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{title}</p>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
              {href && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </div>
          );
          return href ? (
            <Link key={title} href={href}>{inner}</Link>
          ) : (
            <div key={title}>{inner}</div>
          );
        })}
      </div>
    </Layout>
  );
}
