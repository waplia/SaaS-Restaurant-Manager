import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/lib/seo";
import { COMPANY } from "@/lib/company";
import { Sparkles, MapPin, ArrowRight, Heart, Rocket, Users } from "lucide-react";

const ROLES = [
  { team: "Engineering", title: "Senior Full-stack Engineer", location: "Jaipur · On-site / Hybrid" },
  { team: "Engineering", title: "Mobile Engineer (React Native / Expo)", location: "Jaipur · On-site / Hybrid" },
  { team: "Design", title: "Product Designer", location: "Jaipur · On-site / Hybrid" },
  { team: "AI", title: "Applied AI / LLM Engineer", location: "Jaipur · On-site / Hybrid" },
  { team: "Customer Success", title: "Customer Success Manager", location: "Jaipur · On-site" },
  { team: "Sales", title: "Restaurant Solutions Consultant", location: "Pan-India · Field" },
];

const PERKS = [
  { icon: Heart, title: "Work that matters", body: "Help real restaurants run better, every day." },
  { icon: Rocket, title: "Build, ship, learn", body: "Small team, real ownership, fast feedback loops." },
  { icon: Users, title: "Honest culture", body: "Direct feedback, no politics, no fluff." },
];

export default function Careers() {
  useSeo({
    title: `Careers at ${COMPANY.legalName} — build ${COMPANY.product}`,
    description: `Join ${COMPANY.legalName} in ${COMPANY.city}. We're building India's modern restaurant operating system — engineering, design, AI, customer success and sales roles.`,
  });
  return (
    <SiteLayout>
      <section className="pt-20 md:pt-28 pb-12">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> Careers
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-5">
            Build the OS that runs <span className="text-primary">Indian restaurants.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-6">
            We're a small, product-led team in {COMPANY.city}. We hire people who care about craft, customers and shipping things that actually work.
          </p>
          <p className="text-sm text-muted-foreground inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> {COMPANY.fullAddress}</p>
        </div>
      </section>

      <section className="py-12 md:py-16 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-8 text-center">Open roles</h2>
          <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
            {ROLES.map((r) => (
              <div key={r.title} className="grid grid-cols-1 md:grid-cols-[100px_1fr_auto] gap-3 items-center p-5 md:p-6 hover:bg-muted/30 transition-colors">
                <span className="text-xs uppercase tracking-widest font-semibold text-primary">{r.team}</span>
                <div>
                  <p className="font-semibold text-base">{r.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {r.location}</p>
                </div>
                <a href={`mailto:careers@khanalagao.com?subject=Application: ${encodeURIComponent(r.title)}`}>
                  <Button size="sm" variant="outline" className="gap-1.5">Apply <ArrowRight className="h-3.5 w-3.5" /></Button>
                </a>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-6">
            Don't see your role? Write to <a href="mailto:careers@khanalagao.com" className="text-primary font-medium hover:underline">careers@khanalagao.com</a> — we'd love to hear from you.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <div className="text-center mb-10">
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-4">Why work with us</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {PERKS.map((p) => (
              <div key={p.title} className="rounded-2xl border border-border bg-card p-6">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4"><p.icon className="h-5 w-5" /></div>
                <h3 className="font-serif text-xl font-bold mb-2">{p.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CTASection
        title={`Build with ${COMPANY.legalName}.`}
        subtitle={`Send a CV and a paragraph about your favorite project to careers@khanalagao.com.`}
        primary={{ label: "Email careers", href: "mailto:careers@khanalagao.com" }}
        secondary={{ label: "About the company", href: "/about" }}
      />
    </SiteLayout>
  );
}
