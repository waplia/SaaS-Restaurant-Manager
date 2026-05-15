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
import Integrations from "@/pages/integrations";
import Security from "@/pages/security";
import RestaurantTypes from "@/pages/restaurant-types";
import About from "@/pages/about";
import Contact from "@/pages/contact";
import BlogIndex from "@/pages/blog/index";
import BlogPost from "@/pages/blog/[slug]";

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
      <Route path="/pricing" component={Pricing} />
      
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
      
      <Route path="/integrations" component={Integrations} />
      <Route path="/security" component={Security} />
      <Route path="/restaurant-types/:type" component={RestaurantTypes} />
      <Route path="/about" component={About} />
      <Route path="/contact" component={Contact} />
      
      <Route path="/blog" component={BlogIndex} />
      <Route path="/blog/:slug" component={BlogPost} />

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
