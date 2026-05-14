import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useSocket } from "@/lib/realtime";
import { useRestaurantId } from "@/lib/hooks";
import NotFound from "@/pages/not-found";
import DashboardPage from "@/pages/dashboard";
import OrdersPage from "@/pages/orders";
import KitchenPage from "@/pages/kitchen";
import TablesPage from "@/pages/tables";
import MenuPage from "@/pages/menu";
import InventoryPage from "@/pages/inventory";
import StaffPage from "@/pages/staff";
import CustomersPage from "@/pages/customers";
import ExpensesPage from "@/pages/expenses";
import ReportsPage from "@/pages/reports";
import NotificationsPage from "@/pages/notifications";
import SettingsPage from "@/pages/settings";
import SubscriptionPage from "@/pages/subscription";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import AdminPage from "@/pages/admin";
import PosPage from "@/pages/pos";
import CustomerMenuPage from "@/pages/customer-menu";
import PaymentsPage from "@/pages/payments";
import DuePaymentsPage from "@/pages/due-payments";
import CashRegisterPage from "@/pages/cash-register";
import DeliveryExecutivesPage from "@/pages/delivery-executives";
import CodMonitoringPage from "@/pages/cod-monitoring";
import WaiterRequestsPage from "@/pages/waiter-requests";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10000,
    },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="text-muted-foreground text-sm">Loading…</div></div>;
  if (!isAuthenticated) return <Redirect to="/login" />;
  return <Component />;
}

function RoleProtectedRoute({ component: Component, allow }: { component: React.ComponentType; allow: string[] }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="text-muted-foreground text-sm">Loading…</div></div>;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (!user || (!user.isSuperAdmin && !allow.includes(user.role))) return <Redirect to="/dashboard" />;
  return <Component />;
}

function SuperAdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="text-muted-foreground text-sm">Loading…</div></div>;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (!user?.isSuperAdmin) return <Redirect to="/" />;
  return <Component />;
}

function PublicOnlyRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) {
    if (user?.isSuperAdmin) return <Redirect to="/admin" />;
    return <Redirect to="/dashboard" />;
  }
  return <Component />;
}

function SocketMount() {
  const { isAuthenticated } = useAuth();
  const restaurantId = useRestaurantId();
  useSocket(isAuthenticated ? restaurantId : 0);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={() => <PublicOnlyRoute component={LoginPage} />} />
      <Route path="/register" component={() => <PublicOnlyRoute component={RegisterPage} />} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/admin" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/" component={() => <Redirect to="/dashboard" />} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/pos" component={() => <ProtectedRoute component={PosPage} />} />
      <Route path="/orders" component={() => <ProtectedRoute component={OrdersPage} />} />
      <Route path="/kitchen" component={() => <ProtectedRoute component={KitchenPage} />} />
      <Route path="/tables" component={() => <ProtectedRoute component={TablesPage} />} />
      <Route path="/menu" component={() => <ProtectedRoute component={MenuPage} />} />
      <Route path="/menu-management" component={() => <ProtectedRoute component={MenuPage} />} />
      <Route path="/inventory" component={() => <ProtectedRoute component={InventoryPage} />} />
      <Route path="/payments" component={() => <ProtectedRoute component={PaymentsPage} />} />
      <Route path="/due-payments" component={() => <ProtectedRoute component={DuePaymentsPage} />} />
      <Route path="/cash-register" component={() => <RoleProtectedRoute component={CashRegisterPage} allow={["owner", "manager", "waiter"]} />} />
      <Route path="/staff" component={() => <ProtectedRoute component={StaffPage} />} />
      <Route path="/customers" component={() => <ProtectedRoute component={CustomersPage} />} />
      <Route path="/expenses" component={() => <RoleProtectedRoute component={ExpensesPage} allow={["owner", "manager"]} />} />
      <Route path="/reports" component={() => <Redirect to="/reports/sales" />} />
      <Route path="/reports/:section" component={() => <ProtectedRoute component={ReportsPage} />} />
      <Route path="/delivery/executives" component={() => <RoleProtectedRoute component={DeliveryExecutivesPage} allow={["owner", "manager"]} />} />
      <Route path="/delivery/cod" component={() => <RoleProtectedRoute component={CodMonitoringPage} allow={["owner", "manager"]} />} />
      <Route path="/notifications" component={() => <ProtectedRoute component={NotificationsPage} />} />
      <Route path="/waiter-requests" component={() => <RoleProtectedRoute component={WaiterRequestsPage} allow={["owner", "manager", "waiter"]} />} />
      <Route path="/settings/subscription" component={() => <ProtectedRoute component={SubscriptionPage} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/menu/:slug/:tableId" component={CustomerMenuPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <SocketMount />
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
