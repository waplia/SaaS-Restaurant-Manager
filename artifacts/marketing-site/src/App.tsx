import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/book-demo" component={BookDemo} />
      <Route path="/pricing" component={Pricing} />
      
      <Route path="/features" component={FeaturesIndex} />
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
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
