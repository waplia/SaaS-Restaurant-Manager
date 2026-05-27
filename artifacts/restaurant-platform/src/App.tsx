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
import { PlanProtectedRoute } from "@/lib/planFeatures";
import { AppSettingsProvider } from "@/lib/appSettings";
import { hasSeenWelcome } from "@/lib/welcome";
import { PLAN_BOOLEAN_FEATURES } from "@workspace/db/planFeatures";
import NotFound from "@/pages/not-found";

// Every page below is lazy-loaded. The main JS bundle only carries the
// shell (providers, router, auth guards). Each route's page chunk is
// downloaded on demand the first time the user visits it and then cached
// by the browser/PWA.
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const OrdersPage = lazy(() => import("@/pages/orders"));
const KitchenPage = lazy(() => import("@/pages/kitchen"));
const TablesPage = lazy(() => import("@/pages/tables"));
const MenuPage = lazy(() => import("@/pages/menu"));
const InventoryPage = lazy(() => import("@/pages/inventory"));
const PackagingInventoryPage = lazy(() => import("@/pages/inventory-packaging"));
const CondimentsInventoryPage = lazy(() => import("@/pages/inventory-condiments"));
const PortionDriftPage = lazy(() => import("@/pages/inventory-portion-drift"));
const VendorInvoicesPage = lazy(() => import("@/pages/inventory-vendor-invoices"));
const RecipeVersionsPage = lazy(() => import("@/pages/inventory-recipe-versions"));
const TasteTestingPage = lazy(() => import("@/pages/kitchen-taste-testing"));
const StaffPage = lazy(() => import("@/pages/staff"));
const StaffTasksPage = lazy(() => import("@/pages/staff-tasks"));
const StaffSchedulingPage = lazy(() => import("@/pages/staff-scheduling"));
const CustomersPage = lazy(() => import("@/pages/customers"));
const ExpensesPage = lazy(() => import("@/pages/expenses"));
const WastePage = lazy(() => import("@/pages/waste"));
const PnlPage = lazy(() => import("@/pages/pnl"));
const AccountingBooksPage = lazy(() => import("@/pages/accounting-books"));
const CompliancePage = lazy(() => import("@/pages/compliance"));
const HrCompliancePage = lazy(() => import("@/pages/hr-compliance"));
const CloudKitchenPage = lazy(() => import("@/pages/cloud-kitchen"));
const PayrollPage = lazy(() => import("@/pages/payroll"));
const StaffIncentivesPage = lazy(() => import("@/pages/staff-incentives"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const SettingsSectionPage = lazy(() => import("@/pages/settings-section"));
const SettingsAccountPage = lazy(() => import("@/pages/settings-account"));
const SettingsKitchensPage = lazy(() => import("@/pages/settings-kitchens"));
const SettingsDevicesPage = lazy(() => import("@/pages/settings-devices"));
const SettingsPrintersPage = lazy(() => import("@/pages/settings-printers"));
const SettingsBillTemplatesPage = lazy(() => import("@/pages/settings-bill-templates"));
const SettingsCountersPage = lazy(() => import("@/pages/settings-counters"));
const SettingsTerminalsPage = lazy(() => import("@/pages/settings-terminals"));
const SettingsTokenDisplayPage = lazy(() => import("@/pages/settings-token-display"));
const SettingsGuestVerificationPage = lazy(() => import("@/pages/settings-guest-verification"));
const SettingsOrderCapacityPage = lazy(() => import("@/pages/settings-order-capacity"));
const SettingsSessionsPage = lazy(() => import("@/pages/settings-sessions"));
const TokensPage = lazy(() => import("@/pages/tokens"));
const TokensHistoryPage = lazy(() => import("@/pages/tokens-history"));
const DisplayTokenPage = lazy(() => import("@/pages/display-token"));
const OrderTrackPage = lazy(() => import("@/pages/order-track"));
const SubscriptionPage = lazy(() => import("@/pages/subscription"));
const PricingPage = lazy(() => import("@/pages/pricing"));
const LoginPage = lazy(() => import("@/pages/login"));
const RegisterPage = lazy(() => import("@/pages/register"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const SetupWizardPage = lazy(() => import("@/pages/setup-wizard"));
const WelcomePage = lazy(() => import("@/pages/welcome"));
const SetupOnboardingPage = lazy(() => import("@/pages/setup-onboarding"));
const ForgotPasswordPage = lazy(() => import("@/pages/forgot-password"));
const CompleteProfilePage = lazy(() => import("@/pages/complete-profile"));
const ResetPasswordPage = lazy(() => import("@/pages/reset-password"));
const AdminPage = lazy(() => import("@/pages/admin"));
const AdminLeadsPage = lazy(() => import("@/pages/admin-leads"));
const MarketplacePage = lazy(() => import("@/pages/marketplace"));
const SupplierCatalogPage = lazy(() => import("@/pages/supplier-catalog"));
const PurchaseRequestsPage = lazy(() => import("@/pages/purchase-requests"));
const SupplierPortalPage = lazy(() => import("@/pages/supplier-portal"));
const AdminAddonsPage = lazy(() => import("@/pages/admin-addons"));
const AdminAuditLogsPage = lazy(() => import("@/pages/admin-audit-logs"));
const AdminDeletedAccountsPage = lazy(() => import("@/pages/admin-deleted-accounts"));
const AdminBlogPage = lazy(() => import("@/pages/admin-blog"));
const AdminSupportPage = lazy(() => import("@/pages/admin-support"));
const SupportPage = lazy(() => import("@/pages/support"));
const StatusPage = lazy(() => import("@/pages/status"));
const SystemHealthPage = lazy(() => import("@/pages/system-health"));
const AdminApiSettingsPage = lazy(() => import("@/pages/admin-api-settings"));
const ApiKeysPage = lazy(() => import("@/pages/api-keys"));
const AccountingLandingPage = lazy(() => import("@/pages/settings-accounting"));
const AccountingTargetPage = lazy(() => import("@/pages/settings-accounting-target"));
const WebhooksPage = lazy(() => import("@/pages/webhooks"));
const WebhookLogsPage = lazy(() => import("@/pages/webhook-logs"));
const ApiLogsPage = lazy(() => import("@/pages/api-logs"));
const DeveloperDocsPage = lazy(() => import("@/pages/developer-docs"));
const OauthAppsPage = lazy(() => import("@/pages/oauth-apps"));
const AdminSettingsPage = lazy(() => import("@/pages/admin-settings"));
const AdminAppDownloadsPage = lazy(() => import("@/pages/admin-app-downloads"));
const DownloadAppsPage = lazy(() => import("@/pages/download-apps"));
const PosPage = lazy(() => import("@/pages/pos"));
const HandheldPosPage = lazy(() => import("@/pages/handheld-pos"));
const PosSyncPage = lazy(() => import("@/pages/pos-sync"));
const HotelPage = lazy(() => import("@/pages/hotel"));
const CustomerMenuPage = lazy(() => import("@/pages/customer-menu"));
const PaymentsPage = lazy(() => import("@/pages/payments"));
const DuePaymentsPage = lazy(() => import("@/pages/due-payments"));
const CashRegisterPage = lazy(() => import("@/pages/cash-register"));
const DeliveryExecutivesPage = lazy(() => import("@/pages/delivery-executives"));
// advanced-growth bundles many small pages in one module; lazy-load each
// as its own chunk slice via .then() so they share the underlying module
// once any one of them is requested.
const LocalMapPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.LocalMapPage })));
const FestivalCalendarPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.FestivalCalendarPage })));
const OfferConflictsPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.OfferConflictsPage })));
const MarginFloorsPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.MarginFloorsPage })));
const UpsellProPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.UpsellProPage })));
const QueueManagerPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.QueueManagerPage })));
const PreorderPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.PreorderPage })));
const ZoneProfitabilityPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.ZoneProfitabilityPage })));
const TableOptimizationPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.TableOptimizationPage })));
const TipsPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.TipsPage })));
const LeaderboardTvPage = lazy(() => import("@/pages/advanced-growth").then((m) => ({ default: m.LeaderboardTvPage })));
const CodMonitoringPage = lazy(() => import("@/pages/cod-monitoring"));
const WaiterRequestsPage = lazy(() => import("@/pages/waiter-requests"));
const ReservationsPage = lazy(() => import("@/pages/reservations"));
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
const BakeryPage = lazy(() => import("@/pages/bakery"));
const BarPage = lazy(() => import("@/pages/bar"));
const PublicBookingPage = lazy(() => import("@/pages/public-booking"));
const PublicSitePage = lazy(() => import("@/pages/public-site"));
const CustomerAppBuilderPage = lazy(() => import("@/pages/customer-app-builder"));
const CustomerAppPage = lazy(() => import("@/pages/customer-app"));
const AiDashboardPage = lazy(() => import("@/pages/ai-dashboard"));
const AiDescriptionsPage = lazy(() => import("@/pages/ai-descriptions"));
const AiImagesPage = lazy(() => import("@/pages/ai-images"));
const AiInventoryPage = lazy(() => import("@/pages/ai-inventory"));
const AiUpsellPage = lazy(() => import("@/pages/ai-upsell"));
const AiForecastPage = lazy(() => import("@/pages/ai-forecast"));
const AiSalesInsightsPage = lazy(() => import("@/pages/ai-sales-insights"));
const AiStaffInsightsPage = lazy(() => import("@/pages/ai-staff-insights"));
const AiMenuImportPage = lazy(() => import("@/pages/ai-menu-import"));
const AiMenuImportHistoryPage = lazy(() => import("@/pages/ai-menu-import-history"));
const AiUsagePage = lazy(() => import("@/pages/ai-usage"));
const AiSettingsPage = lazy(() => import("@/pages/ai-settings"));
const ReviewQrsPage = lazy(() => import("@/pages/review-qrs"));
const AiReviewRepliesPage = lazy(() => import("@/pages/ai-review-replies"));
const FeedbackRecoveryPage = lazy(() => import("@/pages/feedback-recovery"));
const FeedbackWallPage = lazy(() => import("@/pages/feedback-wall"));
const PublicFeedbackWallPage = lazy(() => import("@/pages/public-feedback-wall"));
const CustomerFeedbackPage = lazy(() => import("@/pages/customer-feedback"));
const SurveysPage = lazy(() => import("@/pages/surveys"));
const CustomerSurveyPage = lazy(() => import("@/pages/customer-survey"));
const FraudAlertsPage = lazy(() => import("@/pages/fraud-alerts"));
const PricingOptimizerPage = lazy(() => import("@/pages/pricing-optimizer"));
const PricingRulesPage = lazy(() => import("@/pages/pricing-rules"));
const MenuHeatmapPage = lazy(() => import("@/pages/menu-heatmap"));
const MenuAbTestsPage = lazy(() => import("@/pages/menu-ab-tests"));
const MenuSearchAnalyticsPage = lazy(() => import("@/pages/menu-search-analytics"));
const MenuModifierBuilderPage = lazy(() => import("@/pages/menu-modifier-builder"));
const MenuTasteProfilesPage = lazy(() => import("@/pages/menu-taste-profiles"));
const MenuGroupQrPage = lazy(() => import("@/pages/menu-group-qr"));
const MenuSplitCartPage = lazy(() => import("@/pages/menu-split-cart"));
const MenuLifecyclePage = lazy(() => import("@/pages/menu-lifecycle"));
const MenuLaunchesPage = lazy(() => import("@/pages/menu-launches"));
const MenuPhotoApprovalsPage = lazy(() => import("@/pages/menu-photo-approvals"));
const MenuBrandAssetsPage = lazy(() => import("@/pages/menu-brand-assets"));
const GrowthEnginePage = lazy(() => import("@/pages/growth-engine"));
const LoyaltyAnalyticsPage = lazy(() => import("@/pages/loyalty-analytics"));
const LoyaltyNetworkPage = lazy(() => import("@/pages/loyalty-network"));
const DocumentsPage = lazy(() => import("@/pages/documents"));
const WalletsPage = lazy(() => import("@/pages/wallets"));
const GiftCardsPage = lazy(() => import("@/pages/gift-cards"));
const SettlementReconPage = lazy(() => import("@/pages/settlement-recon"));
const AggregatorReconPage = lazy(() => import("@/pages/aggregator-recon"));
const CapitalInsurancePage = lazy(() => import("@/pages/capital-insurance"));
const AdminFintechPage = lazy(() => import("@/pages/admin-fintech"));
const AdminPhonePePage = lazy(() => import("@/pages/admin-phonepe"));
const AdminFinancePartnersPage = lazy(() => import("@/pages/admin-finance-partners"));
const HealthScorePage = lazy(() => import("@/pages/health-score"));
const SustainabilityPage = lazy(() => import("@/pages/sustainability"));
const SopTrainingPage = lazy(() => import("@/pages/sop-training"));
const MysteryAuditsPage = lazy(() => import("@/pages/mystery-audits"));
const MyTrainingPage = lazy(() => import("@/pages/my-training"));
const PortalHomePage = lazy(() => import("@/pages/portal"));
const PortalAttendancePage = lazy(() => import("@/pages/portal/attendance"));
const PortalShiftsPage = lazy(() => import("@/pages/portal/shifts"));
const PortalLeavesPage = lazy(() => import("@/pages/portal/leaves"));
const PortalPayrollPage = lazy(() => import("@/pages/portal/payroll"));
const PortalTasksPage = lazy(() => import("@/pages/portal/tasks"));
const PortalAnnouncementsPage = lazy(() => import("@/pages/portal/announcements"));
const PortalScorecardPage = lazy(() => import("@/pages/portal/scorecard"));
const PortalIncentivesPage = lazy(() => import("@/pages/portal/incentives"));
const PortalDocumentsPage = lazy(() => import("@/pages/portal/documents"));
const PortalHelpPage = lazy(() => import("@/pages/portal/help"));
const PortalTrainingPage = lazy(() => import("@/pages/portal/training"));
const FoodCourtsPage = lazy(() => import("@/pages/food-courts"));
const FoodCourtVendorsPage = lazy(() => import("@/pages/food-court-vendors"));
const FoodCourtPosPage = lazy(() => import("@/pages/food-court-pos"));
const FoodCourtOverviewPage = lazy(() => import("@/pages/food-court-overview"));
const FoodCourtTokensPage = lazy(() => import("@/pages/food-court-tokens"));
const FoodCourtSettlementsPage = lazy(() => import("@/pages/food-court-settlements"));
const FoodCourtReportsPage = lazy(() => import("@/pages/food-court-reports"));
const FoodCourtMyCounterPage = lazy(() => import("@/pages/food-court-my-counter"));
const MembershipsPage = lazy(() => import("@/pages/memberships"));
const CorporateDashboardPage = lazy(() => import("@/pages/corporate-dashboard"));
const CorporateCompaniesPage = lazy(() => import("@/pages/corporate-companies"));
const CorporateCompanyDetailPage = lazy(() => import("@/pages/corporate-company-detail"));
const CorporateApprovalsPage = lazy(() => import("@/pages/corporate-approvals"));
const CorporateBulkOrdersPage = lazy(() => import("@/pages/corporate-bulk-orders"));
const CorporateScheduledPage = lazy(() => import("@/pages/corporate-scheduled"));
const CorporateInvoicesPage = lazy(() => import("@/pages/corporate-invoices"));
const CorporateInvoiceDetailPage = lazy(() => import("@/pages/corporate-invoice-detail"));
const TiffinPlansPage = lazy(() => import("@/pages/tiffin-plans"));
const TiffinSubscriptionsPage = lazy(() => import("@/pages/tiffin-subscriptions"));
const TiffinDeliveriesPage = lazy(() => import("@/pages/tiffin-deliveries"));
const TiffinBillingPage = lazy(() => import("@/pages/tiffin-billing"));
const TiffinCustomerHistoryPage = lazy(() => import("@/pages/tiffin-customer-history"));
const OpsDigitalTwinPage = lazy(() => import("@/pages/ops-digital-twin"));
const OpsPanicPage = lazy(() => import("@/pages/ops-panic"));
const OpsHandoverPage = lazy(() => import("@/pages/ops-handover"));
const OpsBriefingsPage = lazy(() => import("@/pages/ops-briefings"));
const OpsChecklistsPage = lazy(() => import("@/pages/ops-checklists"));
const OpsTimelinePage = lazy(() => import("@/pages/ops-timeline"));
const OpsReportsPage = lazy(() => import("@/pages/ops-reports"));
const OpsApprovalsPage = lazy(() => import("@/pages/ops-approvals"));
const OpsIncidentsPage = lazy(() => import("@/pages/ops-incidents"));
const KitchenCleaningPage = lazy(() => import("@/pages/kitchen-cleaning"));
const KitchenTemperaturesPage = lazy(() => import("@/pages/kitchen-temperatures"));
const KitchenEquipmentPage = lazy(() => import("@/pages/kitchen-equipment"));
const CompetitorsPage = lazy(() => import("@/pages/competitors"));
const CompetitorDetailPage = lazy(() => import("@/pages/competitor-detail"));
const CompetitorComparisonPage = lazy(() => import("@/pages/competitor-comparison"));
const CanteenStudentsPage = lazy(() => import("@/pages/canteen-students"));
const CanteenMealPlansPage = lazy(() => import("@/pages/canteen-meal-plans"));
const CanteenPosPage = lazy(() => import("@/pages/canteen-pos"));
const CanteenParentPage = lazy(() => import("@/pages/canteen-parent"));
const CanteenReportsPage = lazy(() => import("@/pages/canteen-reports"));
const CanteenHelpPage = lazy(() => import("@/pages/canteen-help"));
const UpgradeRequiredPage = lazy(() => import("@/pages/upgrade-required"));

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-muted-foreground text-sm">Loading…</div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10000,
    },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="text-muted-foreground text-sm">Loading…</div></div>;
  if (!isAuthenticated) return <Redirect to="/login" />;
  // First-time owners / managers should see the animated welcome intro before
  // anything else. Skip for super-admins and staff portal roles.
  if (
    user &&
    !user.isSuperAdmin &&
    (user.role === "owner" || user.role === "manager") &&
    !hasSeenWelcome(user.id) &&
    Component !== WelcomePage
  ) {
    return <Redirect to="/welcome" />;
  }
  return <Component />;
}

