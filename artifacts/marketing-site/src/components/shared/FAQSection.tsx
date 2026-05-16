import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { HelpCircle } from "lucide-react";

export interface FAQ { q: string; a: string }

export function FAQSection({ title = "Frequently asked questions", subtitle, faqs }: { title?: string; subtitle?: string; faqs: FAQ[] }) {
  return (
    <section className="py-12 md:py-24">
      <div className="container mx-auto px-4 md:px-6 max-w-3xl">
        <div className="text-center mb-6 md:mb-10">
          <div className="inline-flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/10 text-primary mb-3 md:mb-4">
            <HelpCircle className="h-4 w-4 md:h-5 md:w-5" />
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-2 md:mb-3">{title}</h2>
          {subtitle && <p className="text-sm md:text-base text-muted-foreground">{subtitle}</p>}
        </div>
        <Accordion type="single" collapsible className="space-y-2.5 md:space-y-3">
          {faqs.map((f, i) => (
            <AccordionItem key={i} value={`q-${i}`} className="border border-border bg-card rounded-xl px-4 md:px-5 data-[state=open]:border-primary/40">
              <AccordionTrigger className="text-left font-semibold text-sm md:text-base hover:no-underline py-4 md:py-5">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-4 md:pb-5">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
