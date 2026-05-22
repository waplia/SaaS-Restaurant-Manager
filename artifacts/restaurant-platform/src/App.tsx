import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InstallPrompt } from "@/components/install-prompt";
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
import PackagingInventoryPage from "@/pages/inventory-packaging";
import CondimentsInventoryPage from "@/pages/inventory-condiments";
import PortionDriftPage from "@/pages/inventory-portion-drift";
import VendorInvoicesPage from "@/pages/inventory-vendor-invoices";
import RecipeVersionsPage from "@/pages/inventory-recipe-versions";
import TasteTestingPage from "@/pages/kitchen-taste-testing";
import StaffPage from "@/pages/staff";
import StaffTasksPage from "@/pages/staff-tasks";
import StaffSchedulingPage from "@/pages/staff-scheduling";
import CustomersPage from "@/pages/customers";
import ExpensesPage from "@/pages/expenses";
import WastePage from "@/pages/waste";
import PnlPage from "@/pages/pnl";
import AccountingBooksPage from "@/pages/accounting-books";
import CompliancePage from "@/pages/compliance";
import HrCompliancePage from "@/pages/hr-compliance";
import CloudKitchenPage from "@/pages/cloud-kitchen";
import PayrollPage from "@/pages/payroll";
import StaffIncentivesPage from "@/pages/staff-incentives";
import ReportsPage from "@/pages/reports";
import NotificationsPage from "@/pages/notifications";
import SettingsPage from "@/pages/settings";
import SettingsSectionPage from "@/pages/settings-section";
import SettingsAccountPage from "@/pages/settings-account";
import SettingsKitchensPage from "@/pages/settings-kitchens";
import SettingsDevicesPage from "@/pages/settings-devices";
import SettingsPrintersPage from "@/pages/settings-printers";
import SettingsTerminalsPage from "@/pages/settings-terminals";
import SettingsTokenDisplayPage from "@/pages/settings-token-display";
import SettingsOrderCapacityPage from "@/pages/settings-order-capacity";
import SettingsSessionsPage from "@/pages/settings-sessions";
import TokensPage from "@/pages/tokens";
import TokensHistoryPage from "@/pages/tokens-history";
import DisplayTokenPage from "@/pages/display-token";
import OrderTrackPage from "@/pages/order-track";
import SubscriptionPage from "@/pages/subscription";
import PricingPage from "@/pages/pricing";
import { PlanProtectedRoute } from "@/lib/planFeatures";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import OnboardingPage from "@/pages/onboarding";
import SetupWizardPage from "@/pages/setup-wizard";
import SetupOnboardingPage from "@/pages/setup-onboarding";
import ForgotPasswordPage from "@/pages/forgot-password";
import CompleteProfilePage from "@/pages/complete-profile";
import ResetPasswordPage from "@/pages/reset-password";
import AdminPage from "@/pages/admin";
import AdminLeadsPage from "@/pages/admin-leads";
import MarketplacePage from "@/pages/marketplace";
const SupplierCatalogPage = lazy(() => import("@/pages/supplier-catalog"));
const PurchaseRequestsPage = lazy(() => import("@/pages/purchase-requests"));
const SupplierPortalPage = lazy(() => import("@/pages/supplier-portal"));
import AdminAddonsPage from "@/pages/admin-addons";
import AdminAuditLogsPage from "@/pages/admin-audit-logs";
import AdminDeletedAccountsPage from "@/pages/admin-deleted-accounts";
import AdminBlogPage from "@/pages/admin-blog";
import AdminSupportPage from "@/pages/admin-support";
import SupportPage from "@/pages/support";
import StatusPage from "@/pages/status";
import SystemHealthPage from "@/pages/system-health";
import AdminApiSettingsPage from "@/pages/admin-api-settings";
import ApiKeysPage from "@/pages/api-keys";
import AccountingLandingPage from "@/pages/settings-accounting";
import AccountingTargetPage from "@/pages/settings-accounting-target";
import WebhooksPage from "@/pages/webhooks";
import WebhookLogsPage from "@/pages/webhook-logs";
import ApiLogsPage from "@/pages/api-logs";
import DeveloperDocsPage from "@/pages/developer-docs";
import OauthAppsPage from "@/pages/oauth-apps";
import AdminSettingsPage from "@/pages/admin-settings";
import { AppSettingsProvider } from "@/lib/appSettings";
import PosPage from "@/pages/pos";
import HandheldPosPage from "@/pages/handheld-pos";
import PosSyncPage from "@/pages/pos-sync";
import HotelPage from "@/pages/hotel";
import CustomerMenuPage from "@/pages/customer-menu";
import PaymentsPage from "@/pages/payments";
import DuePaymentsPage from "@/pages/due-payments";
import CashRegisterPage from "@/pages/cash-register";
import DeliveryExecutivesPage from "@/pages/delivery-executives";
import {
  LocalMapPage, FestivalCalendarPage, OfferConflictsPage, MarginFloorsPage, UpsellProPage,
  QueueManagerPage, PreorderPage, ZoneProfitabilityPage, TableOptimizationPage, TipsPage, LeaderboardTvPage,
} from "@/pages/advanced-growth";
import CodMonitoringPage from "@/pages/cod-monitoring";
import WaiterRequestsPage from "@/pages/waiter-requests";
import ReservationsPage from "@/pages/reservations";
const EventsPage = lazy(() => import("@/pages/events"));
const CqVipAlertsPage = lazy(() => import("@/pages/customer-quality/vip-alerts"));
const CqBlacklistPage = lazy(() => import("@/pages/customer-quality/blacklist"));
const CqMoodPage = lazy(() => import("@/pages/customer-quality/mood"));
const CqComplaintsEscalationPage = lazy(() => import("@/pages/customer-quality/complaints-escalation"));
const CqRepeatDetectorPage = lazy(() => import("@/pages/customer-quality/repeat-detector"));
const CqVisitCalendarPage = lazy(() => import("@/pages/customer-quality/visit-calendar"));
const CqOrderStatusPage = lazy(() => import("@/pages/customer-quality/order-status"));
const CqAccuracyPage = lazy(() => import("@/pages/customer-quality/accuracy"));
const CqLostSalesPage = lazy(() => import("@/pages/customer-quality/lost-sales"));
const CqAbandonedCartsPage = lazy(() => import("@/pages/customer-quality/abandoned-carts"));
import BakeryPage from "@/pages/bakery";
import BarPage from "@/pages/bar";
import PublicBookingPage from "@/pages/public-booking";
import PublicSitePage from "@/pages/public-site";
import CustomerAppBuilderPage from "@/pages/customer-app-builder";
import CustomerAppPage from "@/pages/customer-app";
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
import SurveysPage from "@/pages/surveys";
import CustomerSurveyPage from "@/pages/customer-survey";
import FraudAlertsPage from "@/pages/fraud-alerts";
import PricingOptimizerPage from "@/pages/pricing-optimizer";
import PricingRulesPage from "@/pages/pricing-rules";
import MenuHeatmapPage from "@/pages/menu-heatmap";
import MenuAbTestsPage from "@/pages/menu-ab-tests";
import MenuSearchAnalyticsPage from "@/pages/menu-search-analytics";
import MenuModifierBuilderPage from "@/pages/menu-modifier-builder";
import MenuTasteProfilesPage from "@/pages/menu-taste-profiles";
import MenuGroupQrPage from "@/pages/menu-group-qr";
import MenuSplitCartPage from "@/pages/menu-split-cart";
import MenuLifecyclePage from "@/pages/menu-lifecycle";
import MenuLaunchesPage from "@/pages/menu-launches";
import MenuPhotoApprovalsPage from "@/pages/menu-photo-approvals";
import MenuBrandAssetsPage from "@/pages/menu-brand-assets";
import GrowthEnginePage from "@/pages/growth-engine";
import LoyaltyAnalyticsPage from "@/pages/loyalty-analytics";
import LoyaltyNetworkPage from "@/pages/loyalty-network";
import DocumentsPage from "@/pages/documents";
import WalletsPage from "@/pages/wallets";
import GiftCardsPage from "@/pages/gift-cards";
import SettlementReconPage from "@/pages/settlement-recon";
import AggregatorReconPage from "@/pages/aggregator-recon";
import CapitalInsurancePage from "@/pages/capital-insurance";
import AdminFintechPage from "@/pages/admin-fintech";
import AdminPhonePePage from "@/pages/admin-phonepe";
import AdminFinancePartnersPage from "@/pages/admin-finance-partners";
import HealthScorePage from "@/pages/health-score";
import SustainabilityPage from "@/pages/sustainability";
import SopTrainingPage from "@/pages/sop-training";
import MysteryAuditsPage from "@/pages/mystery-audits";
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
import CorporateDashboardPage from "@/pages/corporate-dashboard";
import CorporateCompaniesPage from "@/pages/corporate-companies";
import CorporateCompanyDetailPage from "@/pages/corporate-company-detail";
import CorporateApprovalsPage from "@/pages/corporate-approvals";
import CorporateBulkOrdersPage from "@/pages/corporate-bulk-orders";
import CorporateScheduledPage from "@/pages/corporate-scheduled";
import CorporateInvoicesPage from "@/pages/corporate-invoices";
import CorporateInvoiceDetailPage from "@/pages/corporate-invoice-detail";
import TiffinPlansPage from "@/pages/tiffin-plans";
import TiffinSubscriptionsPage from "@/pages/tiffin-subscriptions";
import TiffinDeliveriesPage from "@/pages/tiffin-deliveries";
import TiffinBillingPage from "@/pages/tiffin-billing";
import TiffinCustomerHistoryPage from "@/pages/tiffin-customer-history";
import OpsDigitalTwinPage from "@/pages/ops-digital-twin";
import OpsPanicPage from "@/pages/ops-panic";
import OpsHandoverPage from "@/pages/ops-handover";
import OpsBriefingsPage from "@/pages/ops-briefings";
import OpsChecklistsPage from "@/pages/ops-checklists";
import OpsTimelinePage from "@/pages/ops-timeline";
import OpsReportsPage from "@/pages/ops-reports";
import OpsApprovalsPage from "@/pages/ops-approvals";
import OpsIncidentsPage from "@/pages/ops-incidents";
import KitchenCleaningPage from "@/pages/kitchen-cleaning";
import KitchenTemperaturesPage from "@/pages/kitchen-temperatures";
import KitchenEquipmentPage from "@/pages/kitchen-equipment";
import CompetitorsPage from "@/pages/competitors";
import CompetitorDetailPage from "@/pages/competitor-detail";
import CompetitorComparisonPage from "@/pages/competitor-comparison";
import CanteenStudentsPage from "@/pages/canteen-students";
import CanteenMealPlansPage from "@/pages/canteen-meal-plans";
import CanteenPosPage from "@/pages/canteen-pos";
import CanteenParentPage from "@/pages/canteen-parent";
import CanteenReportsPage from "@/pages/canteen-reports";
import CanteenHelpPage from "@/pages/canteen-help";
import UpgradeRequiredPage from "@/pages/upgrade-required";
import { PLAN_BOOLEAN_FEATURES } from "@workspace/db/planFeatures";

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
      <Route path="/complete-profile" component={CompleteProfilePage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/admin" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/tenants" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/plans" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/payment-methods" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/approvals" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/coupons" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/notifications" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/sms" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/email" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/maintenance" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/whatsapp" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/web-push" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/ai" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/stock-food-images" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/health" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/metrics" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/admin/implementations" component={() => <SuperAdminRoute component={AdminPage} />} />
      <Route path="/setup/onboarding" component={() => <ProtectedRoute component={SetupOnboardingPage} />} />
      <Route path="/admin/leads" component={() => <SuperAdminRoute component={AdminLeadsPage} />} />
      <Route path="/admin/audit-logs" component={() => <SuperAdminRoute component={AdminAuditLogsPage} />} />
      <Route path="/admin/deleted-accounts" component={() => <SuperAdminRoute component={AdminDeletedAccountsPage} />} />
      <Route path="/admin/blog" component={() => <SuperAdminRoute component={AdminBlogPage} />} />
      <Route path="/admin/support" component={() => <SuperAdminRoute component={AdminSupportPage} />} />
      <Route path="/support" component={() => <RoleProtectedRoute component={SupportPage} allow={["owner", "manager"]} />} />
      <Route path="/status" component={StatusPage} />
      <Route path="/sop-training" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={SopTrainingPage} feature="sop_training" />} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/mystery-audits" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={MysteryAuditsPage} feature="mystery_audits" />} allow={["owner", "manager", "auditor", "super_admin"]} />} />
      <Route path="/my-training" component={() => <ProtectedRoute component={MyTrainingPage} />} />
      <Route path="/admin/system-health" component={() => <SuperAdminRoute component={SystemHealthPage} />} />
      <Route path="/admin/settings" component={() => <SuperAdminRoute component={AdminSettingsPage} />} />
      <Route path="/admin/addons" component={() => <SuperAdminRoute component={AdminAddonsPage} />} />
      <Route path="/marketplace" component={() => <RoleProtectedRoute component={MarketplacePage} allow={["owner", "manager"]} />} />
      <Route path="/marketplace/supplier-catalog" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={SupplierCatalogPage} feature="supplier_network" />} allow={["owner", "manager"]} />} />
      <Route path="/marketplace/purchase-requests" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={PurchaseRequestsPage} feature="supplier_network" />} allow={["owner", "manager"]} />} />
      <Route path="/supplier-portal/:token" component={SupplierPortalPage} />
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
      <Route path="/pos" component={() => <ProtectedRoute component={() => <PlanProtectedRoute component={PosPage} feature="kitchen_display" />} />} />
      <Route path="/sell/handheld-pos" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={HandheldPosPage} feature="handheld_pos" />} allow={["owner", "manager", "waiter", "cashier"]} />} />
      <Route path="/pos-sync" component={() => <ProtectedRoute component={() => <PlanProtectedRoute component={PosSyncPage} feature="offline_pos" />} />} />
      <Route path="/hotel" component={() => <RoleProtectedRoute component={HotelPage} allow={["owner", "manager", "cashier", "waiter", "kitchen", "staff"]} />} />
      <Route path="/orders" component={() => <ProtectedRoute component={OrdersPage} />} />
      <Route path="/kitchen" component={() => <ProtectedRoute component={() => <PlanProtectedRoute component={KitchenPage} feature="kitchen_display" />} />} />
      <Route path="/tables" component={() => <ProtectedRoute component={TablesPage} />} />
      <Route path="/menu" component={() => <ProtectedRoute component={MenuPage} />} />
      <Route path="/menu-management" component={() => <ProtectedRoute component={MenuPage} />} />
      <Route path="/menu/pricing-optimizer" component={() => <RoleProtectedRoute component={PricingOptimizerPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/pricing-rules" component={() => <RoleProtectedRoute component={PricingRulesPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/heatmap" component={() => <RoleProtectedRoute component={MenuHeatmapPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/ab-tests" component={() => <RoleProtectedRoute component={MenuAbTestsPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/search-analytics" component={() => <RoleProtectedRoute component={MenuSearchAnalyticsPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/modifier-builder" component={() => <RoleProtectedRoute component={MenuModifierBuilderPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/taste-profiles" component={() => <RoleProtectedRoute component={MenuTasteProfilesPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/group-qr" component={() => <RoleProtectedRoute component={MenuGroupQrPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/split-cart" component={() => <RoleProtectedRoute component={MenuSplitCartPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/lifecycle" component={() => <RoleProtectedRoute component={MenuLifecyclePage} allow={["owner", "manager"]} />} />
      <Route path="/menu/launches" component={() => <RoleProtectedRoute component={MenuLaunchesPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/photo-approvals" component={() => <RoleProtectedRoute component={MenuPhotoApprovalsPage} allow={["owner", "manager"]} />} />
      <Route path="/menu/brand-assets" component={() => <RoleProtectedRoute component={MenuBrandAssetsPage} allow={["owner", "manager"]} />} />
      <Route path="/pricing" component={() => <ProtectedRoute component={PricingPage} />} />
      <Route path="/growth" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={GrowthEnginePage} feature="advanced_reports" />} allow={["owner", "manager"]} />} />
      <Route path="/competitors" component={() => <RoleProtectedRoute component={CompetitorsPage} allow={["owner", "manager"]} />} />
      <Route path="/competitors/comparison" component={() => <RoleProtectedRoute component={CompetitorComparisonPage} allow={["owner", "manager"]} />} />
      <Route path="/competitors/:id" component={() => <RoleProtectedRoute component={CompetitorDetailPage} allow={["owner", "manager"]} />} />
      <Route path="/loyalty/analytics" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={LoyaltyAnalyticsPage} feature="loyalty_program" />} allow={["owner", "manager"]} />} />
      <Route path="/customers/loyalty-network" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={LoyaltyNetworkPage} feature="loyalty_network" />} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/inventory" component={() => <ProtectedRoute component={() => <PlanProtectedRoute component={InventoryPage} feature="inventory_management" />} />} />
      <Route path="/inventory/packaging" component={() => <RoleProtectedRoute component={PackagingInventoryPage} allow={["owner", "manager", "kitchen"]} />} />
      <Route path="/inventory/condiments" component={() => <RoleProtectedRoute component={CondimentsInventoryPage} allow={["owner", "manager", "kitchen"]} />} />
      <Route path="/inventory/portion-drift" component={() => <RoleProtectedRoute component={PortionDriftPage} allow={["owner", "manager", "kitchen"]} />} />
      <Route path="/inventory/vendor-invoices" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={VendorInvoicesPage} feature="inv_vendor_invoice_ocr" />} allow={["owner", "manager"]} />} />
      <Route path="/inventory/recipe-versions" component={() => <RoleProtectedRoute component={RecipeVersionsPage} allow={["owner", "manager", "kitchen"]} />} />
      <Route path="/kitchen/taste-testing" component={() => <RoleProtectedRoute component={TasteTestingPage} allow={["owner", "manager", "kitchen"]} />} />
      <Route path="/reservations" component={() => <ProtectedRoute component={() => <PlanProtectedRoute component={ReservationsPage} feature="reservations" />} />} />
      <Route path="/payments" component={() => <ProtectedRoute component={PaymentsPage} />} />
      <Route path="/due-payments" component={() => <ProtectedRoute component={DuePaymentsPage} />} />
      <Route path="/cash-register" component={() => <RoleProtectedRoute component={CashRegisterPage} allow={["owner", "manager", "waiter"]} />} />
      <Route path="/staff" component={() => <ProtectedRoute component={StaffPage} />} />
      <Route path="/staff-tasks" component={() => <RoleProtectedRoute component={StaffTasksPage} allow={["owner", "manager"]} />} />
      <Route path="/staff/scheduling" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={StaffSchedulingPage} feature="advanced_scheduling" />} allow={["owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "staff", "super_admin"]} />} />
      <Route path="/customers" component={() => <ProtectedRoute component={CustomersPage} />} />
      <Route path="/customers/vip-alerts" component={() => <RoleProtectedRoute component={CqVipAlertsPage} allow={["owner", "manager", "waiter", "super_admin"]} />} />
      <Route path="/customers/blacklist" component={() => <RoleProtectedRoute component={CqBlacklistPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/customers/mood" component={() => <RoleProtectedRoute component={CqMoodPage} allow={["owner", "manager", "waiter", "super_admin"]} />} />
      <Route path="/customers/complaints" component={() => <RoleProtectedRoute component={CqComplaintsEscalationPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/customers/repeat-detector" component={() => <RoleProtectedRoute component={CqRepeatDetectorPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/customers/visit-calendar" component={() => <RoleProtectedRoute component={CqVisitCalendarPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/customers/order-status" component={() => <RoleProtectedRoute component={CqOrderStatusPage} allow={["owner", "manager", "waiter", "kitchen", "cashier", "super_admin"]} />} />
      <Route path="/customers/accuracy" component={() => <RoleProtectedRoute component={CqAccuracyPage} allow={["owner", "manager", "kitchen", "super_admin"]} />} />
      <Route path="/customers/lost-sales" component={() => <RoleProtectedRoute component={CqLostSalesPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/customers/abandoned-carts" component={() => <RoleProtectedRoute component={CqAbandonedCartsPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/expenses" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={ExpensesPage} feature="expense_tracking" />} allow={["owner", "manager"]} />} />
      <Route path="/waste" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={WastePage} feature="inventory_management" />} allow={["owner", "manager", "kitchen", "waiter", "cashier"]} />} />
      <Route path="/pnl" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={PnlPage} feature="smart_pnl" />} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/finance/accounting-books" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AccountingBooksPage} feature="accounting_back_office" />} allow={["owner", "manager", "accountant", "super_admin"]} />} />
      <Route path="/compliance" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={CompliancePage} feature="compliance_manager" />} allow={["owner", "manager"]} />} />
      <Route path="/hr-compliance" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={HrCompliancePage} feature="hr_compliance" />} allow={["owner", "manager", "hr_officer"]} />} />
      <Route path="/cloud-kitchen" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={CloudKitchenPage} feature="cloud_kitchen" />} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/payroll" component={() => <RoleProtectedRoute component={PayrollPage} allow={["owner"]} />} />
      <Route path="/staff-incentives" component={() => <RoleProtectedRoute component={StaffIncentivesPage} allow={["owner", "manager"]} />} />
      <Route path="/growth/local-map" component={() => <RoleProtectedRoute component={LocalMapPage} allow={["owner", "manager"]} />} />
      <Route path="/growth/festival-calendar" component={() => <RoleProtectedRoute component={FestivalCalendarPage} allow={["owner", "manager"]} />} />
      <Route path="/growth/offer-conflicts" component={() => <RoleProtectedRoute component={OfferConflictsPage} allow={["owner", "manager"]} />} />
      <Route path="/growth/margin-floors" component={() => <RoleProtectedRoute component={MarginFloorsPage} allow={["owner", "manager"]} />} />
      <Route path="/growth/upsell-pro" component={() => <RoleProtectedRoute component={UpsellProPage} allow={["owner", "manager", "waiter"]} />} />
      <Route path="/delivery/queue" component={() => <RoleProtectedRoute component={QueueManagerPage} allow={["owner", "manager", "cashier"]} />} />
      <Route path="/delivery/pre-order" component={() => <RoleProtectedRoute component={PreorderPage} allow={["owner", "manager", "cashier"]} />} />
      <Route path="/delivery/zone-profitability" component={() => <RoleProtectedRoute component={ZoneProfitabilityPage} allow={["owner", "manager"]} />} />
      <Route path="/staff/table-optimization" component={() => <RoleProtectedRoute component={TableOptimizationPage} allow={["owner", "manager"]} />} />
      <Route path="/staff/tips" component={() => <RoleProtectedRoute component={TipsPage} allow={["owner", "manager"]} />} />
      <Route path="/staff/leaderboard-tv" component={() => <RoleProtectedRoute component={LeaderboardTvPage} allow={["owner", "manager"]} />} />
      <Route path="/wallets" component={() => <RoleProtectedRoute component={WalletsPage} allow={["owner", "manager"]} />} />
      <Route path="/gift-cards" component={() => <RoleProtectedRoute component={GiftCardsPage} allow={["owner", "manager", "cashier"]} />} />
      <Route path="/settlements" component={() => <RoleProtectedRoute component={SettlementReconPage} allow={["owner", "manager", "cashier"]} />} />
      <Route path="/aggregator-payouts" component={() => <RoleProtectedRoute component={AggregatorReconPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/capital" component={() => <RoleProtectedRoute component={CapitalInsurancePage} allow={["owner", "manager"]} />} />
      <Route path="/admin/fintech" component={() => <SuperAdminRoute component={AdminFintechPage} />} />
      <Route path="/admin/phonepe" component={() => <SuperAdminRoute component={AdminPhonePePage} />} />
      <Route path="/admin/finance-partners" component={() => <SuperAdminRoute component={AdminFinancePartnersPage} />} />
      <Route path="/reports" component={() => <Redirect to="/reports/sales" />} />
      <Route path="/reports/fraud-alerts" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={FraudAlertsPage} feature="advanced_reports" />} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/reports/health-score" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={HealthScorePage} feature="advanced_reports" />} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/sustainability" component={() => <RoleProtectedRoute component={SustainabilityPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/reports/:section" component={() => <ProtectedRoute component={() => <PlanProtectedRoute component={ReportsPage} feature="advanced_reports" />} />} />
      <Route path="/delivery/executives" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={DeliveryExecutivesPage} feature="delivery_module" />} allow={["owner", "manager"]} />} />
      <Route path="/corporate" component={() => <RoleProtectedRoute component={CorporateDashboardPage} allow={["owner", "manager"]} />} />
      <Route path="/corporate/companies" component={() => <RoleProtectedRoute component={CorporateCompaniesPage} allow={["owner", "manager"]} />} />
      <Route path="/corporate/companies/:id" component={() => <RoleProtectedRoute component={CorporateCompanyDetailPage} allow={["owner", "manager"]} />} />
      <Route path="/corporate/approvals" component={() => <RoleProtectedRoute component={CorporateApprovalsPage} allow={["owner", "manager"]} />} />
      <Route path="/corporate/bulk-orders" component={() => <RoleProtectedRoute component={CorporateBulkOrdersPage} allow={["owner", "manager"]} />} />
      <Route path="/corporate/scheduled" component={() => <RoleProtectedRoute component={CorporateScheduledPage} allow={["owner", "manager"]} />} />
      <Route path="/corporate/invoices" component={() => <RoleProtectedRoute component={CorporateInvoicesPage} allow={["owner", "manager"]} />} />
      <Route path="/corporate/invoices/:id" component={() => <RoleProtectedRoute component={CorporateInvoiceDetailPage} allow={["owner", "manager"]} />} />
      <Route path="/ops/digital-twin" component={() => <RoleProtectedRoute component={OpsDigitalTwinPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/ops/panic" component={() => <RoleProtectedRoute component={OpsPanicPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/ops/handover" component={() => <RoleProtectedRoute component={OpsHandoverPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/ops/briefings" component={() => <RoleProtectedRoute component={OpsBriefingsPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/ops/checklists" component={() => <RoleProtectedRoute component={OpsChecklistsPage} allow={["owner", "manager", "waiter", "kitchen", "cashier", "super_admin"]} />} />
      <Route path="/ops/timeline" component={() => <RoleProtectedRoute component={OpsTimelinePage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/ops/reports" component={() => <RoleProtectedRoute component={OpsReportsPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/ops/approvals" component={() => <RoleProtectedRoute component={OpsApprovalsPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/ops/incidents" component={() => <RoleProtectedRoute component={OpsIncidentsPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/kitchen/cleaning" component={() => <RoleProtectedRoute component={KitchenCleaningPage} allow={["owner", "manager", "kitchen", "super_admin"]} />} />
      <Route path="/kitchen/temperatures" component={() => <RoleProtectedRoute component={KitchenTemperaturesPage} allow={["owner", "manager", "kitchen", "super_admin"]} />} />
      <Route path="/kitchen/equipment" component={() => <RoleProtectedRoute component={KitchenEquipmentPage} allow={["owner", "manager", "super_admin"]} />} />
      <Route path="/tiffin/plans" component={() => <RoleProtectedRoute component={TiffinPlansPage} allow={["owner", "manager"]} />} />
      <Route path="/tiffin/subscriptions" component={() => <RoleProtectedRoute component={TiffinSubscriptionsPage} allow={["owner", "manager", "cashier"]} />} />
      <Route path="/tiffin/deliveries" component={() => <RoleProtectedRoute component={TiffinDeliveriesPage} allow={["owner", "manager", "delivery_executive"]} />} />
      <Route path="/tiffin/billing" component={() => <RoleProtectedRoute component={TiffinBillingPage} allow={["owner", "manager"]} />} />
      <Route path="/tiffin/customers" component={() => <RoleProtectedRoute component={TiffinCustomerHistoryPage} allow={["owner", "manager"]} />} />
      <Route path="/canteen/students" component={() => <RoleProtectedRoute component={CanteenStudentsPage} allow={["owner", "manager", "canteen_admin"]} />} />
      <Route path="/canteen/meal-plans" component={() => <RoleProtectedRoute component={CanteenMealPlansPage} allow={["owner", "manager", "canteen_admin"]} />} />
      <Route path="/canteen/pos" component={() => <RoleProtectedRoute component={CanteenPosPage} allow={["owner", "manager", "cashier", "counter_staff", "canteen_admin"]} />} />
      <Route path="/canteen/reports" component={() => <RoleProtectedRoute component={CanteenReportsPage} allow={["owner", "manager", "canteen_admin"]} />} />
      <Route path="/canteen/help" component={() => <ProtectedRoute component={CanteenHelpPage} />} />
      <Route path="/canteen/parent/:token" component={CanteenParentPage} />
      <Route path="/delivery/cod" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={CodMonitoringPage} feature="delivery_module" />} allow={["owner", "manager"]} />} />
      <Route path="/notifications" component={() => <ProtectedRoute component={NotificationsPage} />} />
      <Route path="/waiter-requests" component={() => <RoleProtectedRoute component={WaiterRequestsPage} allow={["owner", "manager", "waiter"]} />} />
      <Route path="/settings/subscription" component={() => <RoleProtectedRoute component={SubscriptionPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/kitchens" component={() => <RoleProtectedRoute component={SettingsKitchensPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/devices" component={() => <RoleProtectedRoute component={SettingsDevicesPage} allow={["owner", "manager", "cashier", "waiter", "kitchen"]} />} />
      <Route path="/settings/printers" component={() => <RoleProtectedRoute component={SettingsPrintersPage} allow={["owner", "manager", "cashier", "waiter", "kitchen"]} />} />
      <Route path="/settings/terminals" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={SettingsTerminalsPage} feature="card_terminal" />} allow={["owner", "manager", "cashier"]} />} />
      <Route path="/settings/token-display" component={() => <RoleProtectedRoute component={SettingsTokenDisplayPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/order-capacity" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={SettingsOrderCapacityPage} feature="ops_order_capacity" />} allow={["owner", "manager"]} />} />
      <Route path="/tokens" component={() => <RoleProtectedRoute component={TokensPage} allow={["owner", "manager", "waiter", "cashier", "kitchen"]} />} />
      <Route path="/tokens/history" component={() => <RoleProtectedRoute component={TokensHistoryPage} allow={["owner", "manager", "waiter", "cashier", "kitchen"]} />} />
      <Route path="/display/token/:outletId" component={DisplayTokenPage} />
      <Route path="/track/:orderId" component={OrderTrackPage} />
      <Route path="/settings/sessions" component={() => <ProtectedRoute component={SettingsSessionsPage} />} />
      <Route path="/settings/api-keys" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={ApiKeysPage} feature="api_access" />} allow={["owner", "manager"]} />} />
      <Route path="/settings/accounting" component={() => <RoleProtectedRoute component={AccountingLandingPage} allow={["owner", "manager", "accountant"]} />} />
      <Route path="/settings/accounting/:target" component={() => <RoleProtectedRoute component={AccountingTargetPage} allow={["owner", "manager", "accountant"]} />} />
      <Route path="/settings/webhooks" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={WebhooksPage} feature="api_access" />} allow={["owner", "manager"]} />} />
      <Route path="/settings/webhook-logs" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={WebhookLogsPage} feature="api_access" />} allow={["owner", "manager"]} />} />
      <Route path="/settings/api-logs" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={ApiLogsPage} feature="api_access" />} allow={["owner", "manager"]} />} />
      <Route path="/settings/developer-docs" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={DeveloperDocsPage} feature="api_access" />} allow={["owner", "manager"]} />} />
      <Route path="/settings/oauth-apps" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={OauthAppsPage} feature="api_access" />} allow={["owner", "manager"]} />} />
      <Route path="/admin/api-settings" component={() => <SuperAdminRoute component={AdminApiSettingsPage} />} />
      <Route path="/settings/account" component={() => <ProtectedRoute component={SettingsAccountPage} />} />
      <Route path="/settings/customer-app" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={CustomerAppBuilderPage} feature="customer_app" />} allow={["owner", "super_admin"]} />} />
      <Route path="/settings/:section" component={() => <RoleProtectedRoute component={SettingsSectionPage} allow={["owner", "manager"]} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/events" component={() => <Suspense fallback={null}><RoleProtectedRoute component={() => <PlanProtectedRoute component={EventsPage} feature="events_catering" />} allow={["owner", "manager", "waiter", "kitchen"]} /></Suspense>} />
      <Route path="/bakery" component={() => <RoleProtectedRoute component={BakeryPage} allow={["owner", "manager", "waiter", "kitchen", "cashier"]} />} />
      <Route path="/bar" component={() => <RoleProtectedRoute component={BarPage} allow={["owner", "manager", "waiter", "kitchen", "cashier"]} />} />
      <Route path="/ai" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiDashboardPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/descriptions" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiDescriptionsPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/images" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiImagesPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/inventory" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiInventoryPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/upsell" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiUpsellPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/forecast" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiForecastPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/insights" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiSalesInsightsPage} feature="khana_ai_insights_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/staff-insights" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiStaffInsightsPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/menu-import/history" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiMenuImportHistoryPage} feature="ai_menu_drafts" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/menu-import/:id" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiMenuImportPage} feature="ai_menu_drafts" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/menu-import" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiMenuImportPage} feature="ai_menu_drafts" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/usage" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiUsagePage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/settings" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiSettingsPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/review-qrs" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={ReviewQrsPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/review-replies" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={AiReviewRepliesPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/feedback-recovery" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={FeedbackRecoveryPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
      <Route path="/ai/feedback-wall" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={FeedbackWallPage} feature="khana_ai_enabled" />} allow={["owner", "manager"]} />} />
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
      <Route path="/app/:slug" component={CustomerAppPage} />
      <Route path="/book/:slug" component={PublicBookingPage} />
      <Route path="/memberships" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={MembershipsPage} feature="loyalty_program" />} allow={["owner", "manager", "waiter", "super_admin"]} />} />
      <Route path="/menu/:slug/:tableId" component={CustomerMenuPage} />
      <Route path="/menu/:slug" component={CustomerMenuPage} />
      <Route path="/review/:qrCode" component={CustomerFeedbackPage} />
      <Route path="/surveys" component={() => <RoleProtectedRoute component={SurveysPage} allow={["owner", "manager"]} />} />
      <Route path="/survey/:slug" component={CustomerSurveyPage} />

      {/* ── Task #365: placeholder routes for advanced-pack features ──────────
       * Each feature in PLAN_BOOLEAN_FEATURES with a `sidebarHref` gets a
       * route that renders the UpgradeRequiredPage until a domain task ships
       * the real screen. The page reads the feature key from the URL via
       * findFeatureByHref(), so no per-route key threading is needed. */}
      {PLAN_BOOLEAN_FEATURES
        .filter((f) => !!f.sidebarHref)
        .map((f) => (
          <Route
            key={f.key}
            path={f.sidebarHref!}
            component={() => <ProtectedRoute component={UpgradeRequiredPage} />}
          />
        ))}

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
              <InstallPrompt />
            </TooltipProvider>
          </BranchProvider>
          </AppSettingsProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
