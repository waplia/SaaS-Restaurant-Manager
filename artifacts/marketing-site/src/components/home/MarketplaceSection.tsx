import { Link } from "wouter";
import {
  Store, Cpu, Calculator, CreditCard, MessageSquare, Truck, Puzzle, ArrowRight,
} from "lucide-react";

const ITEMS = [
  { icon: Store, title: "Vendor marketplace", desc: "Pre-vetted suppliers for ingredients, packaging and consumables." },
  { icon: Cpu, title: "Hardware", desc: "Printers, KOT displays, scanners, weighing scales — plug & play." },
  { icon: Calculator, title: "Accounting", desc: "Tally, Zoho Books, QuickBooks sync — no double entry." },
  { icon: CreditCard, title: "Payment gateways", desc: "UPI, Razorpay, Cashfree, Stripe, PhonePe, Paytm." },
  { icon: MessageSquare, title: "SMS · WhatsApp · Email", desc: "Bring your own gateway or use the bundled provider." },
  { icon: Truck, title: "Delivery", desc: "Zomato, Swiggy, Dunzo, Porter and in-house riders unified." },
  { icon: Puzzle, title: "Add-ons", desc: "Open API and webhooks — extend the platform your way." },
];

export function MarketplaceSection() {
  return (
    <section className="py-24 bg-card">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-4">
            Marketplace
          </div>
          <h2 className="font-serif text-3xl md:text-5xl font-bold mb-5">
            Everything you need to run the restaurant — in one marketplace.
          </h2>
          <p className="text-lg text-muted-foreground">
            Don't waste weeks integrating with vendors. We've already done it.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ITEMS.map(({ icon: Icon, title, desc }) => (
            <Link key={title} href="/integrations">
              <div className="group h-full p-5 rounded-xl border border-border bg-background hover:border-primary/40 hover:shadow-md transition-all">
                <div className="mb-3 inline-flex p-2 rounded-lg bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-semibold mb-1.5 text-sm">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mb-2">{desc}</p>
                <div className="flex items-center text-xs font-medium text-primary opacity-70 group-hover:opacity-100">
                  Browse <ArrowRight className="ml-1 h-3 w-3" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
