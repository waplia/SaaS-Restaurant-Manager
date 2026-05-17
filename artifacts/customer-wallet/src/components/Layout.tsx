import { Link, useLocation } from "wouter";
import { Wallet, Receipt, Gift, Globe2, User, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface Tab { to: string; label: string; icon: LucideIcon; }
const TABS: Tab[] = [
  { to: "/", label: "Wallet", icon: Wallet },
  { to: "/visits", label: "Visits", icon: Receipt },
  { to: "/rewards", label: "Rewards", icon: Gift },
  { to: "/network", label: "Network", icon: Globe2 },
  { to: "/profile", label: "Profile", icon: User },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const isActive = (to: string) => to === "/" ? location === "/" : location.startsWith(to);

  return (
    <div className="min-h-screen flex flex-col bg-[rgb(var(--bg))]">
      <main className="flex-1 pb-24">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-[rgb(var(--border))] bg-white/95 backdrop-blur">
        <div className="container-app">
          <ul className="grid grid-cols-5">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = isActive(t.to);
              return (
                <li key={t.to}>
                  <Link href={t.to}
                    className={`flex flex-col items-center gap-1 py-3 text-xs ${active ? "text-[rgb(var(--primary))]" : "text-zinc-500"}`}
                    data-testid={`tab-${t.label.toLowerCase()}`}>
                    <Icon size={20} strokeWidth={active ? 2.3 : 1.8} />
                    <span>{t.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </div>
  );
}

export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header className="container-app pt-8 pb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}
