import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { motion } from "framer-motion";
import {
  ArrowRight, Phone, MessageCircle, CheckCircle2, Sparkles, IndianRupee,
  Activity, ChefHat, AlertTriangle, Star, ShoppingBag, QrCode, Boxes,
  Wallet, Users, BarChart3, TrendingUp, Smartphone, Building2, Brain,
  Send, ChevronDown, Zap, Shield, Clock, Target, Layers, PieChart,
  Coffee, UtensilsCrossed, Truck, Store, Pizza, Hotel,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/lib/seo";
import { COMPANY, LEGAL_LINKS } from "@/lib/company";
import { useAppSettings } from "@/lib/appSettings";
import { cn } from "@/lib/utils";
import { usePublicPlans, type PublicPlan, type DisplayPlan } from "@/lib/usePublicPlans";
import {
  PLAN_BOOLEAN_FEATURES, PLAN_QUANTITY_FEATURES,
  isFeatureEnabled, formatQuantity,
} from "@workspace/db/planFeatures";

/** Where the "Start free trial" CTAs go. Kept as a constant so it's
 * easy to change across the whole ads page in one place. */
const REGISTER_URL = "/app/register";

const BRAND = {
  primary: "#FF6B1A",
  deep: "#E85A0C",
  charcoal: "#111827",
  warm: "#FFF8F1",
  purple: "#7C3AED",
};

const FEATURE_OPTIONS = [
  { id: "pos_billing", label: "POS Billing" },
  { id: "qr_menu", label: "QR Menu" },
  { id: "inventory", label: "Inventory" },
  { id: "payroll", label: "Payroll" },
  { id: "khana_ai", label: "Khana AI" },
  { id: "growth", label: "Growth Engine" },
  { id: "multi_outlet", label: "Multi-outlet" },
  { id: "finance", label: "Finance / P&L" },
];

const BUSINESS_TYPES = [
  { value: "fine-dining", label: "Fine Dining" },
  { value: "casual-dining", label: "Casual Dining" },
  { value: "cafe", label: "Cafe / Bakery" },
  { value: "qsr", label: "Quick Service (QSR)" },
  { value: "cloud-kitchen", label: "Cloud Kitchen" },
  { value: "bar", label: "Bar / Pub" },
  { value: "hotel", label: "Hotel / Resort" },
  { value: "chain", label: "Chain / Multi-outlet" },
  { value: "other", label: "Other" },
];

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

const leadSchema = z.object({
  name: z.string().min(2, "Please enter your full name"),
  restaurantName: z.string().min(2, "Restaurant name is required"),
  phone: z.string().min(7, "Please enter a valid phone number"),
  email: z.string().email("Please enter a valid email"),
  city: z.string().min(2, "City is required"),
  businessType: z.string().min(1, "Please select your business type"),
  outletCount: z.coerce.number().min(1).max(9999),
  features: z.array(z.string()).min(1, "Select at least one feature you're interested in"),
  message: z.string().optional(),
  website: z.string().max(0), // honeypot
});
type LeadValues = z.infer<typeof leadSchema>;

export default function DemoRestaurantOS() {
  const [location] = useLocation();
  const settings = useAppSettings();

  useSeo({
    title: "Restaurant OS — Run your whole restaurant from one place | KhanaLagao",
    description:
      "POS, QR menu, kitchen, inventory, payroll, finance and Khana AI in one connected system. Book a free demo and see KhanaLagao Restaurant OS in action.",
    noindex: true,
  });

  return (
    <div
      className="min-h-screen flex flex-col font-sans overflow-x-hidden"
      style={{ backgroundColor: BRAND.warm, color: BRAND.charcoal }}
    >
      <AdsHeader appName={settings.appName} />

      <main className="flex-grow pb-20 lg:pb-0">
        <Hero />
        <TrustStrip />
        <PainPoints />
        <Solution />
        <ProductFlow />
        <KeyFeatures />
        <KhanaAISection />
        <RestaurantTypes />
        <Results />
        <PricingTeaser />
        <LeadFormSection sourcePath={location} />
        <FAQ />
        <FinalCTA />
      </main>

      <AdsFooter />
      <StickyBottomBar />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header & Footer                                                    */
/* ------------------------------------------------------------------ */

function AdsHeader({ appName }: { appName: string }) {
  return (
    <header
      className="sticky top-0 z-50 w-full border-b backdrop-blur-xl"
      style={{ backgroundColor: "rgba(255,248,241,0.92)", borderColor: "rgba(17,24,39,0.08)" }}
      data-testid="ads-header"
    >
      <div className="container mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
            style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})` }}
          >
            K
          </span>
          <span className="font-serif text-base md:text-xl font-bold tracking-tight truncate">
            {appName}
          </span>
          <span
            className="hidden sm:inline-flex ml-1 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-semibold uppercase tracking-wide"
            style={{ backgroundColor: `${BRAND.primary}15`, color: BRAND.deep }}
          >
            Restaurant OS
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a href={REGISTER_URL} className="hidden sm:inline-flex">
            <Button
              size="sm"
              variant="outline"
              className="h-9 md:h-10 px-3 md:px-4 text-xs md:text-sm font-semibold border-2"
              style={{ borderColor: BRAND.primary, color: BRAND.deep }}
              data-testid="btn-header-trial"
            >
              Start free trial
            </Button>
          </a>
          <a href="#lead-form">
            <Button
              size="sm"
              className="h-9 md:h-10 px-3 md:px-5 text-xs md:text-sm font-semibold text-white"
              style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})` }}
              data-testid="btn-header-demo"
            >
              Book Demo <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </a>
        </div>
      </div>
    </header>
  );
}

