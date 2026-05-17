import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAppSettings } from "@/lib/appSettings";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Menu, X, ChevronDown, ChevronRight } from "lucide-react";
import { MAIN_MENUS, type MegaMenu, type NavLink, type NavGroup } from "@/lib/navigation";

const HOVER_OPEN_DELAY = 90;
const HOVER_CLOSE_DELAY = 180;

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [location] = useLocation();
  const settings = useAppSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

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

  const clearTimers = useCallback(() => {
    if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  const scheduleOpen = useCallback((label: string) => {
    clearTimers();
    openTimer.current = window.setTimeout(() => setOpenMenu(label), HOVER_OPEN_DELAY);
  }, [clearTimers]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setOpenMenu(null), HOVER_CLOSE_DELAY);
  }, [clearTimers]);

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
              ? <img src={settings.logoUrl} alt="KhanaLagao" className="h-7 w-auto" />
              : <span className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-orange-500 flex items-center justify-center text-white font-bold">K</span>}
            <span className="font-serif text-xl font-bold tracking-tight text-foreground">{settings.appName}</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-0.5" onMouseLeave={scheduleClose}>
            {MAIN_MENUS.map((menu) => (
              <MenuTrigger
                key={menu.label}
                menu={menu}
                open={openMenu === menu.label}
                onHoverOpen={() => scheduleOpen(menu.label)}
                onHoverHold={clearTimers}
                onHoverClose={scheduleClose}
                onClick={() => {
                  clearTimers();
                  setOpenMenu(openMenu === menu.label ? null : menu.label);
                }}
                onPanelClose={() => { clearTimers(); setOpenMenu(null); }}
                active={menu.href ? location === menu.href || location.startsWith(menu.href + "/") : false}
              />
            ))}
            <Link
              href="/pricing"
              className={`text-sm font-medium px-3 py-2 rounded-md transition-colors ${
                location === "/pricing" ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground"
              }`}
            >
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
          <a href="/app/register">
            <Button size="sm" data-testid="btn-start-trial">Start Free Trial</Button>
          </a>
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
  menu, open, onHoverOpen, onHoverHold, onHoverClose, onClick, onPanelClose, active,
}: {
  menu: MegaMenu;
  open: boolean;
  onHoverOpen: () => void;
  onHoverHold: () => void;
  onHoverClose: () => void;
  onClick: () => void;
  onPanelClose: () => void;
  active: boolean;
}) {
  return (
    <div
      className="relative"
      onMouseEnter={onHoverOpen}
      onMouseLeave={onHoverClose}
    >
      <button
        onClick={onClick}
        className={`flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-md transition-colors ${
          active || open ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground"
        }`}
        data-testid={`menu-trigger-${menu.label.toLowerCase().replace(/\s+/g, "-")}`}
        aria-expanded={open}
      >
        {menu.label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.14 }}
            className="absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50"
            onMouseEnter={onHoverHold}
            onMouseLeave={onHoverClose}
          >
            {menu.groups
              ? <MegaPanelGrouped menu={menu} onClose={onPanelClose} />
              : <MegaPanelLinks menu={menu} onClose={onPanelClose} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PanelShell({ children, footer, width = "min-w-[520px] max-w-[680px]" }: { children: React.ReactNode; footer?: MegaMenu["footer"]; width?: string }) {
  return (
    <div className={`bg-popover border border-border rounded-xl shadow-2xl overflow-hidden ${width}`}>
      <div className="p-4">{children}</div>
      {footer && (
        <Link
          href={footer.href}
          className="flex items-center justify-center gap-1 py-2.5 text-xs font-semibold text-primary bg-primary/5 border-t border-border hover:bg-primary/10 transition-colors"
        >
          {footer.label}
        </Link>
      )}
    </div>
  );
}

function MegaPanelLinks({ menu, onClose }: { menu: MegaMenu; onClose: () => void }) {
  const links = menu.links ?? [];
  const cols = links.length > 6 ? 2 : 1;
  return (
    <PanelShell footer={menu.footer} width={cols === 2 ? "min-w-[560px] max-w-[640px]" : "min-w-[300px] max-w-[360px]"}>
      <div className={`grid ${cols === 2 ? "grid-cols-2" : "grid-cols-1"} gap-0.5`}>
        {links.map((l) => <LinkCard key={l.href} link={l} onClick={onClose} />)}
      </div>
    </PanelShell>
  );
}

function MegaPanelGrouped({ menu, onClose }: { menu: MegaMenu; onClose: () => void }) {
  const groups = menu.groups ?? [];
  const cols = Math.min(4, groups.length);
  const colsCls = cols === 4 ? "md:grid-cols-4" : cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return (
    <PanelShell footer={menu.footer} width="min-w-[640px] max-w-[860px]">
      <div className={`grid grid-cols-2 ${colsCls} gap-x-5 gap-y-4`}>
        {groups.map((g) => <GroupColumn key={g.title} group={g} onClose={onClose} />)}
      </div>
    </PanelShell>
  );
}

function GroupColumn({ group, onClose }: { group: NavGroup; onClose: () => void }) {
  const titleHref = group.anchor ? `/features#${group.anchor}` : undefined;
  return (
    <div>
      {titleHref ? (
        <Link
          href={titleHref}
          onClick={onClose}
          className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary mb-2 transition-colors"
        >
          {group.title}
        </Link>
      ) : (
        <h5 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{group.title}</h5>
      )}
      <ul className="space-y-0.5">
        {group.links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              onClick={onClose}
              className="block text-sm py-1 px-2 -mx-2 rounded-md text-foreground/80 hover:text-foreground hover:bg-accent transition-colors"
            >
              {l.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LinkCard({ link, onClick }: { link: NavLink; onClick: () => void }) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      onClick={onClick}
      className="flex items-start gap-3 rounded-lg p-2.5 hover:bg-accent transition-colors group"
    >
      {Icon && (
        <span className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-tight">{link.title}</div>
        {link.desc && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{link.desc}</p>}
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
                            {g.anchor ? (
                              <Link
                                href={`/features#${g.anchor}`}
                                onClick={onClose}
                                className="block text-[10px] uppercase font-bold tracking-widest text-primary py-1.5"
                              >
                                {g.title}
                              </Link>
                            ) : (
                              <div className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground py-1.5">{g.title}</div>
                            )}
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
                    {menu.footer && (
                      <Link
                        href={menu.footer.href}
                        onClick={onClose}
                        className="flex items-center gap-1 py-2 text-xs font-semibold text-primary"
                      >
                        {menu.footer.label} <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
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
          <a href="/app/register" onClick={onClose}>
            <Button className="w-full justify-center">Start Free Trial</Button>
          </a>
        </div>
      </div>
    </motion.div>
  );
}
