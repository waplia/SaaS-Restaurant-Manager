import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, ShoppingCart, ChefHat, UtensilsCrossed,
  Package, Users, UserCheck, BarChart3, Table2, Bell, Settings, Flame, Sun, Moon
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";

interface Notification {
  id: number;
  isRead: boolean;
  [key: string]: unknown;
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "Orders & POS", icon: ShoppingCart },
  { href: "/kitchen", label: "Kitchen", icon: ChefHat },
  { href: "/tables", label: "Tables", icon: Table2 },
  { href: "/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/staff", label: "Staff", icon: UserCheck },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export function Sidebar() {
  const [location] = useLocation();
  const { data: notifications } = useNotifications();
  const { theme, toggleTheme } = useTheme();
  const unread = Array.isArray(notifications)
    ? notifications.filter((n: Notification) => !n.isRead).length
    : 0;

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-sidebar border-r border-sidebar-border">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
          <Flame className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sidebar-foreground leading-tight">TableTrack</p>
          <p className="text-xs text-muted-foreground">Spice Garden</p>
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
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link key={href} href={href} className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-sidebar-border space-y-0.5">
        <Link href="/notifications" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
          <Bell className="w-4 h-4" />
          Notifications
          {unread > 0 && (
            <span className="ml-auto bg-primary text-primary-foreground text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
              {unread}
            </span>
          )}
        </Link>
        <Link href="/settings" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all">
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground mt-2 border-t border-sidebar-border pt-3">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">P</div>
          <div className="flex-1 min-w-0">
            <p className="text-sidebar-foreground font-medium truncate">Priya Sharma</p>
            <p className="text-xs text-muted-foreground truncate">Owner</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