function RoleProtectedRoute({ component: Component, allow }: { component: React.ComponentType; allow: string[] }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="text-muted-foreground text-sm">Loading…</div></div>;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (!user || (!user.isSuperAdmin && !allow.includes(user.role))) return <Redirect to="/dashboard" />;
  if (
    !user.isSuperAdmin &&
    (user.role === "owner" || user.role === "manager") &&
    !hasSeenWelcome(user.id)
  ) {
    return <Redirect to="/welcome" />;
  }
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
    if (user && (user.role === "owner" || user.role === "manager") && !hasSeenWelcome(user.id)) {
      return <Redirect to="/welcome" />;
    }
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
  if (user && (user.role === "owner" || user.role === "manager") && !hasSeenWelcome(user.id)) {
    return <Redirect to="/welcome" />;
  }
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
    <Suspense fallback={<PageFallback />}>
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
      <Route path="/welcome" component={() => <ProtectedRoute component={WelcomePage} />} />
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
      <Route path="/admin/app-downloads" component={() => <SuperAdminRoute component={AdminAppDownloadsPage} />} />
      <Route path="/download-apps" component={() => <ProtectedRoute component={DownloadAppsPage} />} />
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
      <Route path="/settings/bill-templates" component={() => <RoleProtectedRoute component={SettingsBillTemplatesPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/counters" component={() => <RoleProtectedRoute component={SettingsCountersPage} allow={["owner", "manager"]} />} />
      {/* Card-terminal pairing/management is a baseline POS need — keep the
          role gate, but drop the plan gate so tenants on any plan can reach
          the page (the backend gate is removed too). */}
      <Route path="/settings/terminals" component={() => <RoleProtectedRoute component={SettingsTerminalsPage} allow={["owner", "manager", "cashier"]} />} />
      {/* Common-typo redirect: singular → plural (the actual page route). */}
      <Route path="/settings/terminal"><Redirect to="/settings/terminals" /></Route>
      <Route path="/settings/token-display" component={() => <RoleProtectedRoute component={SettingsTokenDisplayPage} allow={["owner", "manager"]} />} />
      <Route path="/settings/guest-verification" component={() => <RoleProtectedRoute component={SettingsGuestVerificationPage} allow={["owner"]} />} />
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
      <Route path="/events" component={() => <RoleProtectedRoute component={() => <PlanProtectedRoute component={EventsPage} feature="events_catering" />} allow={["owner", "manager", "waiter", "kitchen"]} />} />
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
    </Suspense>
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
