import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, ShoppingCart, ChefHat, UtensilsCrossed,
  Package, Users, UserCheck, BarChart3, Table2, Settings,
  Flame, Sun, Moon, LogOut, ShieldCheck, Monitor, Receipt, Wallet, AlertCircle, AlertTriangle,
  ChevronDown, Coins, TrendingUp, Percent, Truck, Banknote, BellRing, CalendarDays, Inbox, FileText, LifeBuoy,
  Sparkles, ImageIcon, Upload, History, Megaphone,
} from "lucide-react";
import { useWaiterRequests } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useAppSettings } from "@/lib/appSettings";
import { NotificationDropdown } from "./NotificationDropdown";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

type IconType = typeof LayoutDashboard;
type PlanGate = "ai" | "ai_insights";
type LinkItem = { kind: "link"; href: string; label: string; icon: IconType; roles?: string[]; planGate?: PlanGate };
type GroupItem = { kind: "group"; key: string; label: string; icon: IconType; children: LinkItem[]; badge?: "ai"; planGate?: PlanGate };
type NavEntry = LinkItem | GroupItem;

const navConfig: NavEntry[] = [
  { kind: "link", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { kind: "link", href: "/pos", label: "POS Terminal", icon: Monitor },
  { kind: "link", href: "/orders", label: "Orders", icon: ShoppingCart },
  { kind: "link", href: "/kitchen", label: "Kitchen", icon: ChefHat },
  { kind: "link", href: "/tables", label: "Tables", icon: Table2 },
  { kind: "link", href: "/reservations", label: "Reservations", icon: CalendarDays },
  { kind: "link", href: "/waiter-requests", label: "Waiter Requests", icon: BellRing, roles: ["owner", "manager", "waiter"] },
  { kind: "link", href: "/menu", label: "Menu", icon: UtensilsCrossed },
  { kind: "link", href: "/inventory", label: "Inventory", icon: Package },
  { kind: "link", href: "/staff", label: "Staff", icon: UserCheck },
  { kind: "link", href: "/customers", label: "Customers", icon: Users },
  { kind: "link", href: "/growth", label: "Growth Engine", icon: Megaphone, roles: ["owner", "manager"] },
  { kind: "link", href: "/marketplace", label: "Marketplace", icon: Package, roles: ["owner", "manager"] },
  { kind: "link", href: "/support", label: "Support", icon: LifeBuoy, roles: ["owner", "manager"] },
  {
    kind: "group", key: "delivery", label: "Delivery", icon: Truck,
    children: [
      { kind: "link", href: "/delivery/executives", label: "Delivery Executives", icon: Truck, roles: ["owner", "manager"] },
      { kind: "link", href: "/delivery/cod", label: "COD Monitoring", icon: Banknote, roles: ["owner", "manager"] },
    ],
  },
  {
    kind: "group", key: "finance", label: "Finance", icon: Coins,
    children: [
      { kind: "link", href: "/cash-register", label: "Cash Register", icon: Banknote, roles: ["owner", "manager", "waiter"] },
      { kind: "link", href: "/payments", label: "Payments", icon: Wallet, roles: ["owner", "manager"] },
      { kind: "link", href: "/due-payments", label: "Due Payments", icon: AlertCircle, roles: ["owner", "manager"] },
      { kind: "link", href: "/expenses", label: "Expenses", icon: Receipt, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/payroll", label: "Payroll", icon: Wallet, roles: ["owner"] },
      { kind: "link", href: "/wallets", label: "Wallet & Gift Cards", icon: Wallet, roles: ["owner", "manager"] },
      { kind: "link", href: "/settlements", label: "Settlements & Recon", icon: TrendingUp, roles: ["owner", "manager", "cashier"] },
      { kind: "link", href: "/capital", label: "Capital & Insurance", icon: Banknote, roles: ["owner", "manager"] },
    ],
  },
  {
    kind: "group", key: "khana_ai", label: "Khana AI", icon: Sparkles, badge: "ai", planGate: "ai",
    children: [
      { kind: "link", href: "/ai", label: "Dashboard", icon: LayoutDashboard, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/descriptions", label: "AI Item Descriptions", icon: FileText, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/images", label: "AI Food Images", icon: ImageIcon, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/menu-import", label: "AI Menu Import", icon: Upload, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/menu-import/history", label: "Import History", icon: History, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/review-qrs", label: "Review QRs", icon: Sparkles, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/review-replies", label: "AI Review Replies", icon: FileText, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/feedback-recovery", label: "Feedback Recovery", icon: AlertTriangle, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/upsell", label: "Upsell Engine", icon: TrendingUp, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/insights", label: "AI Sales Insights", icon: TrendingUp, roles: ["owner", "manager"], planGate: "ai_insights" },
      { kind: "link", href: "/menu/pricing-optimizer", label: "Cost & Price Optimizer", icon: Flame, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/staff-insights", label: "AI Staff Insights", icon: UserCheck, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/usage", label: "AI Usage & Credits", icon: Coins, roles: ["owner", "manager"] },
      { kind: "link", href: "/ai/settings", label: "AI Settings", icon: Settings, roles: ["owner", "manager"] },
    ],
  },
  {
    kind: "group", key: "reports", label: "Reports", icon: BarChart3,
    children: [
      { kind: "link", href: "/reports/sales", label: "Sales", icon: TrendingUp },
      { kind: "link", href: "/reports/compare", label: "Compare Branches", icon: BarChart3, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/reports/tax", label: "Tax", icon: Percent },
      { kind: "link", href: "/reports/staff", label: "Staff", icon: Users },
      { kind: "link", href: "/reports/payments", label: "Payments", icon: Wallet },
      { kind: "link", href: "/reports/cash-variance", label: "Cash Variance", icon: AlertTriangle, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/reports/food-cost", label: "Food Cost", icon: Flame, roles: ["owner", "manager", "super_admin"] },
      { kind: "link", href: "/reports/fraud-alerts", label: "Fraud Alerts", icon: AlertTriangle, roles: ["owner", "manager", "super_admin"] },
    ],
  },
];

const STORAGE_KEY = "tt_sidebar_groups_open_v1";

function isActiveHref(location: string, href: string) {
  return href === "/" ? location === "/" : location.startsWith(href);
}

function loadOpenState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

function saveOpenState(state: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function Sidebar() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const appSettings = useAppSettings();

  const canSeeWaiterRequests = user?.isSuperAdmin || (user?.role ? ["owner", "manager", "waiter"].includes(user.role) : false);
  const { data: waiterReqs = [] } = useWaiterRequests({ enabled: canSeeWaiterRequests });
  const activeWaiterCount = waiterReqs.filter(r => r.status === "pending" || r.status === "acknowledged").length;

  const { data: leadStats } = useQuery<{ byStatus: { status: string; count: number }[] }>({
    queryKey: ["admin-leads-new-count"],
    queryFn: () => apiFetch("/admin/leads/stats"),
    enabled: !!user?.isSuperAdmin,
    refetchInterval: 60_000,
  });
  const newLeadsCount = leadStats?.byStatus.find(s => s.status === "new")?.count ?? 0;

  // Plan-gate the Khana AI group on plan.aiEnabled (exposed via /ai/wallet).
  const { data: aiWallet } = useQuery<{ planAiEnabled: boolean; planKhanaAiInsightsEnabled?: boolean }>({
    queryKey: ["ai-wallet"],
    queryFn: () => apiFetch("/ai/wallet"),
    enabled: !!user && (user.isSuperAdmin || ["owner", "manager"].includes(user.role ?? "")),
    staleTime: 60_000,
  });
  const aiPlanEnabled = aiWallet?.planAiEnabled ?? false;
  const aiInsightsEnabled = aiWallet?.planKhanaAiInsightsEnabled ?? false;

  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  const canSee = (item: LinkItem) => {
    if (!item.roles) return true;
    if (user?.isSuperAdmin) return true;
    return user?.role ? item.roles.includes(user.role) : false;
  };

  const passesPlanGate = (gate: PlanGate | undefined) => {
    if (!gate) return true;
    if (user?.isSuperAdmin) return true;
    if (gate === "ai") return aiPlanEnabled;
    if (gate === "ai_insights") return aiPlanEnabled && aiInsightsEnabled;
    return true;
  };

  // Filter children inside groups by role + plan-gate; drop groups that have no
  // visible children.
  const visibleEntries: NavEntry[] = useMemo(() => {
    const out: NavEntry[] = [];
    for (const e of navConfig) {
      if (e.kind === "link") {
        if (!passesPlanGate(e.planGate)) continue;
        if (canSee(e)) out.push(e);
      } else {
        if (!passesPlanGate(e.planGate)) continue;
        const visibleChildren = e.children.filter((c) => canSee(c) && passesPlanGate(c.planGate));
        if (visibleChildren.length > 0) out.push({ ...e, children: visibleChildren });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.isSuperAdmin, aiPlanEnabled, aiInsightsEnabled]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => loadOpenState());

  // Auto-open the group containing the active route on mount / when location changes.
  useEffect(() => {
    setOpenGroups(prev => {
      let changed = false;
      const next = { ...prev };
      for (const e of visibleEntries) {
        if (e.kind === "group") {
          const containsActive = e.children.some(c => isActiveHref(location, c.href));
          if (containsActive && !next[e.key]) {
            next[e.key] = true;
            changed = true;
          }
        }
      }
      if (changed) saveOpenState(next);
      return changed ? next : prev;
    });
  }, [location, visibleEntries]);

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveOpenState(next);
      return next;
    });
  };

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-sidebar border-r border-sidebar-border">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        {appSettings.logoUrl ? (
          <img
            src={appSettings.logoUrl}
            alt={appSettings.appName}
            className="w-9 h-9 rounded-xl object-cover shadow-md shadow-primary/30 ring-1 ring-primary/20"
          />
        ) : (
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md shadow-primary/30 ring-1 ring-primary/20">
            <Flame className="w-5 h-5 text-white" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sidebar-foreground leading-tight tracking-tight">{appSettings.appName}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.name ?? "Loading…"}</p>
        </div>
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors flex-shrink-0"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleEntries.map(entry => {
          if (entry.kind === "link") {
            const active = isActiveHref(location, entry.href);
            const Icon = entry.icon;
            return (
              <Link key={entry.href} href={entry.href} className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                active
                  ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/90 text-sidebar-primary-foreground shadow-sm shadow-primary/20"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{entry.label}</span>
                {entry.href === "/waiter-requests" && activeWaiterCount > 0 && (
                  <span className={cn(
                    "text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                    active ? "bg-white/25 text-white" : "bg-orange-500 text-white",
                  )}>{activeWaiterCount}</span>
                )}
              </Link>
            );
          }

          const Icon = entry.icon;
          const isOpen = !!openGroups[entry.key];
          const childActive = entry.children.some(c => isActiveHref(location, c.href));
          const panelId = `sidebar-group-${entry.key}`;

          return (
            <div key={entry.key}>
              <button
                type="button"
                onClick={() => toggleGroup(entry.key)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  childActive
                    ? "text-sidebar-foreground bg-sidebar-accent/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className={cn("w-4 h-4 flex-shrink-0", entry.badge === "ai" && "text-violet-500")} />
                <span className="flex-1 text-left">{entry.label}</span>
                {entry.badge === "ai" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white tracking-wide uppercase">
                    AI Powered
                  </span>
                )}
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-300 ease-out", isOpen ? "rotate-0" : "-rotate-90")} />
              </button>
              <div
                id={panelId}
                aria-hidden={!isOpen}
                className={cn(
                  "grid transition-all duration-300 ease-out",
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                )}
              >
                <div className="overflow-hidden">
                  <div className="mt-0.5 ml-3 pl-3 border-l border-sidebar-border space-y-0.5 py-0.5">
                    {entry.children.map(c => {
                      const ChildIcon = c.icon;
                      const active = isActiveHref(location, c.href);
                      return (
                        <Link
                          key={c.href}
                          href={c.href}
                          tabIndex={isOpen ? 0 : -1}
                          aria-hidden={!isOpen}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                            active
                              ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/90 text-sidebar-primary-foreground shadow-sm shadow-primary/20"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          )}
                        >
                          <ChildIcon className="w-3.5 h-3.5 flex-shrink-0" />
                          {c.label}
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

      <div className="px-3 py-4 border-t border-sidebar-border space-y-0.5">
        <NotificationDropdown />
        <Link href="/settings/general" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        {user?.isSuperAdmin && (
          <>
            <Link href="/admin" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
              <ShieldCheck className="w-4 h-4" />
              Admin Panel
            </Link>
            <Link href="/admin/leads" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
              <Inbox className="w-4 h-4" />
              <span className="flex-1">Marketing Leads</span>
              {newLeadsCount > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center bg-orange-500 text-white" data-testid="badge-new-leads">
                  {newLeadsCount}
                </span>
              )}
            </Link>
            <Link href="/admin/blog" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
              <FileText className="w-4 h-4" />
              Blog Posts
            </Link>
            <Link href="/admin/support" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
              <LifeBuoy className="w-4 h-4" />
              Support Tickets
            </Link>
            <Link href="/admin/api-settings" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
              <Settings className="w-4 h-4" />
              API & Webhooks
            </Link>
            <Link href="/admin/settings" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
              <Settings className="w-4 h-4" />
              App Settings
            </Link>
            <Link href="/admin/addons" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
              <Package className="w-4 h-4" />
              Add-on Marketplace
            </Link>
          </>
        )}

        <div className="mt-2 pt-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sidebar-foreground font-medium truncate text-sm">{user?.name ?? "—"}</p>
              <p className="text-xs text-muted-foreground capitalize truncate">{user?.role ?? ""}</p>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors flex-shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
