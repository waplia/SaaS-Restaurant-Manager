import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppSettingsProvider, useAppSettings } from "@/lib/appSettings";

// Pages
import Home from "@/pages/home";
import BookDemo from "@/pages/book-demo";
import Pricing from "@/pages/pricing";
import FeaturesIndex from "@/pages/features/index";
import POSBilling from "@/pages/features/pos-billing";
import QRMenu from "@/pages/features/qr-menu";
import OnlineOrdering from "@/pages/features/online-ordering";
import InventoryManagement from "@/pages/features/inventory-management";
import Payroll from "@/pages/features/payroll";
import Reports from "@/pages/features/reports";
import MultiOutlet from "@/pages/features/multi-outlet";
import FeatureBySlug from "@/pages/features/[slug]";
import SolutionBySlug from "@/pages/solutions/[slug]";
import AIBySlug from "@/pages/khana-ai/[slug]";
import Integrations from "@/pages/integrations";
import Security from "@/pages/security";
import RestaurantTypes from "@/pages/restaurant-types";
import About from "@/pages/about";
import Contact from "@/pages/contact";
import BlogIndex from "@/pages/blog/index";
import BlogPost from "@/pages/blog/[slug]";
import LegalIndex from "@/pages/legal-index";

// New premium pages
import PlatformOverview from "@/pages/platform";
import SolutionsIndex from "@/pages/solutions-index";
import KhanaAIIndex from "@/pages/khana-ai-index";
import Resources from "@/pages/resources";
import Partners from "@/pages/partners";
import Careers from "@/pages/careers";
import HelpCenter from "@/pages/help";
import Guides from "@/pages/guides";
import FAQ from "@/pages/faq";
import Compare from "@/pages/compare";
import CaseStudies from "@/pages/case-studies";
import ThankYou from "@/pages/thank-you";

// Legal
import PrivacyPolicy from "@/pages/legal/privacy-policy";
import Terms from "@/pages/legal/terms";
import RefundPolicy from "@/pages/legal/refund-policy";
import CookiePolicy from "@/pages/legal/cookie-policy";
import DPA from "@/pages/legal/data-processing-agreement";
import AUP from "@/pages/legal/acceptable-use-policy";

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

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeOrDisabled} />
      <Route path="/book-demo" component={BookDemoOrDisabled} />
      <Route path="/start-free-trial" component={BookDemoOrDisabled} />
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
