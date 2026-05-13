import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, ShoppingCart, ChefHat, UtensilsCrossed,
  Package, Users, UserCheck, BarChart3, Table2, Settings,
  Flame, Sun, Moon, LogOut, ShieldCheck, Monitor, Receipt, Wallet, AlertCircle,
  ChevronDown, Coins, TrendingUp, Percent, Truck, Banknote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { NotificationDropdown } from "./NotificationDropdown";

type IconType = typeof LayoutDashboard;
type LinkItem = { kind: "link"; href: string; label: string; icon: IconType; roles?: string[] };
type GroupItem = { kind: "group"; key: string; label: string; icon: IconType; children: LinkItem[] };
type NavEntry = LinkItem | GroupItem;

const navConfig: NavEntry[] = [
  { kind: "link", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { kind: "link", href: "/pos", label: "POS Terminal", icon: Monitor },
  { kind: "link", href: "/orders", label: "Orders", icon: ShoppingCart },
  { kind: "link", href: "/kitchen", label: "Kitchen", icon: ChefHat },
  { kind: "link", href: "/tables", label: "Tables", icon: Table2 },
  { kind: "link", href: "/menu", label: "Menu", icon: UtensilsCrossed },
  { kind: "link", href: "/inventory", label: "Inventory", icon: Package },
  { kind: "link", href: "/staff", label: "Staff", icon: UserCheck },
  { kind: "link", href: "/customers", label: "Customers", icon: Users },
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
      { kind: "link", href: "/payments", label: "Payments", icon: Wallet, roles: ["owner", "manager"] },
      { kind: "link", href: "/due-payments", label: "Due Payments", icon: AlertCircle, roles: ["owner", "manager"] },
      { kind: "link", href: "/expenses", label: "Expenses", icon: Receipt, roles: ["owner", "manager", "super_admin"] },
    ],
  },
  {
    kind: "group", key: "reports", label: "Reports", icon: BarChart3,
    children: [
      { kind: "link", href: "/reports/sales", label: "Sales", icon: TrendingUp },
      { kind: "link", href: "/reports/tax", label: "Tax", icon: Percent },
      { kind: "link", href: "/reports/staff", label: "Staff", icon: Users },
      { kind: "link", href: "/reports/payments", label: "Payments", icon: Wallet },
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

  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  const canSee = (item: LinkItem) => {
    if (!item.roles) return true;
    if (user?.isSuperAdmin) return true;
    return user?.role ? item.roles.includes(user.role) : false;
  };

  // Filter children inside groups by role; drop groups that have no visible children.
  const visibleEntries: NavEntry[] = useMemo(() => {
    const out: NavEntry[] = [];
    for (const e of navConfig) {
      if (e.kind === "link") {
        if (canSee(e)) out.push(e);
      } else {
        const visibleChildren = e.children.filter(canSee);
        if (visibleChildren.length > 0) out.push({ ...e, children: visibleChildren });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.isSuperAdmin]);

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
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
          <Flame className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sidebar-foreground leading-tight">TableTrack</p>
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
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {entry.label}
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
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left">{entry.label}</span>
                <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isOpen ? "rotate-0" : "-rotate-90")} />
              </button>
              <div
                id={panelId}
                aria-hidden={!isOpen}
                className={cn(
                  "grid transition-all duration-200 ease-out",
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
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                            active
                              ? "bg-sidebar-primary text-sidebar-primary-foreground"
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
        <Link href="/settings" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        {user?.isSuperAdmin && (
          <Link href="/admin" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
            <ShieldCheck className="w-4 h-4" />
            Admin Panel
          </Link>
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
