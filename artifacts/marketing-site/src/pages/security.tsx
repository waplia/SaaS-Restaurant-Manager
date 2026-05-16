import { Link } from "wouter";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { CTASection } from "@/components/shared/CTASection";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/lib/seo";
import { COMPANY } from "@/lib/company";
import {
  Shield, Lock, KeyRound, Database, Users, FileCheck, Server, Eye,
  Activity, ShieldCheck, CloudCog, AlertTriangle, BookLock, Sparkles, ArrowRight, Mail,
} from "lucide-react";

const PILLARS = [
  {
    icon: Lock,
    title: "Encryption in transit & at rest",
    body: "Every byte that leaves your device travels over TLS 1.2+. Every byte that lands in our database is encrypted at rest with AES-256. Backups are encrypted with separate keys.",
  },
  {
    icon: KeyRound,
    title: "Key & secrets protection",
    body: "Production secrets live in a managed secret store with rotation, audit and least-privilege access. No engineer can read customer secrets in plaintext.",
  },
  {
    icon: Users,
    title: "Role-based access control",
    body: "Granular roles for owner, manager, accountant, captain, cashier, kitchen, and outlet staff. Every screen, every action and every report respects the role assigned to the user.",
  },
  {
    icon: Database,
    title: "Outlet & tenant data separation",
    body: "Each restaurant lives in its own logical tenant. Row-level isolation, outlet-level access boundaries, and signed API requests prevent any data leakage across customers.",
  },
  {
    icon: Activity,
    title: "Audit logs you can read",
    body: "Every privileged action — discounts, voids, refunds, settings changes, exports — is captured in an immutable audit log, searchable by user, outlet and time range.",
  },
  {
    icon: Eye,
    title: "Real-time monitoring",
    body: "24×7 application and infrastructure monitoring with on-call alerts. Anomalies, error spikes and suspicious sign-in patterns are flagged automatically.",
  },
];

const CONTROLS = [
  { icon: ShieldCheck, label: "Multi-factor authentication for owners & admins" },
  { icon: KeyRound, label: "Single Sign-On (SSO) on enterprise plans" },
  { icon: Lock, label: "Per-outlet PIN login for staff" },
  { icon: Users, label: "Granular role permissions, customizable by feature" },
  { icon: FileCheck, label: "Exportable audit logs and security events" },
  { icon: AlertTriangle, label: "Session timeouts, device limits and IP allowlists" },
  { icon: Server, label: "Encrypted, region-locked backups with point-in-time recovery" },
  { icon: CloudCog, label: "Disaster-recovery runbook with tested RPO / RTO targets" },
];

const PROGRAM = [
  { title: "Secure development lifecycle", body: "Mandatory code review, automated SAST/dependency scanning, signed releases and short-lived deploy keys." },
  { title: "Vulnerability management", body: "Continuous scanning, prioritized remediation and an internal SLA for critical, high, medium and low findings." },
  { title: "Incident response", body: "On-call rotation, severity playbooks, customer notification timelines and post-incident reviews shared with affected customers." },
  { title: "Vendor due diligence", body: "Every sub-processor we use is reviewed for security, data residency, certifications and contractual safeguards." },
  { title: "Employee security", body: "Background checks, security awareness training, least-privilege production access and mandatory MFA on internal systems." },
  { title: "Customer-side guidance", body: "Owner playbooks for staff onboarding, password hygiene, terminal hardening, and how to spot social-engineering attacks." },
];

