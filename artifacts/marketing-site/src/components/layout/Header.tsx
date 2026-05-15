import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Menu, X, ChevronDown } from "lucide-react";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuLink,
} from "@/components/ui/navigation-menu";

const FEATURES = [
  { title: "POS & Billing", href: "/pos-billing", desc: "Fast, reliable point of sale." },
  { title: "QR Menu Ordering", href: "/qr-menu", desc: "Contactless dining experience." },
  { title: "Online Ordering", href: "/online-ordering", desc: "Direct delivery & takeout." },
  { title: "Inventory", href: "/inventory-management", desc: "Real-time stock tracking." },
  { title: "Staff & Payroll", href: "/payroll", desc: "Manage shifts and wages." },
  { title: "Reports", href: "/reports", desc: "Actionable business insights." },
  { title: "Multi-Outlet", href: "/multi-outlet", desc: "Scale across locations." },
];

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2" data-testid="link-home">
            <span className="font-serif text-xl font-bold tracking-tight text-primary">TableTrack</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <NavigationMenu>
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="bg-transparent">Features</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px] bg-card">
                      {FEATURES.map((feat) => (
                        <li key={feat.title}>
                          <NavigationMenuLink asChild>
                            <Link
                              href={feat.href}
                              className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                            >
                              <div className="text-sm font-medium leading-none">{feat.title}</div>
                              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground mt-1">
                                {feat.desc}
                              </p>
                            </Link>
                          </NavigationMenuLink>
                        </li>
                      ))}
                      <li className="col-span-full mt-2 border-t pt-2">
                         <NavigationMenuLink asChild>
                            <Link href="/features" className="text-sm text-primary font-medium hover:underline p-2 block">
                              View all features &rarr;
                            </Link>
                         </NavigationMenuLink>
                      </li>
                    </ul>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>

            <Link href="/pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground px-4 py-2 transition-colors">Pricing</Link>
            <Link href="/integrations" className="text-sm font-medium text-muted-foreground hover:text-foreground px-4 py-2 transition-colors">Integrations</Link>
            <Link href="/blog" className="text-sm font-medium text-muted-foreground hover:text-foreground px-4 py-2 transition-colors">Blog</Link>
          </nav>
        </div>

        <div className="hidden md:flex items-center gap-4">
          <a href="/app/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" data-testid="link-login">
            Sign in
          </a>
          <Link href="/book-demo">
            <Button variant="outline" className="hidden lg:inline-flex" data-testid="btn-book-demo">
              Book a demo
            </Button>
          </Link>
          <a href="/app/register">
            <Button data-testid="btn-start-trial">Start free trial</Button>
          </a>
        </div>

        <button
          className="md:hidden p-2 text-foreground"
          onClick={() => setIsOpen(!isOpen)}
          data-testid="btn-mobile-menu"
        >
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-16 left-0 w-full bg-background border-b shadow-lg md:hidden p-4 flex flex-col gap-4"
          >
            <div className="flex flex-col space-y-3">
              <Link href="/features" className="text-lg font-medium" onClick={() => setIsOpen(false)}>Features</Link>
              <Link href="/pricing" className="text-lg font-medium" onClick={() => setIsOpen(false)}>Pricing</Link>
              <Link href="/integrations" className="text-lg font-medium" onClick={() => setIsOpen(false)}>Integrations</Link>
              <Link href="/blog" className="text-lg font-medium" onClick={() => setIsOpen(false)}>Blog</Link>
              <Link href="/about" className="text-lg font-medium" onClick={() => setIsOpen(false)}>About</Link>
            </div>
            <div className="h-px bg-border my-2" />
            <div className="flex flex-col gap-3">
              <a href="/app/login" className="text-lg font-medium" onClick={() => setIsOpen(false)}>Sign in</a>
              <Link href="/book-demo" onClick={() => setIsOpen(false)}>
                <Button variant="outline" className="w-full justify-center">Book a demo</Button>
              </Link>
              <a href="/app/register" onClick={() => setIsOpen(false)}>
                <Button className="w-full justify-center">Start free trial</Button>
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
