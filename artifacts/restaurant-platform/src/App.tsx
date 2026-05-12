import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import NotFound from "@/pages/not-found";
import DashboardPage from "@/pages/dashboard";
import OrdersPage from "@/pages/orders";
import KitchenPage from "@/pages/kitchen";
import TablesPage from "@/pages/tables";
import MenuPage from "@/pages/menu";
import InventoryPage from "@/pages/inventory";
import StaffPage from "@/pages/staff";
import CustomersPage from "@/pages/customers";
import ReportsPage from "@/pages/reports";
import NotificationsPage from "@/pages/notifications";
import SettingsPage from "@/pages/settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10000,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/orders" component={OrdersPage} />
      <Route path="/kitchen" component={KitchenPage} />
      <Route path="/tables" component={TablesPage} />
      <Route path="/menu" component={MenuPage} />
      <Route path="/inventory" component={InventoryPage} />
      <Route path="/staff" component={StaffPage} />
      <Route path="/customers" component={CustomersPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