export default function Security() {
  useSeo({
    title: "Security at KhanaLagao — protecting your restaurant's data",
    description: `How ${COMPANY.legalName} secures the ${COMPANY.product} platform: encryption, role-based access, audit logs, key protection, tenant isolation and a mature security program.`,
  });

  return (
    <SiteLayout>
      {/* Hero */}
      <section className="pt-20 md:pt-28 pb-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-orange-500/5 to-purple-600/5 -z-10" />
        <div className="container mx-auto px-4 md:px-6 max-w-5xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-semibold mb-5">
            <Sparkles className="h-3 w-3" /> Security & trust
          </div>
          <div className="mx-auto w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-6">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Built on trust. <span className="text-primary">Protected by design.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto">
            {COMPANY.product} is built by {COMPANY.legalName} to the same security bar as the systems your bank and aggregators use.
            Here is exactly how we keep your data — and your customers' data — safe.
          </p>
          <p className="mt-4 text-sm text-muted-foreground italic">{COMPANY.proudlyBuiltLine}</p>
        </div>
      </section>

      {/* Pillars */}
      <section className="py-16 md:py-20 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-3">Six pillars of platform security</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">From encryption to RBAC to audit trails — designed in, not bolted on.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {PILLARS.map((p) => (
              <div key={p.title} className="rounded-2xl border border-border bg-card p-6 md:p-7">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <p.icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-xl font-bold mb-2">{p.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Controls list */}
      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl grid lg:grid-cols-2 gap-12 items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">Controls you can turn on</p>
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-5">Defense in depth — at the platform and the outlet.</h2>
            <p className="text-muted-foreground leading-relaxed">
              Security is not just our job. We give you the controls to enforce the policies that matter to your business —
              from MFA on the owner account to PINs on the captain's tablet.
            </p>
          </div>
          <div className="space-y-2.5">
            {CONTROLS.map((c) => (
              <div key={c.label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                <span className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <c.icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-medium">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Program */}
      <section className="py-16 md:py-20 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4 md:px-6 max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-3">A mature security program</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Not a one-time audit. A continuous practice baked into how we build, ship and operate.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {PROGRAM.map((p) => (
              <div key={p.title} className="rounded-2xl border border-border bg-card p-6">
                <h3 className="font-serif text-xl font-bold mb-2">{p.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Data ownership / compliance */}
      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="rounded-2xl border border-border bg-card p-7">
              <div className="flex items-center gap-3 mb-3">
                <BookLock className="h-6 w-6 text-primary" />
                <h3 className="font-serif text-2xl font-bold">Your data, your control</h3>
              </div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li className="flex gap-2"><span className="text-primary font-bold">→</span> You own all data you upload to {COMPANY.product}.</li>
                <li className="flex gap-2"><span className="text-primary font-bold">→</span> We never sell your data — and we don't train AI models on it.</li>
                <li className="flex gap-2"><span className="text-primary font-bold">→</span> Export, delete and DPA-grade controls are available on request.</li>
                <li className="flex gap-2"><span className="text-primary font-bold">→</span> Data is hosted on Indian cloud regions by default.</li>
              </ul>
              <div className="flex gap-2 mt-5">
                <Link href="/data-processing-agreement"><Button size="sm" variant="outline">Read our DPA</Button></Link>
                <Link href="/privacy-policy"><Button size="sm" variant="ghost">Privacy policy</Button></Link>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-7">
              <div className="flex items-center gap-3 mb-3">
                <ShieldCheck className="h-6 w-6 text-primary" />
                <h3 className="font-serif text-2xl font-bold">Report a security issue</h3>
              </div>
              <p className="text-muted-foreground mb-4">
                We welcome responsible disclosure. If you believe you've found a vulnerability in {COMPANY.product}, please reach out — we'll respond within one business day.
              </p>
              <div className="space-y-2 text-sm">
                <a href={`mailto:${COMPANY.supportEmail}?subject=Security%20Disclosure`} className="flex items-center gap-2 text-primary font-medium hover:underline">
                  <Mail className="h-4 w-4" /> {COMPANY.supportEmail}
                </a>
                <p className="text-xs text-muted-foreground">Please include reproduction steps and an estimate of potential impact. Do not exploit, exfiltrate data, or disrupt service.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CTASection
        title="Want to see our security documentation?"
        subtitle="Enterprise customers can request our security questionnaire, sub-processor list and counter-signed DPA."
        primary={{ label: `Email ${COMPANY.supportEmail}`, href: `mailto:${COMPANY.supportEmail}?subject=Security%20Documentation%20Request` }}
        secondary={{ label: "Read the DPA", href: "/data-processing-agreement" }}
      />
    </SiteLayout>
  );
}
