export interface DashboardSummary {
  todayRevenue: string;
  revenueGrowth: string;
  todayOrders: number;
  ordersGrowth: string;
  avgOrderValue: string;
  activeTables: number;
  totalTables: number;
  pendingTickets: number;
  lowStockAlerts: number;
  monthlyExpenses?: string;
}

export interface ExpenseCategory {
  id: number;
  restaurantId: number;
  name: string;
  color: string;
  icon: string;
  isActive: boolean;
  createdAt: string;
}

export interface Expense {
  id: number;
  restaurantId: number;
  categoryId: number;
  amount: string;
  expenseDate: string;
  payee: string | null;
  paymentMethod: string | null;
  notes: string | null;
  receiptUrl: string | null;
  recurringTemplateId: number | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpensesResponse {
  data: Expense[];
  total: number;
  totalAmount: string;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RecurringExpense {
  id: number;
  restaurantId: number;
  categoryId: number;
  name: string;
  amount: string;
  frequency: string;
  dayOfMonth: number;
  payee: string | null;
  paymentMethod: string | null;
  notes: string | null;
  nextRunDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExpenseInput {
  categoryId: number;
  amount: string;
  expenseDate: string;
  payee?: string;
  paymentMethod?: string;
  notes?: string;
  receiptUrl?: string;
}

export interface CreateRecurringExpenseInput {
  name: string;
  categoryId: number;
  amount: string;
  frequency: string;
  dayOfMonth?: number;
  payee?: string;
  paymentMethod?: string;
  notes?: string;
  nextRunDate?: string;
}

export interface ExpenseSummary {
  total: string;
  byCategory: { categoryId: number; categoryName: string; color: string; total: string; count: number }[];
}

export interface RevenueTrendItem {
  date: string;
  revenue: number;
  orders: number;
}

export interface PopularItem {
  menuItemId: number;
  name: string;
  orderCount: number;
  revenue: string;
}

export interface KitchenTicketItem {
  id: number;
  menuItemId: number | null;
  menuItemName: string;
  menuItemImageUrl?: string | null;
  quantity: number;
  notes: string | null;
}

export interface KitchenTicket {
  id: number;
  orderId: number;
  orderNumber: string;
  tableNumber: string | null;
  orderType: string;
  status: string;
  isPriority: boolean;
  kitchenId: number | null;
  kitchen: { id: number; name: string; autoPrint: boolean; printerName: string | null; paperSize: string } | null;
  createdAt: string;
  items: KitchenTicketItem[];
}

export interface Kitchen {
  id: number;
  restaurantId: number;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  printerName: string | null;
  paperSize: string;
  autoPrint: boolean;
  printerTarget: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKitchenInput {
  name: string;
  sortOrder?: number;
  printerName?: string | null;
  paperSize?: string;
  autoPrint?: boolean;
  printerTarget?: string;
  isDefault?: boolean;
}

export interface UpdateKitchenInput extends Partial<CreateKitchenInput> {
  id: number;
  isActive?: boolean;
}

export interface LiveKitchenData {
  newCount: number;
  preparingCount: number;
  readyCount: number;
  tickets: KitchenTicket[];
}

export interface AuditLogEntry {
  id: number;
  userName: string | null;
  action: string;
  entity: string;
  createdAt: string;
}

export interface Order {
  id: number;
  orderNumber: string;
  tableId: number | null;
  orderType: string;
  status: string;
  paymentStatus: string;
  totalAmount: string;
  customerName: string | null;
  isPriority: boolean;
  createdAt: string;
}

export interface OrdersResponse {
  data: Order[];
  total: number;
  page: number;
}

export interface OrderItem {
  id: number;
  orderId: number;
  menuItemId: number;
  menuItemName: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  notes: string | null;
  status: string;
}

export interface OrderDiscount {
  id: number;
  orderId: number;
  type: "percentage" | "flat" | "item" | "coupon" | "loyalty";
  scope: "order" | "item";
  orderItemId: number | null;
  value: string;
  amount: string;
  reason: string;
  couponCode: string | null;
  recordedByUserId: number | null;
  approvedByUserId: number | null;
  createdAt: string;
}

export interface OrderDetail extends Order {
  subtotal: string;
  taxAmount: string;
  serviceCharge: string;
  discountAmount: string;
  couponCode: string | null;
  loyaltyPointsRedeemed: number | null;
  customerId: number | null;
  notes: string | null;
  customerPhone: string | null;
  items: OrderItem[];
  discounts?: OrderDiscount[];
  paymentMethod?: string | null;
  paymentAmount?: string | null;
}

export interface DiscountsConfig {
  presetReasons: string[];
  thresholdPercent: number;
  thresholdAmount: number;
  hasManagerPin: boolean;
}

export interface ApplyDiscountLineInput {
  orderId: number;
  type: "percentage" | "flat" | "item";
  value: number;
  reason: string;
  orderItemId?: number;
  managerPin?: string;
}

export interface DiscountsByCashierItem {
  userId: number | null;
  name: string;
  type: string;
  reason: string;
  count: number;
  total: string;
}

export interface CreateOrderInput {
  tableId?: number;
  orderType: string;
  customerName?: string;
  customerPhone?: string;
  customerId?: number;
  notes?: string;
  isPriority?: boolean;
  items: { menuItemId: number; quantity: number; notes?: string }[];
}

export interface UpdateOrderInput {
  id: number;
  status?: string;
  paymentStatus?: string;
  notes?: string;
  isPriority?: boolean;
}

export interface PayOrderInput {
  id: number;
  paymentMethod: string;
  stripePaymentIntentId?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
}

export interface RazorpayOrderResult {
  id: string;
  amount: number;
  currency: string;
  keyId: string | null;
  mode: "live" | "demo";
}

export interface PaymentIntentResult {
  clientSecret: string | null;
  intentId: string;
  mode: "live" | "demo";
  totalAmount?: string;
}

export interface AddOrderItemInput {
  orderId: number;
  menuItemId: number;
  quantity: number;
  modifiers?: { name: string; price: string }[];
  notes?: string;
}

export interface FloorTable {
  id: number;
  tableNumber: string;
  capacity: number;
  status: string;
  positionX: number;
  positionY: number;
  shape: string;
}

export interface CreateTableInput {
  tableNumber: string;
  capacity: number;
}

export interface UpdateTableInput {
  id: number;
  status?: string;
}

export interface Menu {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  availableFrom: string | null;
  availableTo: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface MenuCategory {
  id: number;
  name: string;
  menuId: number;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface MenuItem {
  id: number;
  name: string;
  price: string;
  description: string | null;
  categoryId: number;
  isVeg: boolean;
  isAvailable: boolean;
  preparationTime: number;
  imageUrl: string | null;
  calories: number | null;
  tags: string[] | null;
  sortOrder: number;
  kitchenId: number | null;
}

export interface CreateMenuItemInput {
  name: string;
  price: string;
  description: string;
  categoryId: number;
  isVeg: boolean;
  preparationTime: number;
  imageUrl?: string | null;
  calories?: number;
  tags?: string[];
  kitchenId?: number | null;
}

export interface UpdateMenuItemInput {
  id: number;
  name?: string;
  price?: string;
  description?: string;
  categoryId?: number;
  isVeg?: boolean;
  isAvailable?: boolean;
  preparationTime?: number;
  imageUrl?: string | null;
  calories?: number;
  tags?: string[];
  sortOrder?: number;
  kitchenId?: number | null;
}

export interface InventoryItem {
  id: number;
  restaurantId: number;
  supplierId: number | null;
  name: string;
  unit: string;
  currentStock: string;
  minStockLevel: string;
  costPerUnit: string;
  category: string;
  isActive: boolean;
  isLowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: number;
  itemId: number;
  restaurantId: number;
  type: string;
  quantity: string;
  notes: string | null;
  referenceId: number | null;
  referenceType: string | null;
  createdAt: string;
}

export interface PurchaseOrder {
  id: number;
  restaurantId: number;
  supplierId: number | null;
  status: string;
  totalAmount: string;
  notes: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePurchaseOrderInput {
  supplierId?: number;
  totalAmount: string;
  notes?: string;
}

export interface Payment {
  id: number;
  restaurantId: number;
  direction: "in" | "out";
  method: string;
  amount: string;
  paymentDate: string;
  partyType: string;
  partyId: number | null;
  partyName: string | null;
  reference: string | null;
  referenceType: string;
  referenceId: number | null;
  notes: string | null;
  recordedBy: number | null;
  recordedByName: string | null;
  createdAt: string;
}

export interface PaymentsResponse {
  data: Payment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaymentSummary {
  in: Record<string, { total: string; count: number }>;
  out: Record<string, { total: string; count: number }>;
  totalIn: string;
  totalOut: string;
  net: string;
}

export interface CreatePaymentInput {
  direction: "in" | "out";
  method: string;
  amount: string | number;
  partyType?: "customer" | "supplier" | "other";
  partyId?: number | null;
  partyName?: string | null;
  referenceType?: "order" | "purchase_order" | "manual";
  referenceId?: number | null;
  notes?: string;
  paymentDate?: string;
}

export interface SettlePaymentInput {
  referenceType: "order" | "purchase_order";
  referenceId: number;
  amount: string | number;
  method: string;
  notes?: string;
}

export interface DueCustomerOrder {
  id: number;
  orderNumber: string;
  customerId: number | null;
  customerName: string;
  totalAmount: string;
  paidAmount: string;
  dueAmount: string;
  paymentStatus: string;
  createdAt: string;
}

export interface DueSupplierPO {
  id: number;
  supplierId: number | null;
  supplierName: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  dueAmount: string;
  orderedAt: string | null;
  createdAt: string;
  notes: string | null;
}

export interface CustomerCreditBalance {
  customerId: number;
  customerName: string;
  openOrders: number;
  totalDue: string;
}

export interface DuePaymentsData {
  customerOrders: DueCustomerOrder[];
  customerCredits: CustomerCreditBalance[];
  supplierPOs: DueSupplierPO[];
  totalCustomerDue: string;
  totalSupplierDue: string;
}

export interface UpdateInventoryItemInput {
  id: number;
  name?: string;
  unit?: string;
  minStockLevel?: string;
  costPerUnit?: string;
  category?: string;
  supplierId?: number | null;
  isActive?: boolean;
}

export interface CreateInventoryItemInput {
  name: string;
  unit: string;
  currentStock: string;
  minStockLevel: string;
  costPerUnit: string;
  category: string;
  supplierId?: number | null;
}

export interface RecipeMapping {
  id: number;
  restaurantId: number;
  menuItemId: number;
  inventoryItemId: number;
  quantity: string;
  unit: string;
  createdAt: string;
}

export interface CreateRecipeMappingInput {
  menuItemId: number;
  inventoryItemId: number;
  quantity: string;
  unit: string;
}

export interface AdjustInventoryInput {
  id: number;
  type: string;
  quantity: string;
  notes: string;
}

export interface StaffMember {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  phone: string;
  role: string;
  password: string;
  restaurantId: number;
  tenantId: number;
}

export interface Role {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  tenantId: number | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  permissions?: Permission[];
}

export interface Permission {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  resource: string;
  action: string;
  createdAt: string;
}

export interface Customer {
  id: number;
  restaurantId: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  totalOrders: number;
  totalSpent: string;
  loyaltyPoints: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCustomerInput {
  id: number;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  isActive?: boolean;
}

export interface CustomerAddress {
  id: number;
  customerId: number;
  restaurantId: number;
  label: string;
  address: string;
  isDefault: boolean;
  createdAt: string;
}

export interface LoyaltyTransaction {
  id: number;
  customerId: number;
  restaurantId: number;
  points: number;
  type: string;
  reason: string | null;
  orderId: number | null;
  createdAt: string;
}

export interface LoyaltyAccount {
  balance: number;
  transactions: LoyaltyTransaction[];
}

export interface Coupon {
  id: number;
  restaurantId: number;
  code: string;
  discountType: string;
  discountValue: string;
  minOrderAmount: string | null;
  maxDiscountAmount: string | null;
  usageLimit: number | null;
  usageCount: number;
  isActive: boolean;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCouponInput {
  code: string;
  discountType: "percentage" | "flat";
  discountValue: string;
  minOrderAmount?: string;
  maxDiscountAmount?: string;
  usageLimit?: number;
  validFrom?: string;
  validTo?: string;
}

export interface UpdateCouponInput {
  id: number;
  isActive?: boolean;
  validTo?: string;
  usageLimit?: number;
}

export interface CustomersResponse {
  data: Customer[];
  total: number;
}

export interface CreateCustomerInput {
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

export type ReservationStatus = "pending" | "confirmed" | "seated" | "completed" | "cancelled" | "no_show";

export interface Reservation {
  id: number;
  restaurantId: number;
  tableId: number | null;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  partySize: number;
  scheduledAt: string;
  durationMinutes: number;
  status: ReservationStatus;
  notes: string | null;
  createdAt: string;
}

export interface CreateReservationInput {
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
  tableId?: number;
  partySize: number;
  scheduledAt: string;
  durationMinutes?: number;
  notes?: string;
  status?: ReservationStatus;
}

export interface UpdateReservationInput {
  id: number;
  guestName?: string;
  guestPhone?: string;
  partySize?: number;
  scheduledAt?: string;
  durationMinutes?: number;
  status?: ReservationStatus;
  notes?: string;
  tableId?: number | null;
}

export interface WaiterRequest {
  id: number;
  restaurantId: number;
  tableId: number;
  tableNumber: string | null;
  type: "call_waiter" | "request_bill" | "water" | "custom";
  note: string | null;
  status: "pending" | "acknowledged" | "resolved";
  acknowledgedByUserId: number | null;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  resolvedByUserId: number | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface RevenueByDayItem {
  date: string;
  revenue: number;
  orders: number;
}

export interface TopItem {
  name: string;
  orderCount: number;
}

export interface StaffPerformanceItem {
  userId: number;
  name: string;
  orderCount: number;
  totalRevenue: string;
  totalHours: string;
}

export interface TaxByDayItem {
  date: string;
  tax: string;
  orders: number;
  revenue: string;
  effectiveRate: string;
}

export interface PaymentsByMethodItem {
  direction: string;
  method: string;
  total: string;
  count: number;
}

export interface ReportsData {
  totalRevenue: string;
  totalOrders: number;
  avgOrderValue: string;
  totalTax: string;
  effectiveTaxRate: string;
  revenueByDay: RevenueByDayItem[];
  taxByDay: TaxByDayItem[];
  topItems: TopItem[];
  staffPerformance: StaffPerformanceItem[];
  totalExpenses?: string;
  netProfit?: string;
  expensesByCategory?: { categoryId: number; categoryName: string; color: string; total: string }[];
  paymentsByMethod?: PaymentsByMethodItem[];
  discountsByCashier?: DiscountsByCashierItem[];
  totalDiscounts?: string;
}

export interface Supplier {
  id: number;
  restaurantId: number;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierInput {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface UpdateSupplierInput {
  id: number;
  name?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  isActive?: boolean;
}

export interface RestaurantInfo {
  id: number;
  name: string;
  slug?: string;
  taxRate: string;
  serviceCharge: string;
  logoUrl: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface PosModifier {
  id: number;
  name: string;
  price: string;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface PosModifierGroup {
  id: number;
  menuItemId: number;
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  modifiers: PosModifier[];
}

export interface ModifierGroup {
  id: number;
  menuItemId: number;
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
}

export interface Modifier {
  id: number;
  groupId: number;
  name: string;
  price: string;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface Shift {
  id: number;
  restaurantId: number;
  name: string;
  startTime: string;
  endTime: string;
  days: string[];
  isActive: boolean;
  createdAt: string;
}

export interface StaffShift {
  id: number;
  userId: number;
  shiftId: number;
  restaurantId: number;
  date: string;
}

export interface AttendanceRecord {
  id: number;
  userId: number;
  restaurantId: number;
  clockIn: string;
  clockOut: string | null;
  totalHours: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  restaurantId: number | null;
  userId: number | null;
  action: string;
  entity: string;
  entityId: number | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
}


export interface CreateShiftInput {
  name: string;
  startTime: string;
  endTime: string;
  days: string[];
}

export interface CreateStaffShiftInput {
  userId: number;
  shiftId: number;
  date: string;
}

export interface ClockInInput {
  userId: number;
  notes?: string;
}

export interface CreateMenuInput {
  name: string;
  description?: string;
  imageUrl?: string | null;
  availableFrom?: string;
  availableTo?: string;
}

export interface UpdateMenuInput {
  id: number;
  name?: string;
  description?: string;
  imageUrl?: string | null;
  availableFrom?: string | null;
  availableTo?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface CreateCategoryInput {
  menuId: number;
  name: string;
  description?: string;
  imageUrl?: string | null;
  sortOrder?: number;
}

export interface UpdateCategoryInput {
  id: number;
  name?: string;
  description?: string;
  imageUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface CreateModifierGroupInput {
  name: string;
  isRequired?: boolean;
  minSelections?: number;
  maxSelections?: number;
}

export interface CreateModifierInput {
  name: string;
  price: string;
  isDefault?: boolean;
}

export interface SubscriptionPlan {
  id: number;
  name: string;
  slug: string;
  price: string;
  billingPeriod: string;
  maxRestaurants: number;
  maxBranches: number;
  maxStaff: number;
  maxTables: number;
  maxMenuItems: number;
  features: string[] | null;
  isActive: boolean;
  stripePriceId: string | null;
}

export interface TenantSubscription {
  id: number;
  name: string;
  planStatus: string;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  isTrialExpired: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStartedAt: string | null;
  subscriptionEndsAt: string | null;
}

export interface SubscriptionUsage {
  staffCount: number;
  tableCount: number;
  menuItemCount: number;
}

export interface SubscriptionInfo {
  tenant: TenantSubscription;
  plan: SubscriptionPlan | null;
  plans: SubscriptionPlan[];
  usage: SubscriptionUsage;
}

export const INR_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export interface CashRegisterSession {
  id: number;
  restaurantId: number;
  openedByUserId: number;
  openedAt: string;
  closedByUserId: number | null;
  closedAt: string | null;
  shiftId: number | null;
  openingFloat: string;
  expectedCash: string | null;
  actualCash: string | null;
  overShort: string | null;
  isBlindClose: boolean;
  status: "open" | "closed";
  notes: string | null;
  closeNotes: string | null;
  createdAt: string;
  openedByName?: string | null;
  closedByName?: string | null;
}

export interface CashMovement {
  id: number;
  sessionId: number;
  restaurantId: number;
  type: "sale" | "refund" | "cash_in" | "cash_out" | "drop" | "payout";
  amount: string;
  reason: string | null;
  referenceType: string | null;
  referenceId: number | null;
  createdByUserId: number | null;
  createdAt: string;
  createdByName?: string | null;
}

export interface CashDenominationCount {
  id: number;
  sessionId: number;
  phase: "opening" | "closing";
  denomination: number;
  count: number;
  createdAt: string;
}

export interface CashRegisterTotals {
  openingFloat: number;
  cashSales: number;
  refunds: number;
  cashIn: number;
  cashOut: number;
  drops: number;
  payouts: number;
  totalCashIn: number;
  totalCashOut: number;
  expectedCash: number;
  actualCash?: number;
  overShort?: number;
}

export interface CashRegisterCurrent {
  session: CashRegisterSession | null;
  totals: CashRegisterTotals | null;
}

export interface CashRegisterSessionDetail {
  session: CashRegisterSession;
  movements: CashMovement[];
  openingDenominations: CashDenominationCount[];
  closingDenominations: CashDenominationCount[];
  totals: CashRegisterTotals;
}

export interface CashRegisterSessionsResponse {
  data: CashRegisterSession[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CashRegisterReport {
  kind: "X" | "Z";
  session: CashRegisterSession;
  totals: CashRegisterTotals;
  tenderSummary: Record<string, { in: number; out: number; count: number }>;
  orderCount: number;
  grossRevenue: string;
  movements: CashMovement[];
  periodFrom: string;
  periodTo: string;
}

export interface OpenRegisterInput {
  denominations: { denomination: number; count: number }[];
  notes?: string;
  shiftId?: number;
}

export interface CloseRegisterInput {
  denominations: { denomination: number; count: number }[];
  isBlindClose?: boolean;
  closeNotes?: string;
}

export interface CashMovementInput {
  type: "cash_in" | "cash_out" | "drop" | "payout" | "refund";
  amount: number;
  reason?: string;
}
