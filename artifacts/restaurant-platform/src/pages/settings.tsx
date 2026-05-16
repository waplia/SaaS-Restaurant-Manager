import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { useAuth } from "@/lib/auth";
import { SETTINGS_GROUPS, hrefFor } from "@/components/settings/SettingsLayout";
import { Sparkles, Package, ExternalLink } from "lucide-react";

export default function SettingsPage() {
  const { user } = useAuth();
  const isOwner = !!user?.isSuperAdmin || user?.role === "owner";

  const groups = SETTINGS_GROUPS.map(g => ({
    label: g.label,
    items: g.items.filter(i => !i.ownerOnly || isOwner),
  })).filter(g => g.items.length > 0);

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure your restaurant, integrations, branding, and modules.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {groups.map(group => (
            <div
              key={group.label}
              className="rounded-xl border border-border bg-card overflow-hidden flex flex-col"
              data-testid={`settings-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <h2 className="text-sm font-semibold text-foreground">{group.label}</h2>
              </div>
              <div className="p-2 flex-1">
                {group.items.map(item => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.key}
                      href={hrefFor(item)}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-foreground hover:bg-accent/60 transition-colors"
                    >
                      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground/60" />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Module Management extras */}
          <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <h2 className="text-sm font-semibold text-foreground">Marketplace & AI</h2>
            </div>
            <div className="p-2 flex-1">
              <Link href="/marketplace" className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-foreground hover:bg-accent/60 transition-colors">
                <Package className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 truncate">Add-ons Marketplace</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground/60" />
              </Link>
              <Link href="/ai/usage" className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-foreground hover:bg-accent/60 transition-colors">
                <Sparkles className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 truncate">AI Credits & Usage</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground/60" />
              </Link>
              <Link href="/ai/settings" className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-foreground hover:bg-accent/60 transition-colors">
                <Sparkles className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 truncate">AI Feature Toggles</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground/60" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
