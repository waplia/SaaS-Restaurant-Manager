import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { HelpCircle } from "lucide-react";

export interface FAQ { q: string; a: string }

export function FAQSection({ title = "Frequently asked questions", subtitle, faqs }: { title?: string; subtitle?: string; faqs: FAQ[] }) {
  return (
    <section className="py-20 md:py-24">
      <div className="container mx-auto px-4 md:px-6 max-w-3xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-4">
            <HelpCircle className="h-5 w-5" />
          </div>
          <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-3">{title}</h2>
          {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
        </div>
        <Accordion type="single" collapsible className="space-y-3">
          {faqs.map((f, i) => (
            <AccordionItem key={i} value={`q-${i}`} className="border border-border bg-card rounded-xl px-5 data-[state=open]:border-primary/40">
              <AccordionTrigger className="text-left font-semibold hover:no-underline py-5">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed pb-5">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
