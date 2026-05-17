import { Coffee, ChefHat, Hotel, Cake, Building2, TrendingUp, type LucideIcon } from "lucide-react";

export interface CaseStudy {
  slug: string;
  icon: LucideIcon;
  brand: string;
  location: string;
  segment: string;
  logoText: string;
  accent: string;
  title: string;
  summary: string;
  heroMetric: { value: string; label: string };
  metrics: { k: string; v: string }[];
  problem: string[];
  solution: string[];
  result: string[];
  quote: { text: string; name: string; role: string };
  rolloutWeeks: number;
  outlets: number;
}

export const CASE_STUDIES: CaseStudy[] = [
  {
    slug: "sutra-modern-indian",
    icon: Coffee,
    brand: "Sutra Modern Indian",
    location: "Mumbai, IN",
    segment: "Fine dining · 6 outlets",
    logoText: "Sutra",
    accent: "from-amber-500/20 to-orange-500/10",
    title: "From 4 different tools to one — and 22% faster billing",
    summary:
      "Sutra replaced a legacy POS, a separate QR ordering tool, a spreadsheet for inventory and an aggregator dashboard with KhanaLagao. In 90 days, food cost dropped from 34% to 31% and captains were billing 22% faster on busy weekends.",
    heroMetric: { value: "−3%", label: "food cost in 90 days" },
    metrics: [
      { k: "22%", v: "faster billing" },
      { k: "−3%", v: "food cost" },
      { k: "6", v: "outlets unified" },
    ],
    problem: [
      "Four disconnected tools — POS, QR ordering, aggregator dashboard and an inventory sheet — meant reconciling numbers every night by hand.",
      "Food cost was creeping up but no one could pinpoint which outlet or which dish was the leak.",
      "Captains were waiting 8–10 seconds for every KOT to print on a Friday night.",
    ],
    solution: [
      "Migrated all 6 outlets onto KhanaLagao POS with the central menu and one ingredient master.",
      "Turned on real-time recipe costing so every dish's true margin is visible per outlet.",
      "Connected Swiggy and Zomato through the aggregator hub — no more typing orders by hand.",
    ],
    result: [
      "Food cost fell from 34% to 31% within the first 90 days.",
      "KOTs print in under 2 seconds and captains close tables 22% faster.",
      "Owner reviews a single P&L every morning instead of stitching four reports.",
    ],
    quote: {
      text: "We replaced three apps with KhanaLagao on day one. Food cost dropped 4% in the first month — and our manager actually leaves the floor before midnight now.",
      name: "Rohan Mehta",
      role: "Owner, Sutra Modern Indian",
    },
    rolloutWeeks: 3,
    outlets: 6,
  },
  {
    slug: "cafe-lumiere",
    icon: Building2,
    brand: "Café Lumiere",
    location: "Bengaluru, IN",
    segment: "Specialty cafe chain · 12 outlets",
    logoText: "Lumiere",
    accent: "from-rose-500/20 to-pink-500/10",
    title: "Central menu, branch pricing, and one report at 8 a.m.",
    summary:
      "Lumiere's 12 cafes ran on three different POS versions with no shared menu. KhanaLagao gave the head office a single source of truth — menus, prices and promos — while each cafe kept local control of staff and stock.",
    heroMetric: { value: "12 → 1", label: "menu sources" },
    metrics: [
      { k: "12", v: "outlets on one platform" },
      { k: "1 day", v: "menu rollout" },
      { k: "8 a.m.", v: "daily roll-up report" },
    ],
    problem: [
      "Menu changes took two weeks to reach every outlet — and prices were never consistent.",
      "The COO was opening 12 different spreadsheets every morning to compare yesterday's sales.",
      "Promos ran late or never made it to half the cafes.",
    ],
    solution: [
      "Single central menu with per-outlet pricing tiers and tax profiles.",
      "Daily auto-emailed roll-up report covering sales, top items, voids and labour by outlet.",
      "Promo scheduler so the head office can launch a campaign across all 12 cafes in one click.",
    ],
    result: [
      "Menu and price updates now ship across all 12 outlets in under 24 hours.",
      "The COO's morning review takes 10 minutes instead of an hour.",
      "Promo participation jumped from ~60% of outlets to 100%.",
    ],
    quote: {
      text: "Central menu and branch pricing finally work the way I always imagined. Roll-up reports across 12 outlets land on my phone every morning at 8 a.m.",
      name: "Aarti Iyer",
      role: "COO, Café Lumiere",
    },
    rolloutWeeks: 5,
    outlets: 12,
  },
  {
    slug: "hot-tawa-cloud-kitchens",
    icon: ChefHat,
    brand: "Hot Tawa Cloud Kitchens",
    location: "Delhi NCR, IN",
    segment: "Cloud kitchen · 3 brands · 1 KDS",
    logoText: "HotTawa",
    accent: "from-red-500/20 to-orange-500/10",
    title: "Khana AI cut over-prep by 18%",
    summary:
      "Hot Tawa runs three delivery brands out of one kitchen. They needed to know what to prep tomorrow — and what each brand was actually earning. Khana AI's demand forecast and per-brand P&L solved both.",
    heroMetric: { value: "−18%", label: "over-prep wastage" },
    metrics: [
      { k: "−18%", v: "over-prep" },
      { k: "3", v: "brands, 1 KDS" },
      { k: "4.7★", v: "avg aggregator rating" },
    ],
    problem: [
      "Three brands sharing a kitchen meant shared raw material but no visibility on which brand was profitable.",
      "Daily prep was guesswork — Mondays were over-prepped, Fridays ran out by 9 p.m.",
      "Zomato, Swiggy and the in-house app each had a separate tablet on the pass.",
    ],
    solution: [
      "Khana AI demand forecast suggests per-item prep quantities each evening for the next day.",
      "Per-brand P&L splits shared ingredient costs by actual usage, not flat percentages.",
      "Unified order screen merges Zomato, Swiggy and the in-house app into one ticket queue.",
    ],
    result: [
      "Over-prep wastage fell by 18% in the first two months.",
      "Average aggregator rating rose to 4.7★ as out-of-stock cancellations dropped sharply.",
      "Owner finally knows which brand to invest in and which to wind down.",
    ],
    quote: {
      text: "Zomato, Swiggy and our own app in one inbox. Khana AI tells us what to prep tomorrow. We've cut wastage in half.",
      name: "Vikram Singh",
      role: "Founder, Hot Tawa Cloud Kitchens",
    },
    rolloutWeeks: 2,
    outlets: 1,
  },
  {
    slug: "coastline-resort",
    icon: Hotel,
    brand: "Coastline Resort",
    location: "Udaipur, IN",
    segment: "Hotel · 80 keys · 4 F&B outlets",
    logoText: "Coastline",
    accent: "from-sky-500/20 to-cyan-500/10",
    title: "F&B and room posting reconciled in real time",
    summary:
      "Coastline migrated its restaurant, bar, banquet and room service onto one platform with live PMS sync. Night audit dropped from 3 hours to under 45 minutes, and banquet billing stopped landing in the wrong folio.",
    heroMetric: { value: "−75%", label: "less night-audit time" },
    metrics: [
      { k: "−75%", v: "night-audit time" },
      { k: "4", v: "outlets connected" },
      { k: "100%", v: "PMS sync" },
    ],
    problem: [
      "Room-charge postings often failed — front office reconciled by hand every morning.",
      "Banquet pre-orders weren't visible to the kitchen until the day of the event.",
      "Four outlets meant four separate end-of-day closures.",
    ],
    solution: [
      "Real-time room-charge posting to the PMS with automatic retries and an exception queue.",
      "Banquet module with linked KOTs so the kitchen sees event covers a week in advance.",
      "One unified night audit across all four outlets, signed off by the duty manager.",
    ],
    result: [
      "Night audit time dropped from 3 hours to under 45 minutes.",
      "Zero unreconciled room postings for 60 days running.",
      "Banquet kitchen prep accuracy up sharply — fewer last-minute scrambles.",
    ],
    quote: {
      text: "Room-charge posting to our PMS just works. Banquet billing, multi-outlet F&B and live P&L in one place — exactly what hotel ops needed.",
      name: "Priya Nair",
      role: "F&B Head, Coastline Resort",
    },
    rolloutWeeks: 4,
    outlets: 4,
  },
  {
    slug: "the-bakehouse",
    icon: Cake,
    brand: "The Bakehouse",
    location: "Delhi, IN",
    segment: "Bakery · 12 outlets",
    logoText: "Bakehouse",
    accent: "from-yellow-500/20 to-amber-500/10",
    title: "Pre-orders, batches and wastage — finally under control",
    summary:
      "The Bakehouse standardised recipes across 12 outlets, batched production by predicted demand, and tied wastage to weekly P&L. Wastage cost halved in two months.",
    heroMetric: { value: "−51%", label: "wastage cost" },
    metrics: [
      { k: "−51%", v: "wastage cost" },
      { k: "12", v: "outlets live" },
      { k: "+2 hrs", v: "saved every morning" },
    ],
    problem: [
      "Each outlet baked the same SKU to a different recipe — and a different cost.",
      "Production was set on gut feel, so wastage ran 9–11% across the network.",
      "Pre-orders, wholesale and walk-ins all had separate workflows.",
    ],
    solution: [
      "One master recipe per SKU with locked ingredient costs and yields.",
      "Production planner that batches by predicted demand for the next 24 hours.",
      "Single POS handling pre-orders, wholesale invoices and walk-in billing.",
    ],
    result: [
      "Wastage cost cut in half within two months.",
      "Production planner saves the head baker about two hours every morning.",
      "Wholesale invoices go out same-day instead of weekly.",
    ],
    quote: {
      text: "Pre-orders, wholesale and walk-ins under one POS. Production planner alone has saved us two hours every morning.",
      name: "Neha Kapoor",
      role: "GM, The Bakehouse",
    },
    rolloutWeeks: 4,
    outlets: 12,
  },
  {
    slug: "brewski-bars",
    icon: TrendingUp,
    brand: "Brewski Bars",
    location: "Pune, IN",
    segment: "Microbrewery & bars · 7 outlets",
    logoText: "Brewski",
    accent: "from-emerald-500/20 to-green-500/10",
    title: "Pour-cost reports caught a leak in week two",
    summary:
      "Brewski's bar managers swore the variance was 'just spillage'. KhanaLagao's pour-cost reports tied each keg to billed pours and flagged a 7% leak in one outlet — paying for the rollout before it even finished.",
    heroMetric: { value: "7%", label: "leak caught in week 2" },
    metrics: [
      { k: "7%", v: "shrinkage caught" },
      { k: "7", v: "outlets unified" },
      { k: "ROI", v: "before full rollout" },
    ],
    problem: [
      "Bar variance was reported as 'normal' but margins kept slipping.",
      "Each outlet measured wastage differently, so no benchmark was possible.",
      "Owners had no live view of pour cost by outlet, shift or bartender.",
    ],
    solution: [
      "Keg-to-pour reconciliation with daily variance alerts above a 2% threshold.",
      "Shift-level pour cost dashboard, comparable across all 7 outlets.",
      "Modifier-aware recipe costing for every cocktail on the menu.",
    ],
    result: [
      "A 7% shrinkage at one outlet was identified and addressed in week two.",
      "Average bar pour cost fell by 2.1 percentage points across the network.",
      "Managers now defend variance with data, not anecdotes.",
    ],
    quote: {
      text: "Pour-cost reports caught a leak in week two. Honestly the system paid for itself before we'd even rolled it out everywhere.",
      name: "Imran Sayed",
      role: "Director, Brewski Bars",
    },
    rolloutWeeks: 3,
    outlets: 7,
  },
];

export function getCaseStudy(slug: string): CaseStudy | undefined {
  return CASE_STUDIES.find((c) => c.slug === slug);
}
