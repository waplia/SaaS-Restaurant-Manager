import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSettingsProvider, useAppSettings } from "@/lib/appSettings";

// Eagerly loaded: homepage (critical) + not-found (tiny fallback).
import Home from "@/pages/home";
import NotFound from "@/pages/not-found";

// Everything else is lazy-loaded so the homepage doesn't pay for it.
const BookDemo = lazy(() => import("@/pages/book-demo"));
const Pricing = lazy(() => import("@/pages/pricing"));
const FeaturesIndex = lazy(() => import("@/pages/features/index"));
const POSBilling = lazy(() => import("@/pages/features/pos-billing"));
const QRMenu = lazy(() => import("@/pages/features/qr-menu"));
const OnlineOrdering = lazy(() => import("@/pages/features/online-ordering"));
const InventoryManagement = lazy(() => import("@/pages/features/inventory-management"));
const Payroll = lazy(() => import("@/pages/features/payroll"));
const Reports = lazy(() => import("@/pages/features/reports"));
const MultiOutlet = lazy(() => import("@/pages/features/multi-outlet"));
const FeatureBySlug = lazy(() => import("@/pages/features/[slug]"));
const SolutionBySlug = lazy(() => import("@/pages/solutions/[slug]"));
const AIBySlug = lazy(() => import("@/pages/khana-ai/[slug]"));
const Integrations = lazy(() => import("@/pages/integrations"));
const Security = lazy(() => import("@/pages/security"));
const RestaurantTypes = lazy(() => import("@/pages/restaurant-types"));
const About = lazy(() => import("@/pages/about"));
const Contact = lazy(() => import("@/pages/contact"));
const BlogIndex = lazy(() => import("@/pages/blog/index"));
const BlogPost = lazy(() => import("@/pages/blog/[slug]"));
const LegalIndex = lazy(() => import("@/pages/legal-index"));

const PlatformOverview = lazy(() => import("@/pages/platform"));
const SolutionsIndex = lazy(() => import("@/pages/solutions-index"));
const KhanaAIIndex = lazy(() => import("@/pages/khana-ai-index"));
const Resources = lazy(() => import("@/pages/resources"));
const Partners = lazy(() => import("@/pages/partners"));
const Careers = lazy(() => import("@/pages/careers"));
const HelpCenter = lazy(() => import("@/pages/help"));
const Guides = lazy(() => import("@/pages/guides"));
const FAQ = lazy(() => import("@/pages/faq"));
const Compare = lazy(() => import("@/pages/compare"));
const CaseStudies = lazy(() => import("@/pages/case-studies"));
const CaseStudyDetail = lazy(() => import("@/pages/case-studies/[slug]"));
const ThankYou = lazy(() => import("@/pages/thank-you"));

const PrivacyPolicy = lazy(() => import("@/pages/legal/privacy-policy"));
const Terms = lazy(() => import("@/pages/legal/terms"));
const RefundPolicy = lazy(() => import("@/pages/legal/refund-policy"));
const CookiePolicy = lazy(() => import("@/pages/legal/cookie-policy"));
const DPA = lazy(() => import("@/pages/legal/data-processing-agreement"));
const AUP = lazy(() => import("@/pages/legal/acceptable-use-policy"));

const queryClient = new QueryClient();

function HomeOrDisabled() {
  const settings = useAppSettings();
  if (!settings.landingPageEnabled) {
    if (typeof window !== "undefined") {
      window.location.replace("/app/login");
    }
    return null;
  }
  return <Home />;
}

function BookDemoOrDisabled() {
  return <BookDemo />;
}

function StartFreeTrialRedirect() {
  if (typeof window !== "undefined") {
    window.location.replace("/app/register");
  }
  return null;
}

function RouteFallback() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={HomeOrDisabled} />
        <Route path="/book-demo" component={BookDemoOrDisabled} />
        <Route path="/start-free-trial" component={StartFreeTrialRedirect} />
        <Route path="/thank-you" component={ThankYou} />
        <Route path="/pricing" component={Pricing} />

        {/* Platform */}
        <Route path="/platform" component={PlatformOverview} />

        {/* Features directory + existing dedicated feature pages */}
        <Route path="/features" component={FeaturesIndex} />
        <Route path="/pos-billing" component={POSBilling} />
        <Route path="/qr-menu" component={QRMenu} />
        <Route path="/online-ordering" component={OnlineOrdering} />
        <Route path="/inventory-management" component={InventoryManagement} />
        <Route path="/payroll" component={Payroll} />
        <Route path="/reports" component={Reports} />
        <Route path="/multi-outlet" component={MultiOutlet} />
        <Route path="/features/pos-billing" component={POSBilling} />
        <Route path="/features/qr-menu" component={QRMenu} />
        <Route path="/features/online-ordering" component={OnlineOrdering} />
        <Route path="/features/inventory-management" component={InventoryManagement} />
        <Route path="/features/payroll" component={Payroll} />
        <Route path="/features/reports" component={Reports} />
        <Route path="/features/multi-outlet" component={MultiOutlet} />
        <Route path="/features/:slug" component={FeatureBySlug} />

        {/* Solutions */}
        <Route path="/solutions" component={SolutionsIndex} />
        <Route path="/solutions/:slug" component={SolutionBySlug} />

        {/* Khana AI */}
        <Route path="/khana-ai" component={KhanaAIIndex} />
        <Route path="/khana-ai/:slug" component={AIBySlug} />

        <Route path="/integrations" component={Integrations} />
        <Route path="/security" component={Security} />
        <Route path="/restaurant-types/:type" component={RestaurantTypes} />
        <Route path="/about" component={About} />
        <Route path="/contact" component={Contact} />

        <Route path="/blog" component={BlogIndex} />
        <Route path="/blog/:slug" component={BlogPost} />

        {/* Resources & company hubs */}
        <Route path="/resources" component={Resources} />
        <Route path="/help" component={HelpCenter} />
        <Route path="/guides" component={Guides} />
        <Route path="/faq" component={FAQ} />
        <Route path="/compare" component={Compare} />
        <Route path="/case-studies" component={CaseStudies} />
        <Route path="/case-studies/:slug" component={CaseStudyDetail} />
        <Route path="/partners" component={Partners} />
        <Route path="/careers" component={Careers} />

        {/* Legal */}
        <Route path="/legal" component={LegalIndex} />
        <Route path="/privacy-policy" component={PrivacyPolicy} />
        <Route path="/terms" component={Terms} />
        <Route path="/refund-policy" component={RefundPolicy} />
        <Route path="/cookie-policy" component={CookiePolicy} />
        <Route path="/data-processing-agreement" component={DPA} />
        <Route path="/acceptable-use-policy" component={AUP} />

        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppSettingsProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AppSettingsProvider>
    </QueryClientProvider>
  );
}

export default App;
