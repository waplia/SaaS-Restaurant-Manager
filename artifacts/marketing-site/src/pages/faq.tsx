import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { FAQSection, type FAQ } from "@/components/shared/FAQSection";
import { useSeo } from "@/lib/seo";

const GENERAL: FAQ[] = [
  { q: "What is KhanaLagao?", a: "KhanaLagao is a complete restaurant operating system by Waplia Digital Solutions. It combines POS, QR menu, kitchen display, inventory, staff & payroll, finance, growth and Khana AI into one connected platform." },
  { q: "What kinds of businesses use it?", a: "Restaurants, cafes, cloud kitchens, bakeries, hotels with F&B, food courts, tiffin services, catering & banquets, franchise chains and corporate canteens." },
  { q: "Where is KhanaLagao based?", a: "We're based in Malviya Nagar, Jaipur, Rajasthan, India. Our team supports customers across India in English and Hindi." },
  { q: "Do I need to be technical to use it?", a: "No. The product is built for working operators. Setup takes a day or two with help from our onboarding team — including menu, hardware and staff training." },
];

const PRICING: FAQ[] = [
  { q: "How much does KhanaLagao cost?", a: "Pricing depends on the modules and number of outlets. Visit the Pricing page or book a demo for an exact quote." },
  { q: "Is there a free trial?", a: "Yes — we offer a guided trial on a test outlet so you can see the platform working with your real menu and workflows." },
  { q: "Can I cancel anytime?", a: "Yes. Subscriptions are cancellable at any time. You keep access until the end of the paid period. See our Refund Policy for details." },
  { q: "Do you offer enterprise pricing?", a: "Yes. For 20+ outlets, hotels and franchise chains, we offer custom plans with dedicated support. Email sales@khanalagao.com." },
];

const PRODUCT: FAQ[] = [
  { q: "Does it work offline?", a: "Yes. The POS continues to take orders, print KOTs and bills even when the internet is down. Everything syncs when you reconnect." },
  { q: "Does it integrate with aggregators?", a: "Yes. We integrate with major aggregators so orders flow into a single feed, KDS and reports." },
  { q: "Can I use my existing printers and hardware?", a: "Most standard thermal printers, scanners and cash drawers work out of the box. Our Marketplace also sells certified KhanaLagao-ready hardware." },
  { q: "How does Khana AI work?", a: "Khana AI lives inside the platform — for menu import, review replies, campaigns, sales insights and forecasting. You pay per use with AI Credits." },
];

const DATA: FAQ[] = [
  { q: "Where is my data stored?", a: "Your data is hosted on secure cloud infrastructure primarily in India, with strong encryption in transit and at rest." },
  { q: "Who owns my data?", a: "You do. We never sell your data, and we don't train AI models on your operational data. See our Privacy Policy and DPA." },
  { q: "What happens if I leave?", a: "You can export your data at any time. On termination we delete or return your data per our DPA, subject to legal retention requirements." },
];

const ALL_FAQS: FAQ[] = [...GENERAL, ...PRICING, ...PRODUCT, ...DATA];
const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: ALL_FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function FAQ() {
  useSeo({
    title: "FAQ — KhanaLagao",
    description: "Frequently asked questions about KhanaLagao — pricing, product, integrations, data, security and support.",
    schema: FAQ_SCHEMA,
  });
  return (
    <SiteLayout>
      <section className="pt-20 md:pt-28 pb-10">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl text-center">
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-5">Frequently asked questions</h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">Quick, honest answers to the questions operators ask us most.</p>
        </div>
      </section>

      <FAQSection title="General" faqs={GENERAL} />
      <FAQSection title="Pricing & plans" faqs={PRICING} />
      <FAQSection title="Product & integrations" faqs={PRODUCT} />
      <FAQSection title="Data, security & exit" faqs={DATA} />

      <CTASection title="Still have a question?" subtitle="Talk to our team — usually 1 business day reply." />
    </SiteLayout>
  );
}
