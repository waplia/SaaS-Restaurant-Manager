import { lazy, Suspense } from "react";
import { useSeo } from "@/lib/seo";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { LazyMount } from "@/components/shared/LazyMount";

// Eager: above-the-fold pieces so the hero paints immediately.
import { HeroSection } from "@/components/home/HeroSection";
import { TrustStrip } from "@/components/home/TrustStrip";
import { ProblemSection } from "@/components/home/ProblemSection";

// Deferred: every below-the-fold section lives in its own chunk and is mounted
// only when it scrolls into view, so it stays out of the initial JS payload
// and doesn't run animations or render expensive subtrees on first paint.
const SolutionSection = lazy(() => import("@/components/home/SolutionSection").then(m => ({ default: m.SolutionSection })));
const ProductTour = lazy(() => import("@/components/home/ProductTour").then(m => ({ default: m.ProductTour })));
const WorkflowDiagram = lazy(() => import("@/components/home/WorkflowDiagram").then(m => ({ default: m.WorkflowDiagram })));
const ComparisonStrip = lazy(() => import("@/components/home/ComparisonStrip").then(m => ({ default: m.ComparisonStrip })));
const PlatformModules = lazy(() => import("@/components/home/PlatformModules").then(m => ({ default: m.PlatformModules })));
const KhanaAIHighlight = lazy(() => import("@/components/home/KhanaAIHighlight").then(m => ({ default: m.KhanaAIHighlight })));
const GrowthEngineSection = lazy(() => import("@/components/home/GrowthEngineSection").then(m => ({ default: m.GrowthEngineSection })));
const FinanceSection = lazy(() => import("@/components/home/FinanceSection").then(m => ({ default: m.FinanceSection })));
const IndustrySolutions = lazy(() => import("@/components/home/IndustrySolutions").then(m => ({ default: m.IndustrySolutions })));
const MultiOutletSection = lazy(() => import("@/components/home/MultiOutletSection").then(m => ({ default: m.MultiOutletSection })));
const MarketplaceSection = lazy(() => import("@/components/home/MarketplaceSection").then(m => ({ default: m.MarketplaceSection })));
const ReportsSection = lazy(() => import("@/components/home/ReportsSection").then(m => ({ default: m.ReportsSection })));
const WhyChooseUs = lazy(() => import("@/components/home/WhyChooseUs").then(m => ({ default: m.WhyChooseUs })));
const PricingPreview = lazy(() => import("@/components/home/PricingPreview").then(m => ({ default: m.PricingPreview })));
const Testimonials = lazy(() => import("@/components/home/Testimonials").then(m => ({ default: m.Testimonials })));
const HomeFAQ = lazy(() => import("@/components/home/HomeFAQ").then(m => ({ default: m.HomeFAQ })));
const FinalCTA = lazy(() => import("@/components/home/FinalCTA").then(m => ({ default: m.FinalCTA })));

function Deferred({ children, minHeight = 320 }: { children: React.ReactNode; minHeight?: number }) {
  return (
    <LazyMount minHeight={minHeight}>
      <Suspense fallback={<div style={{ minHeight }} />}>{children}</Suspense>
    </LazyMount>
  );
}

export default function Home() {
  useSeo({
    title: "KhanaLagao | Restaurant OS for Modern Food Businesses",
    description:
      "KhanaLagao is a complete restaurant operating system for POS billing, QR menu, kitchen/KDS, inventory, payroll, finance, growth, reports and Khana AI.",
  });

  return (
    <SiteLayout>
      <div>
        <HeroSection />
        <TrustStrip />
        <ProblemSection />
        <Deferred><SolutionSection /></Deferred>
        <Deferred minHeight={600}><ProductTour /></Deferred>
        <Deferred><WorkflowDiagram /></Deferred>
        <Deferred><PlatformModules /></Deferred>
        <Deferred><KhanaAIHighlight /></Deferred>
        <Deferred><GrowthEngineSection /></Deferred>
        <Deferred><FinanceSection /></Deferred>
        <Deferred><IndustrySolutions /></Deferred>
        <Deferred><MultiOutletSection /></Deferred>
        <Deferred><MarketplaceSection /></Deferred>
        <Deferred><ReportsSection /></Deferred>
        <Deferred><WhyChooseUs /></Deferred>
        <Deferred><ComparisonStrip /></Deferred>
        <Deferred minHeight={600}><PricingPreview /></Deferred>
        <Deferred><Testimonials /></Deferred>
        <Deferred><HomeFAQ /></Deferred>
        <Deferred minHeight={240}><FinalCTA /></Deferred>
      </div>
    </SiteLayout>
  );
}
