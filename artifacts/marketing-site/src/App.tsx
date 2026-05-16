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
import ComingSoon, { ComingSoonPage } from "@/pages/coming-soon";
import LegalIndex from "@/pages/legal-index";

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
  const s = useAppSettings();
  if (!s.demoModeEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">Demo bookings are paused</h1>
          <p className="text-muted-foreground">Please check back soon or contact support.</p>
          {s.supportEmail && (
            <a href={`mailto:${s.supportEmail}`} className="text-sm text-primary underline">
              {s.supportEmail}
            </a>
          )}
        </div>
      </div>
    );
  }
  return <BookDemo />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeOrDisabled} />
      <Route path="/book-demo" component={BookDemoOrDisabled} />
      <Route path="/start-free-trial" component={BookDemoOrDisabled} />
      <Route path="/pricing" component={Pricing} />

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
      {/* Generic feature detail fallback (uses content/features.ts) */}
      <Route path="/features/:slug" component={FeatureBySlug} />

      {/* Solutions */}
      <Route path="/solutions">
        <ComingSoonPage
          title="Solutions for every kind of restaurant"
          description="Browse our full solutions directory — restaurants, cafes, cloud kitchens, bakeries, hotels and more."
          eyebrow="Solutions"
        />
      </Route>
      <Route path="/solutions/:slug" component={SolutionBySlug} />

      {/* Khana AI */}
      <Route path="/khana-ai">
        <ComingSoonPage
          title="Khana AI — your AI co-pilot for restaurants"
          description="AI menu import, review boosters, smart campaigns, sales insights, forecasting and an AI chat assistant."
          eyebrow="Khana AI"
        />
      </Route>
      <Route path="/khana-ai/:slug" component={AIBySlug} />

      {/* Platform overview placeholder */}
      <Route path="/platform">
        <ComingSoonPage
          title="The complete KhanaLagao platform"
          description="One restaurant OS that connects POS, kitchen, inventory, growth, staff, finance and Khana AI."
          eyebrow="Platform"
        />
      </Route>

      <Route path="/integrations" component={Integrations} />
      <Route path="/security" component={Security} />
      <Route path="/restaurant-types/:type" component={RestaurantTypes} />
      <Route path="/about" component={About} />
      <Route path="/contact" component={Contact} />

      <Route path="/blog" component={BlogIndex} />
      <Route path="/blog/:slug" component={BlogPost} />

      {/* Resources / Company stubs — kept reachable to avoid broken header links */}
      <Route path="/resources" component={ComingSoon} />
      <Route path="/help" component={ComingSoon} />
      <Route path="/guides" component={ComingSoon} />
      <Route path="/faq" component={ComingSoon} />
      <Route path="/compare" component={ComingSoon} />
      <Route path="/case-studies" component={ComingSoon} />
      <Route path="/partners" component={ComingSoon} />
      <Route path="/careers" component={ComingSoon} />

      {/* Legal */}
      <Route path="/legal" component={LegalIndex} />
      <Route path="/privacy-policy" component={ComingSoon} />
      <Route path="/terms" component={ComingSoon} />
      <Route path="/refund-policy" component={ComingSoon} />
      <Route path="/cookie-policy" component={ComingSoon} />
      <Route path="/data-processing-agreement" component={ComingSoon} />
      <Route path="/acceptable-use-policy" component={ComingSoon} />

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
