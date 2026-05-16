import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAppSettings } from "@/lib/appSettings";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Menu, X, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { MAIN_MENUS, type MegaMenu, type NavLink } from "@/lib/navigation";

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [location] = useLocation();
  const settings = useAppSettings();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setMobileOpen(false); setOpenMenu(null); }, [location]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b transition-all ${
        scrolled ? "border-border/60 bg-background/85 backdrop-blur-xl shadow-sm" : "border-transparent bg-background/60 backdrop-blur-md"
      }`}
      data-testid="site-header"
    >
      <div ref={containerRef} className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6 lg:gap-8">
          <Link href="/" className="flex items-center gap-2 shrink-0" data-testid="link-home">
            {settings.logoUrl
              ? <img src={settings.logoUrl} alt={settings.appName} className="h-7 w-auto" />
              : <span className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-orange-500 flex items-center justify-center text-white font-bold">K</span>}
            <span className="font-serif text-xl font-bold tracking-tight text-foreground">{settings.appName}</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {MAIN_MENUS.map((menu) => (
              <MenuTrigger
                key={menu.label}
                menu={menu}
                open={openMenu === menu.label}
                onToggle={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
                onClose={() => setOpenMenu(null)}
                active={menu.href ? location === menu.href || location.startsWith(menu.href + "/") : false}
              />
            ))}
            <Link href="/pricing" className={`text-sm font-medium px-3 py-2 rounded-md transition-colors ${location === "/pricing" ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground"}`}>
              Pricing
            </Link>
          </nav>
        </div>

        <div className="hidden lg:flex items-center gap-2">
          <a href="/app/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-2" data-testid="link-login">
            Login
          </a>
          <Link href="/book-demo">
            <Button variant="outline" size="sm" data-testid="btn-book-demo">Book Demo</Button>
          </Link>
          <Link href="/start-free-trial">
            <Button size="sm" data-testid="btn-start-trial">Start Free Trial</Button>
          </Link>
        </div>

        <button
          className="lg:hidden p-2 text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
          data-testid="btn-mobile-menu"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen && <MobileMenu onClose={() => setMobileOpen(false)} />}
      </AnimatePresence>
    </header>
  );
}

function MenuTrigger({
  menu, open, onToggle, onClose, active,
}: { menu: MegaMenu; open: boolean; onToggle: () => void; onClose: () => void; active: boolean }) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-md transition-colors ${
          active || open ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground"
        }`}
        data-testid={`menu-trigger-${menu.label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {menu.label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50"
          >
            {menu.groups ? (
              <MegaPanelGrouped menu={menu} onClose={onClose} />
            ) : (
              <MegaPanelLinks menu={menu} onClose={onClose} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MegaPanelLinks({ menu, onClose }: { menu: MegaMenu; onClose: () => void }) {
  const links = menu.links ?? [];
  const cols = links.length > 8 ? 3 : 2;
  return (
    <div className={`bg-popover border border-border rounded-xl shadow-2xl overflow-hidden flex ${menu.promo ? "min-w-[760px]" : "min-w-[560px]"}`}>
      <div className={`grid grid-cols-${cols} gap-1 p-4 flex-1`}>
        {links.map((l) => <LinkCard key={l.href} link={l} onClick={onClose} />)}
      </div>
      {menu.promo && (
        <div className="w-[280px] bg-gradient-to-br from-primary/10 via-orange-500/5 to-background border-l border-border p-6 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-semibold mb-3">
              <Sparkles className="h-3 w-3" /> Featured
            </div>
            <h4 className="font-bold text-base mb-1.5">{menu.promo.title}</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">{menu.promo.desc}</p>
          </div>
          <Link href={menu.promo.href} onClick={onClose}>
            <Button size="sm" className="w-full mt-4">{menu.promo.cta}</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function MegaPanelGrouped({ menu, onClose }: { menu: MegaMenu; onClose: () => void }) {
  const groups = menu.groups ?? [];
  return (
    <div className="bg-popover border border-border rounded-xl shadow-2xl overflow-hidden p-5 w-[min(95vw,1100px)]">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-4">
        {groups.map((g) => (
          <div key={g.title}>
            <h5 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5">{g.title}</h5>
            <ul className="space-y-0.5">
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={onClose}
                    className="flex items-center gap-2 text-sm py-1.5 px-2 -mx-2 rounded-md text-foreground/80 hover:text-foreground hover:bg-accent transition-colors"
                  >
                    {l.icon && <l.icon className="h-3.5 w-3.5 text-primary/70" />}
                    <span>{l.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-5 pt-4 border-t border-border flex items-center justify-between text-sm">
        <Link href={menu.href ?? "/features"} onClick={onClose} className="text-primary font-medium hover:underline">
          Browse all {menu.label.toLowerCase()} <ChevronRight className="inline h-3.5 w-3.5 -mt-0.5" />
        </Link>
        <Link href="/book-demo" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          Book a live demo →
        </Link>
      </div>
    </div>
  );
}

function LinkCard({ link, onClick }: { link: NavLink; onClick: () => void }) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      onClick={onClick}
      className="flex items-start gap-3 rounded-lg p-3 hover:bg-accent transition-colors group"
    >
      {Icon && (
        <span className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-tight">{link.title}</div>
        {link.desc && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{link.desc}</p>}
      </div>
    </Link>
  );
}

function MobileMenu({ onClose }: { onClose: () => void }) {
  const [openSection, setOpenSection] = useState<string | null>(null);
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="lg:hidden absolute top-16 left-0 right-0 bg-background border-b border-border shadow-2xl max-h-[calc(100vh-4rem)] overflow-y-auto"
    >
      <div className="container mx-auto px-4 py-4 space-y-1">
        {MAIN_MENUS.map((menu) => (
          <div key={menu.label} className="border-b border-border/60 last:border-0">
            <button
              onClick={() => setOpenSection(openSection === menu.label ? null : menu.label)}
              className="w-full flex items-center justify-between py-3 font-semibold text-sm"
            >
              {menu.label}
              <ChevronDown className={`h-4 w-4 transition-transform ${openSection === menu.label ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {openSection === menu.label && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pb-3 pl-2 space-y-3">
                    {menu.groups
                      ? menu.groups.map((g) => (
                          <div key={g.title}>
                            <div className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground py-1.5">{g.title}</div>
                            <ul className="space-y-0.5">
                              {g.links.map((l) => (
                                <li key={l.href}>
                                  <Link href={l.href} onClick={onClose} className="block py-1.5 text-sm text-foreground/80 hover:text-primary">{l.title}</Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))
                      : (
                          <ul className="space-y-0.5">
                            {(menu.links ?? []).map((l) => (
                              <li key={l.href}>
                                <Link href={l.href} onClick={onClose} className="flex items-center gap-2 py-1.5 text-sm text-foreground/80 hover:text-primary">
                                  {l.icon && <l.icon className="h-3.5 w-3.5 text-primary/70" />} {l.title}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
        <Link href="/pricing" onClick={onClose} className="block py-3 font-semibold text-sm border-b border-border/60">Pricing</Link>

        <div className="pt-4 space-y-2">
          <a href="/app/login" onClick={onClose}>
            <Button variant="ghost" className="w-full justify-center">Login</Button>
          </a>
          <Link href="/book-demo" onClick={onClose}>
            <Button variant="outline" className="w-full justify-center">Book Demo</Button>
          </Link>
          <Link href="/start-free-trial" onClick={onClose}>
            <Button className="w-full justify-center">Start Free Trial</Button>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
