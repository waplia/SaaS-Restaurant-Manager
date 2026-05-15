import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="bg-foreground text-background py-16">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 lg:gap-8">
          <div className="space-y-4 md:col-span-1">
            <span className="font-serif text-2xl font-bold tracking-tight text-primary">TableTrack</span>
            <p className="text-sm text-muted opacity-80 leading-relaxed max-w-xs">
              The operating system for modern restaurants. Built for owners who treat their kitchen like a craft and their numbers like a sport.
            </p>
          </div>
          
          <div className="space-y-4">
            <h4 className="font-medium text-lg">Product</h4>
            <ul className="space-y-2 text-sm opacity-80">
              <li><Link href="/pos-billing" className="hover:text-primary transition-colors">POS & Billing</Link></li>
              <li><Link href="/qr-menu" className="hover:text-primary transition-colors">QR Menu</Link></li>
              <li><Link href="/online-ordering" className="hover:text-primary transition-colors">Online Ordering</Link></li>
              <li><Link href="/inventory-management" className="hover:text-primary transition-colors">Inventory</Link></li>
              <li><Link href="/payroll" className="hover:text-primary transition-colors">Payroll</Link></li>
              <li><Link href="/reports" className="hover:text-primary transition-colors">Reports</Link></li>
              <li><Link href="/multi-outlet" className="hover:text-primary transition-colors">Multi-Outlet</Link></li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h4 className="font-medium text-lg">Company</h4>
            <ul className="space-y-2 text-sm opacity-80">
              <li><Link href="/about" className="hover:text-primary transition-colors">About Us</Link></li>
              <li><Link href="/pricing" className="hover:text-primary transition-colors">Pricing</Link></li>
              <li><Link href="/blog" className="hover:text-primary transition-colors">Blog</Link></li>
              <li><Link href="/contact" className="hover:text-primary transition-colors">Contact</Link></li>
              <li><Link href="/security" className="hover:text-primary transition-colors">Security</Link></li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h4 className="font-medium text-lg">Compare</h4>
            <ul className="space-y-2 text-sm opacity-80">
              <li><Link href="/restaurant-types/restaurants" className="hover:text-primary transition-colors">For Restaurants</Link></li>
              <li><Link href="/restaurant-types/cafes" className="hover:text-primary transition-colors">For Cafes</Link></li>
              <li><Link href="/restaurant-types/cloud-kitchens" className="hover:text-primary transition-colors">For Cloud Kitchens</Link></li>
              <li><Link href="/restaurant-types/bakeries" className="hover:text-primary transition-colors">For Bakeries</Link></li>
              <li><Link href="/restaurant-types/bars-pubs" className="hover:text-primary transition-colors">For Bars & Pubs</Link></li>
              <li><Link href="/restaurant-types/hotels" className="hover:text-primary transition-colors">For Hotels</Link></li>
              <li><Link href="/restaurant-types/food-courts" className="hover:text-primary transition-colors">For Food Courts</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4 text-sm opacity-60">
          <p>© {new Date().getFullYear()} TableTrack. All rights reserved.</p>
          <div className="flex gap-4">
            <a href="#" className="hover:text-primary transition-colors">Twitter</a>
            <a href="#" className="hover:text-primary transition-colors">LinkedIn</a>
            <a href="#" className="hover:text-primary transition-colors">Instagram</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
