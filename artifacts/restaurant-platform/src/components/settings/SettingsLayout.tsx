import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  Building2, Settings as Cog, Clock, CalendarDays, GitBranch, Coins,
  Mail, Receipt, CreditCard, Palette, Shield, BadgeDollarSign,
  CalendarRange, Info, Globe, Printer, Download, ImageIcon, Truck,
  Wheat, Utensils, Ban, ListChecks, RefreshCw, Sparkles, Tablet, Heart,
  Search, ChefHat, KeyRound, Webhook, ScrollText, BookOpen, Activity, MessageCircle, Hash, Calculator, MonitorSmartphone,
  Lock, ShoppingBag,
} from "lucide-react";

export type SectionKey =
  | "general" | "app" | "shifts" | "open-close" | "branch" | "currencies"
  | "email" | "taxes" | "payment" | "theme" | "roles" | "billing"
  | "reservation" | "about-us" | "customer-site" | "receipt" | "printer"
  | "downloads" | "menu-image" | "delivery" | "allergens" | "kot"
  | "cancellation-reasons" | "order-settings" | "refund-reasons" | "direct-ordering"
  | "ai" | "kiosk" | "loyalty" | "discounts" | "kitchens" | "devices" | "subscription" | "whatsapp" | "token-display"
  | "api-keys" | "webhooks" | "webhook-logs" | "api-logs" | "developer-docs"
  | "accounting" | "account" | "sessions";

type IconType = typeof Building2;

interface SectionDef {
  key: SectionKey;
  label: string;
  icon: IconType;
  ownerOnly?: boolean;
  href?: string; // override href; default `/settings/<key>`
}

interface SectionGroup {
  label: string;
  items: SectionDef[];
}

export const SETTINGS_GROUPS: SectionGroup[] = [
  {
    label: "Business",
    items: [
      { key: "general", label: "Restaurant Profile", icon: Building2, ownerOnly: true },
      { key: "branch", label: "Outlets & Branches", icon: GitBranch },
      { key: "open-close", label: "Business Hours", icon: CalendarDays },
      { key: "shifts", label: "Operational Shifts", icon: Clock },
      { key: "currencies", label: "Currency & Locale", icon: Coins, ownerOnly: true },
      { key: "taxes", label: "Tax / GST", icon: Receipt, ownerOnly: true },
      { key: "about-us", label: "About Us", icon: Info },
      { key: "billing", label: "Billing", icon: BadgeDollarSign, ownerOnly: true },
      { key: "subscription", label: "Subscription & Plan", icon: BadgeDollarSign, href: "/settings/subscription" },
    ],
  },
  {
    label: "Order",
    items: [
      { key: "app", label: "POS Preferences", icon: Cog },
      { key: "order-settings", label: "Order Settings", icon: ListChecks },
      { key: "kot", label: "KOT", icon: Utensils },
      { key: "receipt", label: "Invoice / Receipt", icon: Receipt },
      { key: "delivery", label: "Delivery Zones", icon: Truck },
      { key: "customer-site", label: "QR Menu", icon: Globe },
      { key: "direct-ordering", label: "Direct Ordering", icon: ShoppingBag },
      { key: "kiosk", label: "Kiosk", icon: Tablet },
      { key: "reservation", label: "Reservations", icon: CalendarRange },
      { key: "cancellation-reasons", label: "Cancellation Reasons", icon: Ban },
      { key: "refund-reasons", label: "Refund Reasons", icon: RefreshCw },
    ],
  },
  {
    label: "User & Security",
    items: [
      { key: "account", label: "Account & Password", icon: Lock, href: "/settings/account" },
      { key: "roles", label: "Roles & Permissions", icon: Shield, ownerOnly: true },
      { key: "sessions", label: "Active Sessions", icon: MonitorSmartphone, href: "/settings/sessions" },
    ],
  },
  {
    label: "Communication",
    items: [
      { key: "email", label: "Email", icon: Mail, ownerOnly: true },
      { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, ownerOnly: true },
    ],
  },
  {
    label: "Hardware & Integrations",
    items: [
      { key: "printer", label: "Printer", icon: Printer },
      { key: "devices", label: "Devices & Hardware", icon: Printer, href: "/settings/devices" },
      { key: "kitchens", label: "Kitchens & Stations", icon: ChefHat, href: "/settings/kitchens" },
      { key: "token-display", label: "Token Display", icon: Hash, href: "/settings/token-display" },
      { key: "payment", label: "Payment Gateway", icon: CreditCard, ownerOnly: true },
      { key: "accounting", label: "Accounting", icon: Calculator, href: "/settings/accounting" },
      { key: "api-keys", label: "API Keys", icon: KeyRound, ownerOnly: true, href: "/settings/api-keys" },
      { key: "webhooks", label: "Webhooks", icon: Webhook, ownerOnly: true, href: "/settings/webhooks" },
      { key: "webhook-logs", label: "Webhook Logs", icon: ScrollText, ownerOnly: true, href: "/settings/webhook-logs" },
      { key: "api-logs", label: "API Usage Logs", icon: Activity, ownerOnly: true, href: "/settings/api-logs" },
      { key: "developer-docs", label: "Developer Docs", icon: BookOpen, href: "/settings/developer-docs" },
    ],
  },
  {
    label: "AI Settings",
    items: [
      { key: "ai", label: "Khana AI Preferences", icon: Sparkles, ownerOnly: true },
    ],
  },
  {
    label: "Branding",
    items: [
      { key: "theme", label: "Theme & Branding", icon: Palette, ownerOnly: true },
      { key: "menu-image", label: "Menu Item Images", icon: ImageIcon },
      { key: "downloads", label: "Downloads / Apps", icon: Download },
      { key: "allergens", label: "Allergens (EU 1169/2011)", icon: Wheat },
    ],
  },
  {
    label: "Module Management",
    items: [
      { key: "loyalty", label: "Loyalty Program", icon: Heart, ownerOnly: true },
      { key: "discounts", label: "Discounts & Coupons", icon: BadgeDollarSign, ownerOnly: true },
    ],
  },
];

