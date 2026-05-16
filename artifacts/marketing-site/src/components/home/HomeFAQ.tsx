import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS = [
  { q: "How long does onboarding take?", a: "Most single outlets go live in under a week — menu setup, hardware configuration, staff training and live support on your first service are all included." },
  { q: "Does Khana Lagao work offline?", a: "Yes. Billing, KOTs and prints keep working during internet outages and sync automatically once you're back online." },
  { q: "Can I run multiple outlets and a franchise?", a: "Absolutely. Higher plans support unlimited outlets with central menu, branch pricing, royalty calculation, brand compliance and roll-up reporting." },
  { q: "Do you support Zomato, Swiggy and my own ordering app?", a: "Yes. All aggregators land in one unified order inbox with menu sync, reconciliation and a single KDS workflow." },
  { q: "How does Khana AI work and is it included?", a: "Khana AI is built into the platform from day one. It learns from your sales, KOTs, reviews and inventory to suggest pricing, prep quantities, campaigns and review replies." },
  { q: "Can I keep my existing hardware?", a: "Most thermal printers, KOT printers, cash drawers and barcode scanners work out of the box. Our team validates your setup before go-live." },
  { q: "How is my data secured?", a: "Encrypted in transit and at rest, role-based access, audit logs, daily backups and India-hosted data with regular third-party security reviews." },
  { q: "Can I migrate from my current POS?", a: "Yes. We migrate menu, customers, vendors and historic sales from common POS systems as part of onboarding." },
  { q: "What if I need help during a busy service?", a: "Chat and phone support are available across all plans, with priority queues and dedicated success managers on higher plans." },
  { q: "Is there a free trial?", a: "Yes — 14 days, no credit card required. You can also book a guided demo to see the platform on your own menu." },
];

export function HomeFAQ() {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4 md:px-6 max-w-3xl">
        <div className="text-center mb-12">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary mb-4">
            FAQ
          </div>
          <h2 className="font-serif text-3xl md:text-5xl font-bold mb-5">
            Questions, answered.
          </h2>
          <p className="text-lg text-muted-foreground">Still curious? Book a demo and we'll walk you through it on your own menu.</p>
        </div>
        <Accordion type="single" collapsible className="rounded-xl border border-border bg-card divide-y divide-border">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="border-0 px-5">
              <AccordionTrigger className="text-left text-base font-semibold py-5 hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed text-sm pb-5">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
