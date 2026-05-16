import { useSeo } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { HeroSection } from "@/components/home/HeroSection";
import { TrustStrip } from "@/components/home/TrustStrip";
import { ProblemSection } from "@/components/home/ProblemSection";
import { SolutionSection } from "@/components/home/SolutionSection";
import { PlatformModules } from "@/components/home/PlatformModules";
import { KhanaAIHighlight } from "@/components/home/KhanaAIHighlight";
import { GrowthEngineSection } from "@/components/home/GrowthEngineSection";
import { FinanceSection } from "@/components/home/FinanceSection";
import { IndustrySolutions } from "@/components/home/IndustrySolutions";
import { MultiOutletSection } from "@/components/home/MultiOutletSection";
import { MarketplaceSection } from "@/components/home/MarketplaceSection";
import { ReportsSection } from "@/components/home/ReportsSection";
import { WhyChooseUs } from "@/components/home/WhyChooseUs";
import { PricingPreview } from "@/components/home/PricingPreview";
import { Testimonials } from "@/components/home/Testimonials";
import { HomeFAQ } from "@/components/home/HomeFAQ";
import { FinalCTA } from "@/components/home/FinalCTA";

export default function Home() {
  useSeo({
    title: "Khana Lagao | Run Your Restaurant Smarter with One Powerful Operating System",
    description:
      "POS, QR menu, KOT, tables, inventory, payroll, finance, growth and Khana AI — one connected operating system for restaurants, cafes, cloud kitchens, bakeries, bars, hotels and chains.",
  });

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <Header />
      <main className="flex-grow">
        <HeroSection />
        <TrustStrip />
        <ProblemSection />
        <SolutionSection />
        <PlatformModules />
        <KhanaAIHighlight />
        <GrowthEngineSection />
        <FinanceSection />
        <IndustrySolutions />
        <MultiOutletSection />
        <MarketplaceSection />
        <ReportsSection />
        <WhyChooseUs />
        <PricingPreview />
        <Testimonials />
        <HomeFAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
