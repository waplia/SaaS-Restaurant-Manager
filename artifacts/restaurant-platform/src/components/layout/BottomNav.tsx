import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Monitor, ShoppingCart, ChefHat, Table2, Menu as MenuIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "./Sidebar";

const STAFF_ROLES = new Set(["cashier", "waiter", "kitchen", "delivery_executive", "counter_staff", "staff"]);

const ITEMS = [
  { href: "/pos", label: "POS", icon: Monitor },
  { href: "/orders", label: "Orders", icon: ShoppingCart },
  { href: "/kitchen", label: "Kitchen", icon: ChefHat },
  { href: "/tables", label: "Tables", icon: Table2 },
];

export function BottomNav() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!user || user.isSuperAdmin) return null;
  if (!user.role || !STAFF_ROLES.has(user.role)) return null;

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border shadow-lg flex items-stretch h-14"
        data-testid="bottom-nav"
      >
        {ITEMS.map(it => {
          const Icon = it.icon;
          const active = location === it.href || location.startsWith(it.href + "/");
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-5 h-5" />
              {it.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          data-testid="bottom-nav-more"
        >
          <MenuIcon className="w-5 h-5" />
          More
        </button>
      </nav>

      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-72 max-w-[85vw] h-full bg-sidebar shadow-xl overflow-y-auto">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute top-3 right-3 z-10 w-8 h-8 rounded-md flex items-center justify-center bg-sidebar-accent text-sidebar-foreground"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