function AdsFooter() {
  return (
    <footer className="border-t mt-8" style={{ borderColor: "rgba(17,24,39,0.08)" }}>
      <div className="container mx-auto px-4 py-8 md:py-10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="h-7 w-7 rounded-md flex items-center justify-center text-white font-bold text-xs"
                style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})` }}
              >
                K
              </span>
              <span className="font-serif font-bold text-lg">{COMPANY.product}</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-md">
              {COMPANY.productTagline}.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 text-sm">
            <a href={COMPANY.phoneHref} className="inline-flex items-center gap-1.5 font-medium">
              <Phone className="h-4 w-4" style={{ color: BRAND.primary }} />
              {COMPANY.phoneDisplay}
            </a>
            <a
              href={`mailto:${COMPANY.salesEmail}`}
              className="inline-flex items-center gap-1.5 font-medium"
            >
              <Send className="h-4 w-4" style={{ color: BRAND.primary }} />
              {COMPANY.salesEmail}
            </a>
          </div>
        </div>
        <div
          className="mt-6 pt-5 border-t flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-xs text-muted-foreground"
          style={{ borderColor: "rgba(17,24,39,0.08)" }}
        >
          <p>{COMPANY.copyrightLine}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL_LINKS.filter((l) => ["/privacy-policy", "/terms"].includes(l.href)).map((l) => (
              <Link key={l.href} href={l.href} className="hover:underline">
                {l.title}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

function StickyBottomBar() {
  return (
    <div
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t px-3 py-2.5 flex gap-2 safe-bottom"
      style={{
        backgroundColor: "rgba(255,248,241,0.97)",
        borderColor: "rgba(17,24,39,0.1)",
        boxShadow: "0 -4px 16px -4px rgba(0,0,0,0.08)",
        backdropFilter: "blur(12px)",
      }}
      data-testid="sticky-bottom-bar"
    >
      <a href="#lead-form" className="flex-1">
        <Button
          className="w-full h-11 text-sm font-semibold text-white"
          style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})` }}
          data-testid="sticky-cta-demo"
        >
          Book Demo <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </a>
      <a href={COMPANY.whatsappUrl} target="_blank" rel="noreferrer" className="shrink-0">
        <Button variant="outline" className="h-11 px-3 border-2" data-testid="sticky-cta-whatsapp">
          <MessageCircle className="h-4 w-4" style={{ color: "#25D366" }} />
        </Button>
      </a>
      <a href={COMPANY.phoneHref} className="shrink-0">
        <Button variant="outline" className="h-11 px-3 border-2" data-testid="sticky-cta-call">
          <Phone className="h-4 w-4" style={{ color: BRAND.primary }} />
        </Button>
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                               */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="relative pt-6 pb-10 md:pt-16 md:pb-24 overflow-hidden">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(circle at 90% 10%, ${BRAND.primary}22, transparent 50%), radial-gradient(circle at 10% 80%, ${BRAND.purple}1a, transparent 50%)`,
        }}
      />
      <div className="container mx-auto px-4 grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-4 md:space-y-6 max-w-2xl"
        >
          <div
            className="inline-flex items-center rounded-full px-3 py-1 text-[11px] md:text-sm font-semibold"
            style={{ backgroundColor: `${BRAND.primary}18`, color: BRAND.deep }}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            Restaurant OS · POS · QR · KDS · Inventory · AI
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight leading-[1.1]">
            Run your whole restaurant from{" "}
            <span style={{ color: BRAND.primary }}>one place</span>.
          </h1>
          <p className="text-base md:text-xl leading-relaxed" style={{ color: "#374151" }}>
            Billing, kitchen, tables, stock, staff, payments and AI insights — all connected.
            Built for Indian restaurants, cafes, cloud kitchens and chains.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <a href="#lead-form" className="sm:w-auto">
              <Button
                size="lg"
                className="w-full sm:w-auto h-12 px-6 text-base font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})` }}
                data-testid="btn-hero-demo"
              >
                Book Free Demo <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
            <a href={REGISTER_URL} className="sm:w-auto">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto h-12 px-6 text-base font-semibold border-2"
                style={{ borderColor: BRAND.primary, color: BRAND.deep }}
                data-testid="btn-hero-trial"
              >
                Start free trial <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
          <a
            href={COMPANY.whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold"
            style={{ color: BRAND.deep }}
            data-testid="btn-hero-whatsapp"
          >
            <MessageCircle className="h-4 w-4" style={{ color: "#25D366" }} />
            Or chat with us on WhatsApp
          </a>

          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs md:text-sm pt-1" style={{ color: "#4B5563" }}>
            <span className="inline-flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" style={{ color: BRAND.primary }} /> No card required</span>
            <span className="inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" style={{ color: BRAND.primary }} /> Setup in 1 day</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" style={{ color: BRAND.primary }} /> 30-min walkthrough</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="relative w-full max-w-md mx-auto lg:max-w-xl"
        >
          <HeroMockup />
        </motion.div>
      </div>
    </section>
  );
}

