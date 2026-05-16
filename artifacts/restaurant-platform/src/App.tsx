import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { BranchProvider } from "@/lib/branch";
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
import WastePage from "@/pages/waste";
import CompliancePage from "@/pages/compliance";
import CloudKitchenPage from "@/pages/cloud-kitchen";
import PayrollPage from "@/pages/payroll";
import ReportsPage from "@/pages/reports";
import NotificationsPage from "@/pages/notifications";
import SettingsPage from "@/pages/settings";
import SettingsSectionPage from "@/pages/settings-section";
import SettingsKitchensPage from "@/pages/settings-kitchens";
import SettingsDevicesPage from "@/pages/settings-devices";
import SettingsTokenDisplayPage from "@/pages/settings-token-display";
import TokensPage from "@/pages/tokens";
import TokensHistoryPage from "@/pages/tokens-history";
import DisplayTokenPage from "@/pages/display-token";
import SubscriptionPage from "@/pages/subscription";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import OnboardingPage from "@/pages/onboarding";
import SetupWizardPage from "@/pages/setup-wizard";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import AdminPage from "@/pages/admin";
import AdminLeadsPage from "@/pages/admin-leads";
import MarketplacePage from "@/pages/marketplace";
import AdminAddonsPage from "@/pages/admin-addons";
import AdminAuditLogsPage from "@/pages/admin-audit-logs";
import AdminBlogPage from "@/pages/admin-blog";
import AdminSupportPage from "@/pages/admin-support";
import SupportPage from "@/pages/support";
import SystemHealthPage from "@/pages/system-health";
import AdminApiSettingsPage from "@/pages/admin-api-settings";
import ApiKeysPage from "@/pages/api-keys";
import AccountingLandingPage from "@/pages/settings-accounting";
import AccountingTargetPage from "@/pages/settings-accounting-target";
import WebhooksPage from "@/pages/webhooks";
import WebhookLogsPage from "@/pages/webhook-logs";
import ApiLogsPage from "@/pages/api-logs";
import DeveloperDocsPage from "@/pages/developer-docs";
import AdminSettingsPage from "@/pages/admin-settings";
import { AppSettingsProvider } from "@/lib/appSettings";
import PosPage from "@/pages/pos";
import HotelPage from "@/pages/hotel";
import CustomerMenuPage from "@/pages/customer-menu";
import PaymentsPage from "@/pages/payments";
import DuePaymentsPage from "@/pages/due-payments";
import CashRegisterPage from "@/pages/cash-register";
import DeliveryExecutivesPage from "@/pages/delivery-executives";
import CodMonitoringPage from "@/pages/cod-monitoring";
import WaiterRequestsPage from "@/pages/waiter-requests";
import ReservationsPage from "@/pages/reservations";
const EventsPage = lazy(() => import("@/pages/events"));
import BakeryPage from "@/pages/bakery";
import PublicBookingPage from "@/pages/public-booking";
import PublicSitePage from "@/pages/public-site";
import AiDashboardPage from "@/pages/ai-dashboard";
import AiDescriptionsPage from "@/pages/ai-descriptions";
import AiImagesPage from "@/pages/ai-images";
import AiInventoryPage from "@/pages/ai-inventory";
import AiUpsellPage from "@/pages/ai-upsell";
import AiForecastPage from "@/pages/ai-forecast";
import AiSalesInsightsPage from "@/pages/ai-sales-insights";
import AiStaffInsightsPage from "@/pages/ai-staff-insights";
import AiMenuImportPage from "@/pages/ai-menu-import";
import AiMenuImportHistoryPage from "@/pages/ai-menu-import-history";
import AiUsagePage from "@/pages/ai-usage";
import AiSettingsPage from "@/pages/ai-settings";
import ReviewQrsPage from "@/pages/review-qrs";
import AiReviewRepliesPage from "@/pages/ai-review-replies";
import FeedbackRecoveryPage from "@/pages/feedback-recovery";
import FeedbackWallPage from "@/pages/feedback-wall";
import PublicFeedbackWallPage from "@/pages/public-feedback-wall";
import CustomerFeedbackPage from "@/pages/customer-feedback";
import FraudAlertsPage from "@/pages/fraud-alerts";
import PricingOptimizerPage from "@/pages/pricing-optimizer";
import PricingRulesPage from "@/pages/pricing-rules";
import GrowthEnginePage from "@/pages/growth-engine";
import DocumentsPage from "@/pages/documents";
import WalletsPage from "@/pages/wallets";
import SettlementReconPage from "@/pages/settlement-recon";
import AggregatorReconPage from "@/pages/aggregator-recon";
import CapitalInsurancePage from "@/pages/capital-insurance";
import AdminFintechPage from "@/pages/admin-fintech";
import HealthScorePage from "@/pages/health-score";
import SustainabilityPage from "@/pages/sustainability";
import SopTrainingPage from "@/pages/sop-training";
import MyTrainingPage from "@/pages/my-training";
import PortalHomePage from "@/pages/portal";
import PortalAttendancePage from "@/pages/portal/attendance";
import PortalShiftsPage from "@/pages/portal/shifts";
import PortalLeavesPage from "@/pages/portal/leaves";
import PortalPayrollPage from "@/pages/portal/payroll";
import PortalTasksPage from "@/pages/portal/tasks";
import PortalAnnouncementsPage from "@/pages/portal/announcements";
import PortalScorecardPage from "@/pages/portal/scorecard";
import PortalIncentivesPage from "@/pages/portal/incentives";
import PortalDocumentsPage from "@/pages/portal/documents";
import PortalHelpPage from "@/pages/portal/help";
import PortalTrainingPage from "@/pages/portal/training";
import FoodCourtsPage from "@/pages/food-courts";
import FoodCourtVendorsPage from "@/pages/food-court-vendors";
import FoodCourtPosPage from "@/pages/food-court-pos";
import FoodCourtOverviewPage from "@/pages/food-court-overview";
import FoodCourtTokensPage from "@/pages/food-court-tokens";
import FoodCourtSettlementsPage from "@/pages/food-court-settlements";
import FoodCourtReportsPage from "@/pages/food-court-reports";
import FoodCourtMyCounterPage from "@/pages/food-court-my-counter";
import MembershipsPage from "@/pages/memberships";
import TiffinPlansPage from "@/pages/tiffin-plans";
import TiffinSubscriptionsPage from "@/pages/tiffin-subscriptions";
import TiffinDeliveriesPage from "@/pages/tiffin-deliveries";
import TiffinBillingPage from "@/pages/tiffin-billing";
import TiffinCustomerHistoryPage from "@/pages/tiffin-customer-history";

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

