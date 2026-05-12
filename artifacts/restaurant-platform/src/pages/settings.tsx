import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Settings, Store, Bell, Shield, Palette } from "lucide-react";

export default function SettingsPage() {
  return (
    <Layout>
      <PageHeader title="Settings" subtitle="Configure your restaurant" />
      <div className="p-6 max-w-2xl space-y-4">
        {[
          { icon: Store, title: "Restaurant Profile", desc: "Name, address, contact, hours" },
          { icon: Palette, title: "Branding", desc: "Logo, colors, theme" },
          { icon: Bell, title: "Notifications", desc: "Alert preferences and channels" },
          { icon: Shield, title: "Security", desc: "Password, permissions, 2FA" },
          { icon: Settings, title: "Integrations", desc: "Payment gateways, delivery platforms" },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl hover:border-primary/30 cursor-pointer transition-colors">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center text-accent-foreground">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-foreground">{title}</p>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
