import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ShieldCheck, LayoutDashboard, TrendingUp, Activity, History, Building2, Package, Tag, FileCheck2,
  CreditCard, Landmark, Megaphone, Mail, MessageSquare, MessageCircle, Bell, Inbox, FileText, LifeBuoy,
  Wrench, Settings, Brain, Sun, Moon, Search, ArrowLeft, ChevronDown, LogOut, Menu as MenuIcon, X, ListChecks,
  Image as ImageIconLucide,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useAppSettings } from "@/lib/appSettings";
import { resolveImageUrl } from "@/components/ImageUploadField";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

type IconType = typeof LayoutDashboard;
type LinkItem = { kind: "link"; href: string; label: string; icon: IconType; badgeKey?: "leads" | "approvals" };
type GroupItem = { kind: "group"; key: string; label: string; icon: IconType; children: LinkItem[] };
type NavEntry = LinkItem | GroupItem;

// Super-admin sidebar — 11 spec sections (Task #492).
const NAV: NavEntry[] = [
  // 1. Dashboard
  { kind: "link", href: "/admin/tenants", label: "Dashboard", icon: LayoutDashboard },
  // 2. Restaurants
  {
    kind: "group", key: "restaurants", label: "Restaurants", icon: Building2,
    children: [
      { kind: "link", href: "/admin/tenants", label: "Tenants", icon: Building2 },
      { kind: "link", href: "/admin/approvals", label: "Approvals", icon: FileCheck2, badgeKey: "approvals" },
      { kind: "link", href: "/admin/implementations", label: "Implementations", icon: ListChecks },
      { kind: "link", href: "/admin/audit-logs", label: "Audit Logs", icon: History },
    ],
  },
  // 3. Plans & Billing
  {
    kind: "group", key: "plans_billing", label: "Plans & Billing", icon: CreditCard,
    children: [
      { kind: "link", href: "/admin/plans", label: "Plans", icon: Package },
      { kind: "link", href: "/admin/coupons", label: "Coupons", icon: Tag },
      { kind: "link", href: "/admin/payment-methods", label: "Payment Methods", icon: CreditCard },
      { kind: "link", href: "/admin/fintech", label: "Fintech", icon: Landmark },
      { kind: "link", href: "/admin/finance-partners", label: "Finance Partners", icon: Landmark },
    ],
  },
  // 4. Feature Control
  {
    kind: "group", key: "feature_control", label: "Feature Control", icon: Settings,
    children: [
      { kind: "link", href: "/admin/settings", label: "App Settings", icon: Settings },
      { kind: "link", href: "/admin/maintenance", label: "System Maintenance", icon: Wrench },
    ],
  },
  // 5. AI Control Center
  { kind: "link", href: "/admin/ai", label: "AI Control Center", icon: Brain },
  { kind: "link", href: "/admin/stock-food-images", label: "Food Image Library", icon: ImageIconLucide },
  // 6. Website & Leads
  {
    kind: "group", key: "website_leads", label: "Website & Leads", icon: Inbox,
    children: [
      { kind: "link", href: "/admin/leads", label: "Marketing Leads", icon: Inbox, badgeKey: "leads" },
      { kind: "link", href: "/admin/blog", label: "Blog Posts", icon: FileText },
    ],
  },
  // 7. Email Center
  {
    kind: "group", key: "email_center", label: "Email Center", icon: Mail,
    children: [
      { kind: "link", href: "/admin/notifications", label: "Notifications", icon: Megaphone },
      { kind: "link", href: "/admin/email", label: "Email", icon: Mail },
      { kind: "link", href: "/admin/sms", label: "SMS", icon: MessageSquare },
      { kind: "link", href: "/admin/web-push", label: "Web Push", icon: Bell },
      { kind: "link", href: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
    ],
  },
  // 8. Marketplace
  { kind: "link", href: "/admin/addons", label: "Marketplace", icon: Package },
  // 9. Support
  { kind: "link", href: "/admin/support", label: "Support", icon: LifeBuoy },
  // 10. Reports
  {
    kind: "group", key: "reports", label: "Reports", icon: TrendingUp,
    children: [
      { kind: "link", href: "/admin/metrics", label: "Investor Metrics", icon: TrendingUp },
      { kind: "link", href: "/admin/health", label: "Restaurant Health", icon: Activity },
    ],
  },
  // 11. System
  {
    kind: "group", key: "system", label: "System", icon: Wrench,
    children: [
      { kind: "link", href: "/admin/system-health", label: "System Health", icon: Activity },
      { kind: "link", href: "/admin/api-settings", label: "API & Webhooks", icon: Settings },
    ],
  },
];

const STORAGE_KEY = "tt_admin_sidebar_v1";

function collectHrefs(): string[] {
  const out: string[] = [];
  for (const e of NAV) {
    if (e.kind === "link") out.push(e.href);
    else for (const c of e.children) out.push(c.href);
  }
  return out;
}
const ALL_HREFS = collectHrefs();

function isActive(location: string, href: string) {
  if (location !== href && !location.startsWith(href + "/")) return false;
  for (const other of ALL_HREFS) {
    if (other === href) continue;
    if (other.length <= href.length) continue;
    if (location === other || location.startsWith(other + "/")) return false;
  }
  return true;
}

function loadOpen(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveOpen(s: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const appSettings = useAppSettings();

  const { data: leadStats } = useQuery<{ byStatus: { status: string; count: number }[] }>({
    queryKey: ["admin-leads-new-count"],
    queryFn: () => apiFetch("/admin/leads/stats"),
    enabled: !!user?.isSuperAdmin,
    refetchInterval: 60_000,
  });
  const leadsCount = leadStats?.byStatus.find(s => s.status === "new")?.count ?? 0;

  type ManualPaymentsResponse = { total?: number; payments?: unknown[] };
  const { data: pendingApprovals } = useQuery<{ count: number } | null>({
    queryKey: ["admin-pending-approvals-count"],
    queryFn: () =>
      apiFetch<ManualPaymentsResponse>("/admin/manual-payments?status=pending&limit=1")
        .then((r) => ({ count: r?.total ?? r?.payments?.length ?? 0 }))
        .catch(() => null),
    enabled: !!user?.isSuperAdmin,
    refetchInterval: 60_000,
  });
  const approvalsCount = pendingApprovals?.count ?? 0;

  const badgeFor = (key?: "leads" | "approvals") => {
    if (key === "leads") return leadsCount;
    if (key === "approvals") return approvalsCount;
    return 0;
  };

  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => loadOpen());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return NAV;
    const out: NavEntry[] = [];
    for (const e of NAV) {
      if (e.kind === "link") {
        if (e.label.toLowerCase().includes(q)) out.push(e);
      } else {
        const groupMatch = e.label.toLowerCase().includes(q);
        const matched = e.children.filter(c => c.label.toLowerCase().includes(q));
        if (groupMatch) out.push(e);
        else if (matched.length > 0) out.push({ ...e, children: matched });
      }
    }
    return out;
  }, [search]);

  useEffect(() => {
    setOpenGroups(prev => {
      let changed = false;
      const next = { ...prev };
      for (const e of NAV) {
        if (e.kind === "group") {
          const containsActive = e.children.some(c => isActive(location, c.href));
          if (containsActive && !next[e.key]) { next[e.key] = true; changed = true; }
        }
      }
      if (changed) saveOpen(next);
      return changed ? next : prev;
    });
  }, [location]);

  const effectiveOpen = (key: string) => (search.trim() ? true : !!openGroups[key]);
  const toggle = (key: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveOpen(next);
      return next;
    });
  };

  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-sidebar border-r border-sidebar-border">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        {appSettings.logoUrl ? (
          <img src={resolveImageUrl(appSettings.logoUrl)} alt={appSettings.appName} className="w-9 h-9 rounded-xl object-cover ring-1 ring-primary/20" />
        ) : (
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md shadow-primary/30 ring-1 ring-primary/20">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sidebar-foreground leading-tight tracking-tight text-sm">Super Admin</p>
          <p className="text-xs text-muted-foreground truncate">{appSettings.appName}</p>
        </div>
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* Search + Back-to-Restaurant */}
      <div className="px-3 pt-3 pb-2 space-y-2 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search admin…"
            className="w-full pl-8 pr-2 h-8 rounded-md text-xs bg-sidebar-accent/40 border border-sidebar-border placeholder:text-muted-foreground/70 text-sidebar-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            data-testid="admin-sidebar-search"
          />
        </div>
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="w-full flex items-center gap-2 px-2.5 h-8 rounded-md text-xs font-medium bg-gradient-to-r from-primary/15 to-primary/5 text-sidebar-foreground hover:from-primary/25 hover:to-primary/10 transition-colors"
          data-testid="admin-back-to-restaurant"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-primary" />
          <span className="flex-1 text-left">Back to Restaurant</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-xs text-muted-foreground text-center">No matches</p>
        )}
        {filtered.map(entry => {
          if (entry.kind === "link") {
            const active = isActive(location, entry.href);
            const Icon = entry.icon;
            const count = badgeFor(entry.badgeKey);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/90 text-sidebar-primary-foreground shadow-sm shadow-primary/20"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{entry.label}</span>
                {count > 0 && (
                  <span className={cn(
                    "text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                    active ? "bg-white/25 text-white" : "bg-orange-500 text-white",
                  )}>{count}</span>
                )}
              </Link>
            );
          }

          const Icon = entry.icon;
          const isOpen = effectiveOpen(entry.key);
          const childActive = entry.children.some(c => isActive(location, c.href));
          const groupCount = entry.children.reduce((acc, c) => acc + badgeFor(c.badgeKey), 0);
          const panelId = `admin-group-${entry.key}`;

          return (
            <div key={entry.key}>
              <button
                type="button"
                onClick={() => toggle(entry.key)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  childActive
                    ? "text-sidebar-foreground bg-sidebar-accent/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left">{entry.label}</span>
                {!isOpen && groupCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500 text-white">{groupCount}</span>
                )}
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-300 ease-out", isOpen ? "rotate-0" : "-rotate-90")} />
              </button>
              <div
                id={panelId}
                aria-hidden={!isOpen}
                className={cn(
                  "grid transition-all duration-300 ease-out",
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none",
                )}
              >
                <div className="overflow-hidden">
                  <div className="mt-0.5 ml-3 pl-3 border-l border-sidebar-border space-y-0.5 py-0.5">
                    {entry.children.map(c => {
                      const ChildIcon = c.icon;
                      const active = isActive(location, c.href);
                      const count = badgeFor(c.badgeKey);
                      return (
                        <Link
                          key={c.href + entry.key}
                          href={c.href}
                          tabIndex={isOpen ? 0 : -1}
                          aria-hidden={!isOpen}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                            active
                              ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/90 text-sidebar-primary-foreground shadow-sm shadow-primary/20"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          )}
                        >
                          <ChildIcon className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="flex-1">{c.label}</span>
                          {count > 0 && (
                            <span className={cn(
                              "text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                              active ? "bg-white/25 text-white" : "bg-orange-500 text-white",
                            )}>{count}</span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer user */}
      <div className="px-3 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">{initials}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sidebar-foreground font-medium truncate text-sm">{user?.name ?? "—"}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email ?? ""}</p>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function AdminMobileBar() {
  const [open, setOpen] = useState(false);
  const { appName } = useAppSettings();
  return (
    <>
      <div className="md:hidden flex items-center justify-between gap-3 border-b border-border bg-card px-4 h-12 sticky top-0 z-30">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground hover:bg-accent"
          aria-label="Open menu"
        >
          <MenuIcon className="w-5 h-5" />
        </button>
        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" /> {appName} Admin
        </p>
        <div className="w-9" />
      </div>
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="relative w-72 max-w-[85vw] h-full bg-sidebar shadow-xl overflow-y-auto">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-md flex items-center justify-center bg-sidebar-accent text-sidebar-foreground"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
            <AdminSidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