export function hrefFor(item: SectionDef): string {
  return item.href ?? `/settings/${item.key}`;
}

interface Props {
  activeKey: SectionKey;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function SettingsLayout({ activeKey, title, subtitle, actions, children }: Props) {
  const [location] = useLocation();
  const { user } = useAuth();
  const isOwner = !!user?.isSuperAdmin || user?.role === "owner";
  const [search, setSearch] = useState("");

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return SETTINGS_GROUPS.map(g => ({
      label: g.label,
      items: g.items.filter(i => {
        if (i.ownerOnly && !isOwner) return false;
        if (!q) return true;
        return i.label.toLowerCase().includes(q) || i.key.toLowerCase().includes(q);
      }),
    })).filter(g => g.items.length > 0);
  }, [search, isOwner]);

  return (
    <Layout>
      <div className="flex min-h-[calc(100vh-3rem)]">
        {/* Left rail */}
        <aside className="w-72 shrink-0 border-r border-border bg-card/40 flex flex-col">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground mb-3">Settings</h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search settings…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto p-2 space-y-4">
            {visibleGroups.map(group => (
              <div key={group.label}>
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map(item => {
                    const href = hrefFor(item);
                    const Icon = item.icon;
                    const active = item.key === activeKey || location === href;
                    return (
                      <Link
                        key={item.key}
                        href={href}
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors",
                          active
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-foreground hover:bg-accent/60",
                        )}
                      >
                        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            {visibleGroups.length === 0 && (
              <p className="px-2 py-4 text-xs text-muted-foreground text-center">No matches</p>
            )}
          </nav>
        </aside>

        {/* Right pane */}
        <div className="flex-1 overflow-auto">
          <div className="border-b border-border px-8 py-5 flex items-start justify-between gap-4 bg-background sticky top-0 z-10">
            <div>
              <h1 className="text-xl font-semibold text-foreground">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
          <div className="p-8 max-w-4xl">{children}</div>
        </div>
      </div>
    </Layout>
  );
}