// Roles whose default landing page is the staff portal rather than the
// admin dashboard. Owner/manager keep going to /dashboard.
const PORTAL_ROLES = ["waiter", "kitchen", "cashier", "delivery_executive"];

function PublicOnlyRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) {
    if (user?.isSuperAdmin) return <Redirect to="/admin" />;
    if (user?.role && PORTAL_ROLES.includes(user.role)) return <Redirect to="/portal" />;
    return <Redirect to="/dashboard" />;
  }
  return <Component />;
}

function RootRedirect() {
  const { user, isLoading, isAuthenticated } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (user?.isSuperAdmin) return <Redirect to="/admin" />;
  if (user?.role && PORTAL_ROLES.includes(user.role)) return <Redirect to="/portal" />;
  return <Redirect to="/dashboard" />;
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
      <Route path="/admin/leads" component={() => <SuperAdminRoute component={AdminLeadsPage} />} />
      <Route path="/admin/audit-logs" component={() => <SuperAdminRoute component={AdminAuditLogsPage} />} />
      <Route path="/admin/blog" component={() => <SuperAdminRoute component={AdminBlogPage} />} />
      <Route path="/admin/support" component={() => <SuperAdminRoute component={AdminSupportPage} />} />
      <Route path="/support" component={() => <RoleProtectedRoute component={SupportPage} allow={["owner", "manager"]} />} />
      <Route path="/sop-training" component={() => <RoleProtectedRoute component={SopTrainingPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/my-training" component={() => <ProtectedRoute component={MyTrainingPage} />} />
      <Route path="/admin/system-health" component={() => <SuperAdminRoute component={SystemHealthPage} />} />
      <Route path="/admin/settings" component={() => <SuperAdminRoute component={AdminSettingsPage} />} />
      <Route path="/admin/addons" component={() => <SuperAdminRoute component={AdminAddonsPage} />} />
      <Route path="/marketplace" component={() => <RoleProtectedRoute component={MarketplacePage} allow={["owner", "manager"]} />} />
      <Route path="/onboarding" component={() => <ProtectedRoute component={OnboardingPage} />} />
      <Route path="/setup-wizard" component={() => <ProtectedRoute component={SetupWizardPage} />} />
      <Route path="/setup" component={() => <Redirect to="/setup-wizard" />} />
      <Route path="/" component={RootRedirect} />
      <Route path="/portal" component={() => <ProtectedRoute component={PortalHomePage} />} />
      <Route path="/portal/attendance" component={() => <ProtectedRoute component={PortalAttendancePage} />} />
      <Route path="/portal/shifts" component={() => <ProtectedRoute component={PortalShiftsPage} />} />
      <Route path="/portal/leaves" component={() => <ProtectedRoute component={PortalLeavesPage} />} />
      <Route path="/portal/payroll" component={() => <ProtectedRoute component={PortalPayrollPage} />} />
      <Route path="/portal/tasks" component={() => <ProtectedRoute component={PortalTasksPage} />} />
      <Route path="/portal/training" component={() => <ProtectedRoute component={PortalTrainingPage} />} />
      <Route path="/portal/announcements" component={() => <ProtectedRoute component={PortalAnnouncementsPage} />} />
      <Route path="/portal/scorecard" component={() => <ProtectedRoute component={PortalScorecardPage} />} />
      <Route path="/portal/incentives" component={() => <ProtectedRoute component={PortalIncentivesPage} />} />
      <Route path="/portal/documents" component={() => <ProtectedRoute component={PortalDocumentsPage} />} />
      <Route path="/portal/help" component={() => <ProtectedRoute component={PortalHelpPage} />} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/documents" component={() => <ProtectedRoute component={DocumentsPage} />} />
      <Route path="/pos" component={() => <ProtectedRoute component={PosPage} />} />
      <Route path="/hotel" component={() => <RoleProtectedRoute component={HotelPage} allow={["owner", "manager", "cashier", "waiter", "kitchen", "staff"]} />} />
      <Route path="/orders" component={() => <ProtectedRoute component={OrdersPage} />} />
      <Route path="/kitchen" component={() => <ProtectedRoute component={KitchenPage} />} />
      <Route path="/tables" component={() => <ProtectedRoute component={TablesPage} />} />
      <Route path="/menu" component={() => <ProtectedRoute component={MenuPage} />} />
      <Route path="/menu-management" component={() => <ProtectedRoute component={MenuPage} />} />
      <Route path="/menu/pricing-optimizer" component={() => <RoleProtectedRoute component={PricingOptimizerPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/pricing-rules" component={() => <RoleProtectedRoute component={PricingRulesPage} allow={["owner", "manager"]} />} />
      <Route path="/growth" component={() => <RoleProtectedRoute component={GrowthEnginePage} allow={["owner", "manager"]} />} />
      <Route path="/inventory" component={() => <ProtectedRoute component={InventoryPage} />} />
      <Route path="/payments" component={() => <ProtectedRoute component={PaymentsPage} />} />
      <Route path="/due-payments" component={() => <ProtectedRoute component={DuePaymentsPage} />} />
      <Route path="/cash-register" component={() => <RoleProtectedRoute component={CashRegisterPage} allow={["owner", "manager", "waiter"]} />} />
      <Route path="/staff" component={() => <ProtectedRoute component={StaffPage} />} />
      <Route path="/customers" component={() => <ProtectedRoute component={CustomersPage} />} />
      <Route path="/expenses" component={() => <RoleProtectedRoute component={ExpensesPage} allow={["owner", "manager"]} />} />
      <Route path="/waste" component={() => <RoleProtectedRoute component={WastePage} allow={["owner", "manager", "kitchen", "waiter", "cashier"]} />} />
      <Route path="/compliance" component={() => <RoleProtectedRoute component={CompliancePage} allow={["owner", "manager"]} />} />
      <Route path="/cloud-kitchen" component={() => <RoleProtectedRoute component={CloudKitchenPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/payroll" component={() => <RoleProtectedRoute component={PayrollPage} allow={["owner"]} />} />
      <Route path="/wallets" component={() => <RoleProtectedRoute component={WalletsPage} allow={["owner", "manager"]} />} />
      <Route path="/settlements" component={() => <RoleProtectedRoute component={SettlementReconPage} allow={["owner", "manager", "cashier"]} />} />
      <Route path="/aggregator-payouts" component={() => <RoleProtectedRoute component={AggregatorReconPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/capital" component={() => <RoleProtectedRoute component={CapitalInsurancePage} allow={["owner", "manager"]} />} />
      <Route path="/admin/fintech" component={() => <SuperAdminRoute component={AdminFintechPage} />} />
      <Route path="/reports" component={() => <Redirect to="/reports/sales" />} />
      <Route path="/reports/fraud-alerts" component={() => <RoleProtectedRoute component={FraudAlertsPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/reports/health-score" component={() => <RoleProtectedRoute component={HealthScorePage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/sustainability" component={() => <RoleProtectedRoute component={SustainabilityPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/reports/:section" component={() => <ProtectedRoute component={ReportsPage} />} />
      <Route path="/delivery/executives" component={() => <RoleProtectedRoute component={DeliveryExecutivesPage} allow={["owner", "manager"]} />} />
      <Route path="/tiffin/plans" component={() => <RoleProtectedRoute component={TiffinPlansPage} allow={["owner", "manager"]} />} />
      <Route path="/tiffin/subscriptions" component={() => <RoleProtectedRoute component={TiffinSubscriptionsPage} allow={["owner", "manager", "cashier"]} />} />
      <Route path="/tiffin/deliveries" component={() => <RoleProtectedRoute component={TiffinDeliveriesPage} allow={["owner", "manager", "delivery_executive"]} />} />
      <Route path="/tiffin/billing" component={() => <RoleProtectedRoute component={TiffinBillingPage} allow={["owner", "manager"]} />} />
      <Route path="/tiffin/customers" component={() => <RoleProtectedRoute component={TiffinCustomerHistoryPage} allow={["owner", "manager"]} />} />
      <Route path="/delivery/cod" component={() => <RoleProtectedRoute component={CodMonitoringPage} allow={["owner", "manager"]} />} />
      <Route path="/notifications" component={() => <ProtectedRoute component={NotificationsPage} />} />
      <Route path="/waiter-requests" component={() => <RoleProtectedRoute component={WaiterRequestsPage} allow={["owner", "manager", "waiter"]} />} />
      <Route path="/settings/subscription" component={() => <RoleProtectedRoute component={SubscriptionPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/kitchens" component={() => <RoleProtectedRoute component={SettingsKitchensPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/devices" component={() => <RoleProtectedRoute component={SettingsDevicesPage} allow={["owner", "manager", "cashier", "waiter", "kitchen"]} />} />
      <Route path="/settings/token-display" component={() => <RoleProtectedRoute component={SettingsTokenDisplayPage} allow={["owner", "manager"]} />} />
      <Route path="/tokens" component={() => <RoleProtectedRoute component={TokensPage} allow={["owner", "manager", "waiter", "cashier", "kitchen"]} />} />
      <Route path="/tokens/history" component={() => <RoleProtectedRoute component={TokensHistoryPage} allow={["owner", "manager", "waiter", "cashier", "kitchen"]} />} />
      <Route path="/display/token/:outletId" component={DisplayTokenPage} />
      <Route path="/settings/api-keys" component={() => <RoleProtectedRoute component={ApiKeysPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/accounting" component={() => <RoleProtectedRoute component={AccountingLandingPage} allow={["owner", "manager", "accountant"]} />} />
      <Route path="/settings/accounting/:target" component={() => <RoleProtectedRoute component={AccountingTargetPage} allow={["owner", "manager", "accountant"]} />} />
      <Route path="/settings/webhooks" component={() => <RoleProtectedRoute component={WebhooksPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/webhook-logs" component={() => <RoleProtectedRoute component={WebhookLogsPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/api-logs" component={() => <RoleProtectedRoute component={ApiLogsPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/developer-docs" component={() => <RoleProtectedRoute component={DeveloperDocsPage} allow={["owner", "manager"]} />} />
      <Route path="/admin/api-settings" component={() => <SuperAdminRoute component={AdminApiSettingsPage} />} />
      <Route path="/settings/:section" component={() => <RoleProtectedRoute component={SettingsSectionPage} allow={["owner", "manager"]} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/reservations" component={() => <ProtectedRoute component={ReservationsPage} />} />
      <Route path="/events" component={() => <Suspense fallback={null}><RoleProtectedRoute component={EventsPage} allow={["owner", "manager", "waiter", "kitchen"]} /></Suspense>} />
      <Route path="/bakery" component={() => <RoleProtectedRoute component={BakeryPage} allow={["owner", "manager", "waiter", "kitchen", "cashier"]} />} />
      <Route path="/ai" component={() => <RoleProtectedRoute component={AiDashboardPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/descriptions" component={() => <RoleProtectedRoute component={AiDescriptionsPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/images" component={() => <RoleProtectedRoute component={AiImagesPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/inventory" component={() => <RoleProtectedRoute component={AiInventoryPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/upsell" component={() => <RoleProtectedRoute component={AiUpsellPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/forecast" component={() => <RoleProtectedRoute component={AiForecastPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/insights" component={() => <RoleProtectedRoute component={AiSalesInsightsPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/staff-insights" component={() => <RoleProtectedRoute component={AiStaffInsightsPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/menu-import/history" component={() => <RoleProtectedRoute component={AiMenuImportHistoryPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/menu-import/:id" component={() => <RoleProtectedRoute component={AiMenuImportPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/menu-import" component={() => <RoleProtectedRoute component={AiMenuImportPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/usage" component={() => <RoleProtectedRoute component={AiUsagePage} allow={["owner", "manager"]} />} />
      <Route path="/ai/settings" component={() => <RoleProtectedRoute component={AiSettingsPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/review-qrs" component={() => <RoleProtectedRoute component={ReviewQrsPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/review-replies" component={() => <RoleProtectedRoute component={AiReviewRepliesPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/feedback-recovery" component={() => <RoleProtectedRoute component={FeedbackRecoveryPage} allow={["owner", "manager"]} />} />
      <Route path="/ai/feedback-wall" component={() => <RoleProtectedRoute component={FeedbackWallPage} allow={["owner", "manager"]} />} />
      <Route path="/wall/:slug" component={PublicFeedbackWallPage} />
      <Route path="/food-courts" component={() => <RoleProtectedRoute component={FoodCourtsPage} allow={["owner", "manager", "food_court_owner"]} />} />
      <Route path="/food-court/:id/overview" component={() => <RoleProtectedRoute component={FoodCourtOverviewPage} allow={["owner", "manager", "food_court_owner"]} />} />
      <Route path="/food-court/:id/vendors" component={() => <RoleProtectedRoute component={FoodCourtVendorsPage} allow={["owner", "manager", "food_court_owner"]} />} />
      <Route path="/food-court/:id/pos" component={() => <RoleProtectedRoute component={FoodCourtPosPage} allow={["owner", "manager", "food_court_owner", "food_court_cashier", "cashier"]} />} />
      <Route path="/food-court/:id/tokens" component={() => <RoleProtectedRoute component={FoodCourtTokensPage} allow={["owner", "manager", "food_court_owner", "food_court_cashier", "cashier", "kitchen", "waiter"]} />} />
      <Route path="/food-court/:id/settlements" component={() => <RoleProtectedRoute component={FoodCourtSettlementsPage} allow={["owner", "manager", "food_court_owner"]} />} />
      <Route path="/food-court/:id/reports" component={() => <RoleProtectedRoute component={FoodCourtReportsPage} allow={["owner", "manager", "food_court_owner"]} />} />
      <Route path="/food-court/my-counter" component={() => <ProtectedRoute component={FoodCourtMyCounterPage} />} />
      <Route path="/site/:slug" component={PublicSitePage} />
      <Route path="/book/:slug" component={PublicBookingPage} />
      <Route path="/memberships" component={() => <RoleProtectedRoute component={MembershipsPage} allow={["owner", "manager", "waiter", "super_admin"]} />} />
      <Route path="/menu/:slug/:tableId" component={CustomerMenuPage} />
      <Route path="/review/:qrCode" component={CustomerFeedbackPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <AppSettingsProvider>
          <BranchProvider>
            <TooltipProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <SocketMount />
                <Router />
              </WouterRouter>
              <Toaster />
            </TooltipProvider>
          </BranchProvider>
          </AppSettingsProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
