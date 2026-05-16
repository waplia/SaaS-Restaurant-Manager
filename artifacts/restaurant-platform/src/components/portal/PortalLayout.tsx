import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Clock, CalendarDays, Wallet, ListChecks, GraduationCap,
  Megaphone, TrendingUp, Award, Folder, LifeBuoy, LogOut, Sun, Moon, Flame,
  ArrowLeftRight, Lock,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useAppSettings } from "@/lib/appSettings";
import { cn } from "@/lib/utils";

type IconType = typeof LayoutDashboard;

const NAV: Array<{ href: string; label: string; short: string; icon: IconType }> = [
  { href: "/portal", label: "Home", short: "Home", icon: LayoutDashboard },
  { href: "/portal/attendance", label: "Attendance", short: "Punch", icon: Clock },
  { href: "/portal/shifts", label: "My Shifts", short: "Shifts", icon: CalendarDays },
  { href: "/portal/leaves", label: "Leaves", short: "Leaves", icon: ArrowLeftRight },
  { href: "/portal/payroll", label: "Payroll", short: "Pay", icon: Wallet },
  { href: "/portal/tasks", label: "Tasks", short: "Tasks", icon: ListChecks },
  { href: "/portal/training", label: "Training", short: "Train", icon: GraduationCap },
  { href: "/portal/announcements", label: "Announcements", short: "News", icon: Megaphone },
  { href: "/portal/scorecard", label: "Performance", short: "Score", icon: TrendingUp },
  { href: "/portal/incentives", label: "Incentives", short: "Bonus", icon: Award },
  { href: "/portal/documents", label: "Documents", short: "Docs", icon: Folder },
  { href: "/portal/help", label: "Help", short: "Help", icon: LifeBuoy },
];

const MOBILE_BAR: typeof NAV = [
  NAV[0], NAV[1], NAV[2], NAV[5], NAV[7],
];

function isActive(loc: string, href: string) {
  if (href === "/portal") return loc === "/portal" || loc === "/portal/";
  return loc.startsWith(href);
}

export function PortalLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const appSettings = useAppSettings();
  const isPriv = user?.isSuperAdmin || ["owner", "manager"].includes(user?.role ?? "");

  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-background" data-testid="portal-layout">
      {/* Desktop side nav */}
      <aside className="hidden md:flex flex-col w-60 min-h-screen bg-sidebar border-r border-sidebar-border">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          {appSettings.logoUrl ? (
            <img src={appSettings.logoUrl} alt={appSettings.appName} className="w-9 h-9 rounded-xl object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
              <Flame className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sidebar-foreground leading-tight">Staff Portal</p>
            <p className="text-xs text-muted-foreground truncate">{user?.name ?? "—"}</p>
          </div>
          <button onClick={toggleTheme} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map(n => {
            const Icon = n.icon;
            const active = isActive(location, n.href);
            return (
              <Link key={n.href} href={n.href} data-testid={`portal-nav-${n.href.split("/").pop()}`}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                  active
                    ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/90 text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}>
                <Icon className="w-4 h-4 flex-shrink-0" /><span>{n.label}</span>
              </Link>
            );
          })}
          <div className="mt-3 pt-3 border-t border-sidebar-border space-y-0.5">
            <Link href="/settings/account" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent" data-testid="portal-nav-account">
              <Lock className="w-4 h-4" />Change password
            </Link>
            {isPriv && (
              <Link href="/dashboard" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent">
                <LayoutDashboard className="w-4 h-4" />Switch to Admin
              </Link>
            )}
          </div>
        </nav>

        <div className="px-3 py-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">{initials}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sidebar-foreground font-medium text-sm truncate">{user?.name ?? "—"}</p>
              <p className="text-xs text-muted-foreground capitalize truncate">{user?.role}</p>
            </div>
            <button onClick={logout} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10" data-testid="portal-logout">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card sticky top-0 z-30">
        <div className="flex items-center gap-2">
          {appSettings.logoUrl ? (
            <img src={appSettings.logoUrl} alt="" className="w-7 h-7 rounded-md object-cover" />
          ) : (
            <Flame className="w-6 h-6 text-primary" />
          )}
          <div>
            <p className="text-sm font-bold leading-tight">Staff Portal</p>
            <p className="text-[10px] text-muted-foreground capitalize leading-tight">{user?.name} · {user?.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={logout} className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10" data-testid="portal-logout-mobile">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 pb-20 md:pb-6 overflow-auto">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-30 grid grid-cols-5">
        {MOBILE_BAR.map(n => {
          const Icon = n.icon;
          const active = isActive(location, n.href);
          return (
            <Link key={n.href} href={n.href} className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium",
              active ? "text-primary" : "text-muted-foreground",
            )} data-testid={`portal-mobile-nav-${n.href.split("/").pop()}`}>
              <Icon className={cn("w-5 h-5", active && "fill-primary/10")} />
              {n.short}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