function HeroMockup() {
  return (
    <div className="relative">
      <div
        className="rounded-2xl md:rounded-3xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: "white", borderColor: "rgba(17,24,39,0.1)" }}
      >
        <div className="h-7 md:h-9 flex items-center px-3 gap-1.5" style={{ backgroundColor: "#F3F4F6" }}>
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
        </div>
        <div className="p-3 md:p-5 space-y-3 md:space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] md:text-xs text-muted-foreground">Today</div>
              <div className="font-bold text-sm md:text-base">Dashboard</div>
            </div>
            <div
              className="text-[10px] md:text-xs px-2 py-1 rounded-full font-semibold"
              style={{ backgroundColor: `${BRAND.primary}15`, color: BRAND.deep }}
            >
              Live
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:gap-3">
            <MetricTile label="Sales" value="₹ 1,42,800" tone="primary" />
            <MetricTile label="Orders" value="187" tone="green" />
            <MetricTile label="Avg Bill" value="₹ 764" tone="blue" />
            <MetricTile label="Pending KOT" value="12" tone="amber" />
          </div>
          <div
            className="rounded-xl p-2.5 md:p-3 border"
            style={{ backgroundColor: `${BRAND.purple}08`, borderColor: `${BRAND.purple}30` }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Brain className="h-3.5 w-3.5" style={{ color: BRAND.purple }} />
              <span className="text-[10px] md:text-xs font-bold" style={{ color: BRAND.purple }}>
                Khana AI insight
              </span>
            </div>
            <p className="text-[11px] md:text-xs leading-snug">
              Friday dinners drop 18% — push Paneer Tikka combo at 7pm.
            </p>
          </div>
        </div>
      </div>

      <FloatCard className="-top-3 -left-2 md:-top-5 md:-left-5" delay={0.3}>
        <IndianRupee className="h-3.5 w-3.5" style={{ color: BRAND.primary }} />
        <div>
          <div className="text-[9px] text-muted-foreground">Today Sales</div>
          <div className="text-xs font-bold">₹ 1,42,800</div>
        </div>
      </FloatCard>
      <FloatCard className="top-4 -right-2 md:top-8 md:-right-6" delay={0.45}>
        <Activity className="h-3.5 w-3.5 text-green-500" />
        <div>
          <div className="text-[9px] text-muted-foreground">Live Orders</div>
          <div className="text-xs font-bold">37 active</div>
        </div>
      </FloatCard>
      <FloatCard className="hidden sm:flex top-1/2 -left-6" delay={0.6}>
        <ChefHat className="h-3.5 w-3.5 text-amber-500" />
        <div>
          <div className="text-[9px] text-muted-foreground">Kitchen</div>
          <div className="text-xs font-bold">12 KOTs</div>
        </div>
      </FloatCard>
      <FloatCard className="-bottom-3 -right-2 md:-bottom-4 md:-right-4" delay={0.75}>
        <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
        <div>
          <div className="text-[9px] text-muted-foreground">Stock Alert</div>
          <div className="text-xs font-bold">Cheese low</div>
        </div>
      </FloatCard>
      <FloatCard className="hidden sm:flex -bottom-2 left-6" delay={0.9}>
        <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-400" />
        <div>
          <div className="text-[9px] text-muted-foreground">Rating</div>
          <div className="text-xs font-bold">4.7 · 312</div>
        </div>
      </FloatCard>
    </div>
  );
}

function MetricTile({ label, value, tone }: { label: string; value: string; tone: "primary" | "green" | "blue" | "amber" }) {
  const tones: Record<string, string> = {
    primary: BRAND.primary,
    green: "#10B981",
    blue: "#3B82F6",
    amber: "#F59E0B",
  };
  return (
    <div className="rounded-lg md:rounded-xl border p-2 md:p-2.5" style={{ borderColor: "rgba(17,24,39,0.08)" }}>
      <div className="text-[9px] md:text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm md:text-base font-bold" style={{ color: tones[tone] }}>{value}</div>
    </div>
  );
}

function FloatCard({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={`absolute z-10 flex items-center gap-2 rounded-xl border shadow-lg px-2.5 py-1.5 ${className}`}
      style={{ backgroundColor: "rgba(255,255,255,0.97)", borderColor: "rgba(17,24,39,0.08)" }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Trust strip                                                        */
/* ------------------------------------------------------------------ */

function TrustStrip() {
  const items = [
    { icon: Shield, label: "GST-ready billing" },
    { icon: Smartphone, label: "Works on any device" },
    { icon: Clock, label: "Live in 1 day" },
    { icon: Users, label: "Hindi + English support" },
  ];
  return (
    <section className="py-4 md:py-6 border-y" style={{ borderColor: "rgba(17,24,39,0.06)", backgroundColor: "rgba(255,255,255,0.5)" }}>
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {items.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2 justify-center md:justify-start text-xs md:text-sm font-medium">
              <Icon className="h-4 w-4 shrink-0" style={{ color: BRAND.primary }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pain points                                                        */
/* ------------------------------------------------------------------ */

function PainPoints() {
  const pains = [
    "Bills, orders and KOTs scattered across notebooks, apps and shouts",
    "Stock runs out mid-service — and no one notices until customers complain",
    "Payroll, attendance and tips are a monthly headache",
    "No idea which dishes actually make money",
    "WhatsApp orders, Zomato, Swiggy and dine-in all live in different worlds",
    "Owners stuck reconciling cash and digital payments every night",
  ];
  return (
    <Section title="Running a restaurant shouldn't feel like firefighting" eyebrow="The problem">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {pains.map((p) => (
          <div
            key={p}
            className="rounded-xl border p-4 flex gap-3 items-start"
            style={{ borderColor: "rgba(17,24,39,0.08)", backgroundColor: "white" }}
          >
            <span
              className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-red-600"
              style={{ backgroundColor: "rgba(239,68,68,0.1)" }}
            >
              ✕
            </span>
            <p className="text-sm md:text-base leading-relaxed">{p}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Solution                                                           */
/* ------------------------------------------------------------------ */

function Solution() {
  const benefits = [
    { icon: Layers, title: "One connected system", body: "POS, kitchen, stock, staff, payments and CRM in one login." },
    { icon: Zap, title: "Fast on any device", body: "Tablets, phones, billing counters — works offline and online." },
    { icon: Brain, title: "AI that actually helps", body: "Khana AI spots problems and suggests fixes in plain Hindi/English." },
    { icon: TrendingUp, title: "More repeat customers", body: "Built-in CRM, WhatsApp campaigns and loyalty out of the box." },
    { icon: PieChart, title: "Daily P&L, not yearly", body: "See real food cost, dish margin and outlet profit every day." },
    { icon: Building2, title: "Scale to many outlets", body: "Central menu, prices, inventory and reports across all your branches." },
  ];
  return (
    <Section
      title="One restaurant operating system. Every problem in one place."
      eyebrow="The solution"
      gradient
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {benefits.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-2xl border p-5 hover:shadow-lg transition-shadow"
            style={{ borderColor: "rgba(17,24,39,0.08)", backgroundColor: "white" }}
          >
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center mb-3"
              style={{ backgroundColor: `${BRAND.primary}15`, color: BRAND.deep }}
            >
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-base md:text-lg mb-1">{title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Product flow                                                       */
/* ------------------------------------------------------------------ */

function ProductFlow() {
  const steps = [
    { icon: ShoppingBag, label: "Order", note: "Dine-in, QR, online" },
    { icon: QrCode, label: "POS / QR", note: "Auto KOT to kitchen" },
    { icon: ChefHat, label: "Kitchen", note: "Live KDS, prep timer" },
    { icon: Boxes, label: "Inventory", note: "Auto deduct, low-stock" },
    { icon: Wallet, label: "Payment", note: "UPI, card, split" },
    { icon: Users, label: "CRM", note: "Capture, segment, win-back" },
    { icon: BarChart3, label: "Reports", note: "Daily P&L, dish profit" },
    { icon: TrendingUp, label: "Growth", note: "Campaigns, loyalty, AI" },
  ];
  return (
    <Section
      title="The flow of one order — automated, end to end"
      eyebrow="How it works"
      subtitle="From the customer placing the order to the rupee landing in your account — everything connected, no double entry."
    >
      <div className="overflow-x-auto -mx-4 px-4 pb-2 md:overflow-visible md:mx-0 md:px-0">
        <div className="flex md:grid md:grid-cols-4 lg:grid-cols-8 gap-3 md:gap-2 min-w-max md:min-w-0">
          {steps.map(({ icon: Icon, label, note }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="relative rounded-xl border p-3 md:p-3 w-32 md:w-auto shrink-0"
              style={{ borderColor: "rgba(17,24,39,0.08)", backgroundColor: "white" }}
            >
              <div
                className="h-9 w-9 rounded-lg flex items-center justify-center mb-2"
                style={{ backgroundColor: `${BRAND.primary}15`, color: BRAND.deep }}
              >
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div className="font-bold text-sm">{label}</div>
              <div className="text-[11px] text-muted-foreground leading-tight">{note}</div>
              {i < steps.length - 1 && (
                <div
                  className="hidden lg:block absolute top-1/2 -right-1.5 h-0.5 w-3"
                  style={{ backgroundColor: BRAND.primary }}
                />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Key features                                                       */
/* ------------------------------------------------------------------ */

const FEATURE_TABS = {
  Sell: [
    { icon: ShoppingBag, title: "POS Billing", body: "Fast KOT/BOT, splits, discounts, GST invoicing." },
    { icon: QrCode, title: "QR Menu & Ordering", body: "Scan-to-order with photos, customisation, upsell." },
    { icon: Truck, title: "Online Ordering", body: "Your own site + Zomato/Swiggy in one inbox." },
    { icon: Smartphone, title: "Captain App", body: "Order from tablet/phone, send straight to kitchen." },
  ],
  Manage: [
    { icon: ChefHat, title: "Kitchen / KDS", body: "Live tickets, prep timers, course pacing." },
    { icon: Boxes, title: "Inventory & Recipes", body: "Auto-deduct, low-stock alerts, wastage tracking." },
    { icon: Users, title: "Staff & Payroll", body: "Attendance, tips, salary, leaves and shifts." },
    { icon: Wallet, title: "Finance & P&L", body: "Daily cash, expenses, dish margin, outlet profit." },
  ],
  Grow: [
    { icon: TrendingUp, title: "Growth Engine", body: "Campaigns on WhatsApp, SMS and email — built-in." },
    { icon: Target, title: "Loyalty & CRM", body: "Capture every guest, segment and win them back." },
    { icon: Building2, title: "Multi-outlet", body: "Central menu, prices, taxes and reporting." },
    { icon: BarChart3, title: "Reports", body: "Sales, items, hours, taxes — drill down anywhere." },
  ],
  AI: [
    { icon: Brain, title: "Khana AI Assistant", body: "Ask in Hindi/English — get instant answers." },
    { icon: Sparkles, title: "Sales Insights", body: "Flags drops, peaks, slow items, opportunities." },
    { icon: PieChart, title: "Menu Pricing", body: "Suggests where you're under or over-pricing." },
    { icon: Activity, title: "Fraud Alerts", body: "Catches unusual voids, discounts and refunds." },
  ],
};

function KeyFeatures() {
  const [active, setActive] = useState<keyof typeof FEATURE_TABS>("Sell");
  return (
    <Section
      title="Everything you need to sell, manage, grow"
      eyebrow="Key features"
      gradient
    >
      <div className="flex gap-2 mb-5 md:mb-6 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 md:justify-center">
        {(Object.keys(FEATURE_TABS) as Array<keyof typeof FEATURE_TABS>).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActive(tab)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all border-2",
              active === tab ? "text-white" : "",
            )}
            style={
              active === tab
                ? { background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})`, borderColor: BRAND.primary }
                : { backgroundColor: "white", borderColor: "rgba(17,24,39,0.1)", color: BRAND.charcoal }
            }
            data-testid={`tab-${tab.toLowerCase()}`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {FEATURE_TABS[active].map(({ icon: Icon, title, body }) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-xl border p-4 md:p-5"
            style={{ borderColor: "rgba(17,24,39,0.08)", backgroundColor: "white" }}
          >
            <div
              className="h-9 w-9 rounded-lg flex items-center justify-center mb-3"
              style={{ backgroundColor: `${BRAND.primary}15`, color: BRAND.deep }}
            >
              <Icon className="h-4.5 w-4.5" />
            </div>
            <h3 className="font-bold text-sm md:text-base mb-1">{title}</h3>
            <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">{body}</p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Khana AI premium                                                   */
/* ------------------------------------------------------------------ */

function KhanaAISection() {
  return (
    <section className="py-10 md:py-20">
      <div className="container mx-auto px-4">
        <div
          className="relative rounded-3xl overflow-hidden p-6 md:p-12 border"
          style={{
            background: `linear-gradient(135deg, ${BRAND.primary} 0%, ${BRAND.deep} 50%, ${BRAND.purple} 100%)`,
            borderColor: "rgba(255,255,255,0.2)",
          }}
        >
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-white blur-3xl -translate-y-1/2 translate-x-1/3" />
          </div>
          <div className="relative grid lg:grid-cols-2 gap-8 items-center">
            <div className="text-white space-y-4 md:space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-xs md:text-sm font-semibold">
                <Brain className="h-4 w-4" />
                Khana AI · included in every plan
              </div>
              <h2 className="font-serif text-3xl md:text-5xl font-bold leading-tight">
                Your AI co-pilot for the restaurant
              </h2>
              <p className="text-sm md:text-lg text-white/90 leading-relaxed">
                Ask Khana AI anything about your business in Hindi or English — sales,
                stock, staff, dish performance. Get answers, not dashboards.
              </p>
              <ul className="space-y-2 text-sm md:text-base">
                {[
                  "Spots problems before customers notice",
                  "Suggests menu pricing and combos that work",
                  "Predicts demand and helps you prep right",
                  "Catches fraud, voids and unusual patterns",
                ].map((s) => (
                  <li key={s} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4.5 w-4.5 mt-0.5 shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <div
                className="rounded-2xl shadow-2xl p-4 md:p-5 space-y-3 max-w-md mx-auto"
                style={{ backgroundColor: "white", color: BRAND.charcoal }}
              >
                <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: "rgba(17,24,39,0.08)" }}>
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center text-white"
                    style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.purple})` }}
                  >
                    <Brain className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold">Khana AI</div>
                    <div className="text-[10px] text-muted-foreground">Online · just now</div>
                  </div>
                </div>
                <ChatBubble side="user">aaj ka sale kitna hua?</ChatBubble>
                <ChatBubble side="ai">
                  Aaj abhi tak ₹ <b>1,42,800</b> hua hai (187 orders).
                  Kal isi waqt se <b>18% zyada</b> hai 👏
                </ChatBubble>
                <ChatBubble side="user">kya kuch slow hai?</ChatBubble>
                <ChatBubble side="ai">
                  Haan — <b>Veg Sizzler</b> ke orders pichle 7 din me 40% gire hain.
                  Dish ko menu me upar laun? Ya bundle offer banau?
                </ChatBubble>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({ side, children }: { side: "user" | "ai"; children: React.ReactNode }) {
  const isUser = side === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-xs md:text-sm leading-relaxed", isUser ? "rounded-br-sm" : "rounded-bl-sm")}
        style={
          isUser
            ? { backgroundColor: `${BRAND.primary}15`, color: BRAND.charcoal }
            : { backgroundColor: `${BRAND.purple}10`, color: BRAND.charcoal }
        }
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Restaurant types — horizontal scroll chips                         */
/* ------------------------------------------------------------------ */

function RestaurantTypes() {
  const types = [
    { icon: UtensilsCrossed, label: "Fine Dining" },
    { icon: Coffee, label: "Cafe & Bakery" },
    { icon: Pizza, label: "QSR" },
    { icon: Truck, label: "Cloud Kitchen" },
    { icon: Store, label: "Bar & Pub" },
    { icon: Hotel, label: "Hotel & Resort" },
    { icon: Building2, label: "Multi-outlet Chain" },
    { icon: ShoppingBag, label: "Takeaway / Delivery" },
  ];
  return (
    <Section title="Built for every kind of restaurant" eyebrow="Who it's for">
      <div className="overflow-x-auto -mx-4 px-4 pb-2">
        <div className="flex gap-2.5 md:gap-3 min-w-max md:flex-wrap md:min-w-0 md:justify-center">
          {types.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm font-semibold shrink-0"
              style={{ borderColor: "rgba(17,24,39,0.1)", backgroundColor: "white" }}
            >
              <Icon className="h-4 w-4" style={{ color: BRAND.primary }} />
              {label}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Results / Benefits                                                 */
/* ------------------------------------------------------------------ */

function Results() {
  const results = [
    { stat: "Faster", label: "Billing & KOT", body: "Tableside captain orders cut wait time and table turn-over time." },
    { stat: "Lower", label: "Food cost", body: "Recipe-level inventory + wastage tracking reduces leakage." },
    { stat: "Smarter", label: "Pricing", body: "Khana AI finds where you can charge more — and where you shouldn't." },
    { stat: "Higher", label: "Repeat orders", body: "WhatsApp + loyalty bring guests back without paid ads." },
  ];
  return (
    <Section title="What changes after you switch" eyebrow="Results" gradient>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {results.map((r) => (
          <div
            key={r.label}
            className="rounded-2xl border p-4 md:p-5"
            style={{ borderColor: "rgba(17,24,39,0.08)", backgroundColor: "white" }}
          >
            <div className="text-xl md:text-2xl font-bold" style={{ color: BRAND.deep }}>{r.stat}</div>
            <div className="font-semibold text-sm md:text-base mb-1.5">{r.label}</div>
            <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">{r.body}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-center mt-5 text-muted-foreground italic">
        Outcomes vary based on outlet, menu and operations. We don't promise guaranteed numbers.
      </p>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Pricing teaser                                                     */
/* ------------------------------------------------------------------ */

/** Number of highlighted features per plan card before "more" is hidden. */
const MINIMAL_FEATURE_COUNT = 5;

/** Build a short, opinionated feature list per plan: the quantity limits +
 * up to MINIMAL_FEATURE_COUNT enabled boolean features. Used in the
 * collapsed card view. */
function minimalFeatureList(plan: PublicPlan): string[] {
  const out: string[] = [];
  // Quantity limits + trial are always-on context rows; they don't count
  // towards the boolean cap.
  for (const q of PLAN_QUANTITY_FEATURES.slice(0, 3)) {
    const v = plan[q.key] ?? 0;
    const label = formatQuantity(q, v);
    if (label) out.push(label);
  }
  if (plan.trialDays > 0) out.push(`${plan.trialDays}-day free trial`);
  // Hard-cap enabled boolean features at MINIMAL_FEATURE_COUNT, regardless
  // of how many quantity rows above were populated.
  let added = 0;
  for (const f of PLAN_BOOLEAN_FEATURES) {
    if (added >= MINIMAL_FEATURE_COUNT) break;
    if (isFeatureEnabled(plan.featureFlags, f.key)) {
      out.push(f.label);
      added++;
    }
  }
  return out;
}

function PricingTeaser() {
  const { plans, getDisplayPlans, isLoading, error } = usePublicPlans();
  const displayPlans = getDisplayPlans("monthly");
  const popularIdx = displayPlans.length >= 2 ? Math.floor(displayPlans.length / 2) : -1;
  const [compareOpen, setCompareOpen] = useState(false);

  if (isLoading) {
    return (
      <Section title="Plans that grow with you" eyebrow="Pricing">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[380px] rounded-2xl" />
          ))}
        </div>
      </Section>
    );
  }

  if (error || plans.length === 0) {
    // Fallback: stay useful even if the public plans API is down.
    return (
      <Section title="Plans that grow with you" eyebrow="Pricing">
        <div className="max-w-xl mx-auto text-center rounded-2xl border p-6 bg-white" style={{ borderColor: "rgba(17,24,39,0.08)" }}>
          <p className="text-sm text-muted-foreground mb-4">
            Talk to our team for a personalized quote based on your outlets and add-ons.
          </p>
          <a href="#lead-form">
            <Button
              className="font-semibold text-white"
              style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})` }}
            >
              Book a demo <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </a>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Plans that grow with you" eyebrow="Pricing" subtitle="Start free for 14 days — no card needed. Upgrade or cancel any time.">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
        {displayPlans.slice(0, 3).map((dp, i) => (
          <MinimalPlanCard
            key={dp.plan.id}
            dp={dp}
            featured={i === popularIdx}
          />
        ))}
      </div>
      <div className="flex flex-col items-center gap-2 mt-6">
        <Button
          variant="outline"
          className="font-semibold border-2"
          style={{ borderColor: BRAND.primary, color: BRAND.deep }}
          onClick={() => setCompareOpen(true)}
          data-testid="btn-compare-plans"
        >
          Compare all features <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          All plans include free onboarding, training and chat support.
        </p>
      </div>
      <PricingCompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        displayPlans={displayPlans}
      />
    </Section>
  );
}

function MinimalPlanCard({ dp, featured }: { dp: DisplayPlan; featured: boolean }) {
  const plan = dp.plan;
  const isFree = Number(plan.price) === 0;
  const features = minimalFeatureList(plan);
  const tagline = plan.description ??
    (isFree ? "Try the full platform free" : featured ? "Most popular" : "");
  return (
    <div
      className={cn(
        "rounded-2xl border p-5 md:p-6 flex flex-col",
        featured && "shadow-xl md:scale-[1.02]",
      )}
      style={{
        borderColor: featured ? BRAND.primary : "rgba(17,24,39,0.08)",
        backgroundColor: "white",
        borderWidth: featured ? 2 : 1,
      }}
      data-testid={`card-plan-${plan.name.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {featured && (
        <div
          className="inline-block self-start text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full mb-2 text-white"
          style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})` }}
        >
          Most popular
        </div>
      )}
      <h3 className="font-serif text-xl md:text-2xl font-bold">{plan.name}</h3>
      <div className="flex items-baseline gap-1 mt-1 mb-1">
        <span className="text-3xl md:text-4xl font-bold">{dp.displayPrice}</span>
        {!isFree && <span className="text-sm text-muted-foreground">/mo</span>}
      </div>
      {tagline && <p className="text-xs md:text-sm text-muted-foreground mb-4">{tagline}</p>}
      <ul className="space-y-2 text-sm flex-1">
        {features.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: BRAND.primary }} />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <a href={REGISTER_URL} className="mt-5">
        <Button
          className="w-full font-semibold"
          variant={featured ? "default" : "outline"}
          style={
            featured
              ? { background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})`, color: "white" }
              : { borderColor: BRAND.primary, color: BRAND.deep, borderWidth: 2 }
          }
          data-testid={`btn-plan-${plan.name.toLowerCase().replace(/\s+/g, "-")}-trial`}
        >
          Start free trial <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </a>
      <a href="#lead-form" className="block text-center mt-2 text-xs font-medium text-muted-foreground hover:underline">
        Or book a demo
      </a>
    </div>
  );
}

function PricingCompareDialog({
  open, onOpenChange, displayPlans,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  displayPlans: DisplayPlan[];
}) {
  // Group rows by category for readability.
  const groups = PLAN_BOOLEAN_FEATURES.reduce<Record<string, typeof PLAN_BOOLEAN_FEATURES>>((acc, f) => {
    (acc[f.category] ||= []).push(f);
    return acc;
  }, {});
  const categoryOrder: { key: string; label: string }[] = [
    { key: "core", label: "Core" },
    { key: "operations", label: "Operations" },
    { key: "growth", label: "Growth" },
    { key: "platform", label: "Platform" },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="p-5 md:p-6 pb-3 border-b" style={{ borderColor: "rgba(17,24,39,0.08)" }}>
          <DialogTitle className="font-serif text-2xl md:text-3xl">Compare all features</DialogTitle>
          <DialogDescription>
            Every plan includes a free trial, onboarding and chat support. Upgrade or downgrade any time.
          </DialogDescription>
        </DialogHeader>
        <div className="p-3 md:p-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "rgba(17,24,39,0.08)" }}>
                <th className="text-left font-semibold py-3 pr-3 w-[40%]">Feature</th>
                {displayPlans.map((dp) => (
                  <th key={dp.plan.id} className="text-center font-semibold py-3 px-2">
                    <div className="font-serif text-base md:text-lg">{dp.plan.name}</div>
                    <div className="text-xs text-muted-foreground font-normal">{dp.displayPrice}{Number(dp.plan.price) === 0 ? "" : "/mo"}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Quantity rows first */}
              {PLAN_QUANTITY_FEATURES.map((q) => (
                <tr key={`q-${q.key}`} className="border-b" style={{ borderColor: "rgba(17,24,39,0.05)" }}>
                  <td className="py-2.5 pr-3 text-muted-foreground">{q.label}</td>
                  {displayPlans.map((dp) => {
                    const v = dp.plan[q.key] ?? 0;
                    const label = formatQuantity(q, v) ?? "—";
                    return (
                      <td key={dp.plan.id} className="text-center py-2.5 px-2 font-medium">{label.replace(/^\d+\s*/, (m) => m.trim() + " ")}</td>
                    );
                  })}
                </tr>
              ))}
              {/* Boolean rows grouped by category */}
              {categoryOrder.map(({ key, label }) => {
                const rows = groups[key] ?? [];
                if (!rows.length) return null;
                return (
                  <Fragment key={key}>
                    <tr className="bg-muted/40">
                      <td colSpan={displayPlans.length + 1} className="py-2 pr-3 pl-0 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {label}
                      </td>
                    </tr>
                    {rows.map((f) => (
                      <tr key={f.key} className="border-b" style={{ borderColor: "rgba(17,24,39,0.05)" }}>
                        <td className="py-2.5 pr-3">{f.label}</td>
                        {displayPlans.map((dp) => {
                          const on = isFeatureEnabled(dp.plan.featureFlags, f.key);
                          return (
                            <td key={dp.plan.id} className="text-center py-2.5 px-2">
                              {on
                                ? <CheckCircle2 className="inline h-4 w-4" style={{ color: BRAND.primary }} />
                                : <span className="text-muted-foreground/50">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-4 md:p-6 pt-3 border-t flex flex-col sm:flex-row gap-2 sm:justify-end" style={{ borderColor: "rgba(17,24,39,0.08)" }}>
          <a href="#lead-form" onClick={() => onOpenChange(false)}>
            <Button variant="outline" className="w-full sm:w-auto border-2" style={{ borderColor: BRAND.primary, color: BRAND.deep }}>
              Book a demo
            </Button>
          </a>
          <a href={REGISTER_URL}>
            <Button
              className="w-full sm:w-auto font-semibold text-white"
              style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})` }}
              data-testid="btn-compare-trial"
            >
              Start free trial <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Lead form                                                          */
/* ------------------------------------------------------------------ */

function LeadFormSection({ sourcePath }: { sourcePath: string }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const utmRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    UTM_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) utm[k] = v.slice(0, 120);
    });
    utmRef.current = utm;
  }, []);

  const form = useForm<LeadValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      name: "", restaurantName: "", phone: "", email: "", city: "",
      businessType: "", outletCount: 1, features: [], message: "", website: "",
    },
  });

  async function onSubmit(values: LeadValues) {
    if (values.website) return;
    setPending(true);
    try {
      const featuresLabel = values.features
        .map((id) => FEATURE_OPTIONS.find((f) => f.id === id)?.label ?? id)
        .join(", ");
      const utmEntries = Object.entries(utmRef.current);
      const utmLine = utmEntries.length
        ? `\n\n— Campaign: ${utmEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`
        : "";
      const payload = {
        name: values.name,
        email: values.email,
        phone: values.phone,
        restaurantName: values.restaurantName,
        city: values.city,
        businessType: values.businessType,
        outletCount: values.outletCount,
        features: featuresLabel,
        message: (values.message ?? "").trim() + utmLine,
        sourcePage: sourcePath || "/demo/restaurant-os",
        website: values.website,
      };
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Submit failed");
      setDone(true);
      toast({ title: "Thanks — we got it!", description: "Our team will reach out within 1 business day." });
      setTimeout(() => setLocation("/thank-you"), 400);
    } catch {
      toast({
        title: "Couldn't submit",
        description: "Please try again, or WhatsApp / call us directly.",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section id="lead-form" className="py-10 md:py-20 scroll-mt-20">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-6 md:mb-8">
            <div
              className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide mb-3"
              style={{ backgroundColor: `${BRAND.primary}15`, color: BRAND.deep }}
            >
              Book your free demo
            </div>
            <h2 className="font-serif text-3xl md:text-5xl font-bold leading-tight mb-3">
              See Restaurant OS in <span style={{ color: BRAND.primary }}>30 minutes</span>
            </h2>
            <p className="text-sm md:text-base text-muted-foreground max-w-xl mx-auto">
              Tell us about your restaurant. We'll tailor the demo to exactly what you need.
            </p>
          </div>

          {done ? (
            <div
              className="rounded-2xl border p-6 md:p-8 text-center"
              style={{ borderColor: BRAND.primary, backgroundColor: `${BRAND.primary}08` }}
            >
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3" style={{ color: BRAND.primary }} />
              <h3 className="font-bold text-xl md:text-2xl mb-2">Thanks — we got your details!</h3>
              <p className="text-sm text-muted-foreground">Redirecting you in a moment…</p>
            </div>
          ) : (
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="rounded-2xl md:rounded-3xl border p-5 md:p-8 shadow-xl space-y-4"
              style={{ borderColor: "rgba(17,24,39,0.08)", backgroundColor: "white" }}
            >
              <input
                type="text" tabIndex={-1} autoComplete="off"
                className="hidden" {...form.register("website")}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                <Field label="Full name *" error={form.formState.errors.name?.message}>
                  <Input placeholder="Your name" {...form.register("name")} data-testid="input-name" />
                </Field>
                <Field label="Restaurant name *" error={form.formState.errors.restaurantName?.message}>
                  <Input placeholder="e.g. The Golden Spoon" {...form.register("restaurantName")} data-testid="input-restaurant" />
                </Field>
                <Field label="Phone *" error={form.formState.errors.phone?.message}>
                  <Input type="tel" placeholder="+91 …" {...form.register("phone")} data-testid="input-phone" />
                </Field>
                <Field label="Email *" error={form.formState.errors.email?.message}>
                  <Input type="email" placeholder="you@restaurant.com" {...form.register("email")} data-testid="input-email" />
                </Field>
                <Field label="City *" error={form.formState.errors.city?.message}>
                  <Input placeholder="e.g. Jaipur" {...form.register("city")} data-testid="input-city" />
                </Field>
                <Field label="Business type *" error={form.formState.errors.businessType?.message}>
                  <Select
                    value={form.watch("businessType")}
                    onValueChange={(v) => form.setValue("businessType", v, { shouldValidate: true })}
                  >
                    <SelectTrigger data-testid="select-business-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {BUSINESS_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Number of outlets *" error={form.formState.errors.outletCount?.message}>
                  <Input type="number" min={1} max={9999} {...form.register("outletCount")} data-testid="input-outlets" />
                </Field>
              </div>

              <Field label="Interested features * (pick all that apply)" error={form.formState.errors.features?.message as string | undefined}>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {FEATURE_OPTIONS.map((opt) => {
                    const checked = form.watch("features").includes(opt.id);
                    return (
                      <label
                        key={opt.id}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer text-sm font-medium transition-all",
                        )}
                        style={
                          checked
                            ? { borderColor: BRAND.primary, backgroundColor: `${BRAND.primary}10`, color: BRAND.deep }
                            : { borderColor: "rgba(17,24,39,0.1)", backgroundColor: "white" }
                        }
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) => {
                            const cur = form.getValues("features");
                            const next = c ? [...cur, opt.id] : cur.filter((x) => x !== opt.id);
                            form.setValue("features", next, { shouldValidate: true });
                          }}
                          data-testid={`feature-${opt.id}`}
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </Field>

              <Field label="Anything else? (optional)">
                <Textarea
                  placeholder="Current software, peak issues, dream outcome…"
                  rows={3}
                  {...form.register("message")}
                  data-testid="input-message"
                />
              </Field>

              <Button
                type="submit"
                disabled={pending}
                className="w-full h-12 text-base font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})` }}
                data-testid="btn-submit-lead"
              >
                {pending ? "Sending…" : "Book my free demo"}
                {!pending && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>

              <p className="text-[11px] text-center text-muted-foreground">
                By submitting, you agree to be contacted by our team. We never share your details.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs md:text-sm font-semibold mb-1.5 block">{label}</Label>
      {children}
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                */
/* ------------------------------------------------------------------ */

function FAQ() {
  const faqs = [
    {
      q: "How long does setup take?",
      a: "Most outlets are live within 1 day — menu import, GST setup, devices and staff training included.",
    },
    {
      q: "Do I need new hardware?",
      a: "No. KhanaLagao runs on any tablet, phone or PC you already own. If you want a billing printer or KOT printer, we'll guide you to the right one.",
    },
    {
      q: "Will it work offline?",
      a: "Yes. Billing and KOT keep working without internet — orders sync automatically once you're back online.",
    },
    {
      q: "Can it handle Zomato and Swiggy?",
      a: "Yes. Online orders land in the same inbox as dine-in and QR, so your kitchen sees one stream and your reports stay clean.",
    },
    {
      q: "Is Khana AI really included?",
      a: "Yes — Khana AI insights, alerts and the chat assistant are part of the platform. Heavy AI usage on Enterprise gets dedicated credits.",
    },
    {
      q: "What about multi-outlet?",
      a: "Central menu, prices, taxes, inventory and reports across all your branches — with outlet-level access for managers.",
    },
    {
      q: "What does pricing look like?",
      a: "Starter, Growth and Enterprise plans — we'll share exact pricing on the demo based on your outlets and add-ons. No hidden fees.",
    },
  ];
  return (
    <Section title="Quick answers" eyebrow="FAQ" gradient>
      <div className="max-w-3xl mx-auto">
        <Accordion type="single" collapsible className="space-y-2">
          {faqs.map((f, i) => (
            <AccordionItem
              key={i}
              value={`faq-${i}`}
              className="border rounded-xl px-4"
              style={{ borderColor: "rgba(17,24,39,0.1)", backgroundColor: "white" }}
            >
              <AccordionTrigger className="text-left text-sm md:text-base font-semibold py-3.5 hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground leading-relaxed pb-4">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Final CTA                                                          */
/* ------------------------------------------------------------------ */

function FinalCTA() {
  return (
    <section className="py-10 md:py-16">
      <div className="container mx-auto px-4">
        <div
          className="rounded-3xl p-6 md:p-12 text-center text-white shadow-2xl"
          style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})` }}
        >
          <h2 className="font-serif text-3xl md:text-5xl font-bold mb-3 md:mb-4">
            Ready to run your restaurant smarter?
          </h2>
          <p className="text-sm md:text-lg text-white/90 mb-6 max-w-xl mx-auto">
            30-minute demo. Personalized to your outlets. No card required.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <a href="#lead-form" className="w-full sm:w-auto">
              <Button
                size="lg"
                className="w-full sm:w-auto h-12 px-7 text-base font-bold"
                style={{ backgroundColor: "white", color: BRAND.deep }}
                data-testid="btn-final-demo"
              >
                Book Free Demo <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
            <a href={REGISTER_URL} className="w-full sm:w-auto">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto h-12 px-7 text-base font-bold bg-transparent text-white border-2 border-white hover:bg-white/10"
                data-testid="btn-final-trial"
              >
                Start free trial <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
          <a
            href={COMPANY.whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 mt-4 text-sm text-white/90 hover:text-white font-semibold"
            data-testid="btn-final-whatsapp"
          >
            <MessageCircle className="h-4 w-4" /> Or message us on WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section wrapper                                                    */
/* ------------------------------------------------------------------ */

function Section({
  title, eyebrow, subtitle, children, gradient,
}: {
  title: string; eyebrow?: string; subtitle?: string; children: React.ReactNode; gradient?: boolean;
}) {
  return (
    <section
      className="py-10 md:py-20"
      style={gradient ? { backgroundColor: "rgba(255,255,255,0.5)" } : undefined}
    >
      <div className="container mx-auto px-4">
        <div className="text-center mb-6 md:mb-10 max-w-3xl mx-auto">
          {eyebrow && (
            <div
              className="inline-block px-3 py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wide mb-3"
              style={{ backgroundColor: `${BRAND.primary}15`, color: BRAND.deep }}
            >
              {eyebrow}
            </div>
          )}
          <h2 className="font-serif text-2xl sm:text-3xl md:text-5xl font-bold tracking-tight leading-tight">
            {title}
          </h2>
          {subtitle && <p className="mt-3 text-sm md:text-base text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}
