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
  todayLabourHours?: string;
  todayLabourCost?: string;
  branchCount?: number;
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
  expectedPrepMinutes?: number | null;
  expectedReadyAt?: string | null;
  delayAlertCount?: number;
  lastDelayAlertAt?: string | null;
  elapsedMinutes?: number;
  overdueMinutes?: number;
  isDelayed?: boolean;
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
  needsCleaning?: boolean;
  lastCleanedAt?: string | null;
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
  allergens: string[] | null;
  sortOrder: number;
  kitchenId: number | null;
  proteinG?: string | null;
  fatG?: string | null;
  carbsG?: string | null;
  containsDairy?: boolean | null;
  containsNuts?: boolean | null;
  containsGluten?: boolean | null;
  isVegan?: boolean | null;
  isJain?: boolean | null;
  spicyLevel?: number | null;
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
  allergens?: string[];
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
  allergens?: string[];
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
  parLevel: string | null;
  reorderQuantity: string | null;
  autoReorderEnabled: boolean;
  costPerUnit: string;
  category: string;
  isActive: boolean;
  isLowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderLineItem {
  id: number;
  purchaseOrderId: number;
  inventoryItemId: number | null;
  name: string;
  unit: string;
  quantity: string;
  costPerUnit: string;
  createdAt: string;
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
  paidAmount?: string;
  notes: string | null;
  isAutoDrafted?: boolean;
  draftedAt?: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items?: PurchaseOrderLineItem[];
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
  parLevel?: string | null;
  reorderQuantity?: string | null;
  autoReorderEnabled?: boolean;
}

export interface CreateInventoryItemInput {
  name: string;
  unit: string;
  currentStock: string;
  minStockLevel: string;
  costPerUnit: string;
  category: string;
  supplierId?: number | null;
  parLevel?: string | null;
  reorderQuantity?: string | null;
  autoReorderEnabled?: boolean;
}

export interface AutoReorderRunResult {
  restaurantId: number;
  draftsCreated: number;
  itemsConsidered: number;
  draftIds: number[];
  skipped: { reason: string; itemIds: number[] }[];
}

export interface RecipeMapping {
  id: number;
  restaurantId: number;
  menuItemId: number;
  inventoryItemId: number;
  quantity: string;
  unit: string;
  createdAt: string;
  inventoryItemName?: string | null;
  inventoryUnit?: string | null;
  costPerUnit?: string | null;
}

export interface CreateRecipeMappingInput {
  menuItemId: number;
  inventoryItemId: number;
  quantity: string;
  unit: string;
}

export interface UpdateRecipeMappingInput {
  id: number;
  quantity?: string;
  unit?: string;
}

export interface FoodCostItem {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string | null;
  price: string;
  cogs: string;
  margin: number;
  foodCostPct: number;
  hasRecipe: boolean;
  ingredientCount: number;
  isLowMargin: boolean;
}

export interface FoodCostReport {
  threshold: number;
  items: FoodCostItem[];
}

export interface AdjustInventoryInput {
  id: number;
  type: string;
  quantity: string;
  notes: string;
  batchNumber?: string | null;
  expiryDate?: string | null;
}

export interface InventoryItemBatch {
  id: number;
  restaurantId: number;
  inventoryItemId: number;
  batchNumber: string | null;
  quantityReceived: string;
  quantityRemaining: string;
  expiryDate: string | null;
  receivedAt: string;
  purchaseOrderId: number | null;
  purchaseOrderItemId: number | null;
  notes: string | null;
}

export interface StaffMember {
  id: number;
  staffId: number | null;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  avatarUrl: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  employeeCode: string | null;
  jobTitle: string | null;
  department: string | null;
  salary: string | null;
  salaryType: string | null;
  hiredAt: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  emergencyContact: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  notes: string | null;
  outstandingAdvance?: string | null;
}

export interface SalaryComponent {
  id: number;
  structureId: number;
  restaurantId: number;
  name: string;
  amount: string;
  isRecurring: boolean;
  isTaxable: boolean;
  createdAt: string;
}

export interface SalaryStructure {
  id: number;
  userId: number;
  restaurantId: number;
  type: "fixed_monthly" | "daily_wage" | "hourly_wage" | "commission" | "custom";
  baseAmount: string | null;
  hourlyRate: string | null;
  dailyRate: string | null;
  commissionRate: string | null;
  commissionBase: string | null;
  currency: string;
  effectiveFrom: string | null;
  createdAt: string;
  updatedAt: string;
  components: SalaryComponent[];
}

export interface SaveSalaryStructureInput {
  type: SalaryStructure["type"];
  baseAmount?: string | null;
  hourlyRate?: string | null;
  dailyRate?: string | null;
  commissionRate?: string | null;
  commissionBase?: string | null;
  currency?: string;
  effectiveFrom?: string | null;
  components: Array<{ name: string; amount: string; isRecurring?: boolean; isTaxable?: boolean }>;
}

export interface StaffAdvance {
  id: number;
  userId: number;
  restaurantId: number;
  amount: string;
  paidOn: string;
  notes: string | null;
  recordedByUserId: number | null;
  settledAmount: string;
  runningBalance?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffAdvancesResponse {
  rows: StaffAdvance[];
  outstanding: string;
  advanced: string;
  settled: string;
}

export interface StaffAdjustment {
  id: number;
  userId: number;
  restaurantId: number;
  kind: "bonus" | "deduction";
  amount: string;
  label: string;
  appliesToMonth: string | null;
  isRecurring: boolean;
  recordedByUserId: number | null;
  createdAt: string;
}

export interface PerformanceNote {
  id: number;
  userId: number;
  restaurantId: number;
  authorUserId: number | null;
  authorName: string | null;
  rating: number | null;
  body: string;
  createdAt: string;
}

export interface StaffProfilePatch {
  name?: string;
  email?: string;
  phone?: string | null;
  role?: string;
  employeeCode?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  salary?: string | null;
  salaryType?: string | null;
  hiredAt?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  emergencyContact?: string | null;
  emergencyContactName?: string | null;
  emergencyContactRelation?: string | null;
  notes?: string | null;
}

export interface StaffDocument {
  id: number;
  staffId: number;
  restaurantId: number;
  label: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedByUserId: number | null;
  createdAt: string;
}

export interface StaffBankAccount {
  id: number;
  staffId: number;
  restaurantId: number;
  accountName: string | null;
  accountNumber: string | null;
  accountNumberMasked: string | null;
  ifsc: string | null;
  bankName: string | null;
  upiId: string | null;
  updatedAt: string;
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
export type ReservationOccasion = "birthday" | "anniversary" | "business" | "date" | "celebration" | "other";
export type ReservationDepositStatus = "none" | "required" | "pending" | "paid" | "refunded" | "waived";
export type ReservationSourceChannel = "staff" | "public" | "walkin" | "phone" | "mobile";

export interface Reservation {
  id: number;
  restaurantId: number;
  tableId: number | null;
  customerId: number | null;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  partySize: number;
  scheduledAt: string;
  durationMinutes: number;
  status: ReservationStatus;
  notes: string | null;
  occasion: ReservationOccasion | null;
  occasionNotes: string | null;
  seatingNotes: string | null;
  isVip: boolean;
  depositAmount: string | null;
  depositStatus: ReservationDepositStatus;
  depositPaymentRef: string | null;
  gracePeriodMinutes: number;
  sourceChannel: ReservationSourceChannel;
  walkInArrivedAt: string | null;
  estimatedWaitMinutes: number | null;
  cleaningRequiredOnComplete: boolean;
  reminderSentAt: string | null;
  noShowMarkedAt: string | null;
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
  occasion?: ReservationOccasion | null;
  occasionNotes?: string;
  seatingNotes?: string;
  isVip?: boolean;
  depositAmount?: string | number | null;
  depositStatus?: ReservationDepositStatus;
  gracePeriodMinutes?: number;
  sourceChannel?: ReservationSourceChannel;
  customerId?: number | null;
  cleaningRequiredOnComplete?: boolean;
}

export interface UpdateReservationInput {
  id: number;
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  partySize?: number;
  scheduledAt?: string;
  durationMinutes?: number;
  status?: ReservationStatus;
  notes?: string;
  tableId?: number | null;
  occasion?: ReservationOccasion | null;
  occasionNotes?: string;
  seatingNotes?: string;
  isVip?: boolean;
  depositAmount?: string | number | null;
  depositStatus?: ReservationDepositStatus;
  depositPaymentRef?: string | null;
  gracePeriodMinutes?: number;
  estimatedWaitMinutes?: number | null;
  cleaningRequiredOnComplete?: boolean;
}

export type WaitlistStatus = "waiting" | "notified" | "seated" | "cancelled" | "no_show";

export interface WaitlistEntry {
  id: number;
  restaurantId: number;
  customerId: number | null;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  estimatedWaitMinutes: number | null;
  quotedAt: string;
  status: WaitlistStatus;
  notifiedAt: string | null;
  seatedAt: string | null;
  seatedTableId: number | null;
  reservationId: number | null;
  notes: string | null;
  occasion: ReservationOccasion | null;
  isVip: boolean;
  sourceChannel: ReservationSourceChannel;
  createdAt: string;
}

export interface CreateWaitlistInput {
  guestName: string;
  guestPhone?: string;
  partySize: number;
  estimatedWaitMinutes?: number;
  notes?: string;
  occasion?: ReservationOccasion | null;
  isVip?: boolean;
  sourceChannel?: ReservationSourceChannel;
  customerId?: number | null;
}

export interface UpdateWaitlistInput {
  id: number;
  guestName?: string;
  guestPhone?: string;
  partySize?: number;
  estimatedWaitMinutes?: number | null;
  notes?: string;
  occasion?: ReservationOccasion | null;
  isVip?: boolean;
  status?: WaitlistStatus;
  seatedTableId?: number | null;
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
  enableVoiceOrdering?: boolean;
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
  endDate: string | null;
  recurringDays: string[];
}

export type AttendanceStatus = "present" | "late" | "half_day" | "absent" | "weekly_off" | "leave";

export interface AttendanceRecord {
  id: number;
  userId: number;
  restaurantId: number;
  date: string | null;
  status: AttendanceStatus;
  clockIn: string;
  clockOut: string | null;
  totalHours: string | null;
  scheduledShiftId: number | null;
  scheduledMinutes: number | null;
  workedMinutes: number | null;
  lateMinutes: number | null;
  overtimeMinutes: number | null;
  source: string;
  markedByUserId: number | null;
  notes: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  restaurantId: number | null;
  targetRestaurantId?: number | null;
  userId: number | null;
  userDisplay?: string | null;
  role?: string | null;
  module?: string;
  action: string;
  entity: string;
  entityId: number | null;
  details: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface AuditLogList {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditLogDetail extends AuditLog {
  restaurantName?: string | null;
  userEmail?: string | null;
}

export interface FraudAlert {
  id: number;
  restaurantId: number;
  detector: string;
  severity: "low" | "medium" | "high";
  status: "open" | "acknowledged" | "resolved" | "false_positive";
  subjectUserId: number | null;
  subjectRole: string | null;
  entityType: string | null;
  entityId: number | null;
  windowStart: string;
  windowEnd: string;
  score: string;
  threshold: string | null;
  observedValue: string | null;
  evidence: Record<string, unknown>;
  aiSummary: string | null;
  aiSummaryFallback: boolean;
  reviewedByUserId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
  subjectName?: string | null;
}

export interface FraudAlertList {
  data: FraudAlert[];
  total: number;
  page: number;
  limit: number;
}

export interface FraudDetectorSetting {
  detector: string;
  isEnabled: boolean;
  threshold: number;
  config: Record<string, unknown>;
  defaultThreshold: number;
}

export interface AuditLogFilters {
  userId?: number;
  role?: string;
  module?: string;
  action?: string;
  ip?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  restaurantId?: number;
  page?: number;
  limit?: number;
}

export interface LeavePolicy {
  id: number;
  restaurantId: number;
  leaveType: string;
  label: string;
  isPaid: boolean;
  entitlementDays: number;
  carryForwardMax: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveBalance {
  id: number;
  userId: number;
  restaurantId: number;
  year: number;
  leaveType: string;
  opening: string;
  used: string;
  createdAt: string;
  updatedAt: string;
}

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: number;
  userId: number;
  restaurantId: number;
  leaveType: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  totalDays: string;
  reason: string | null;
  status: LeaveStatus;
  decidedByUserId: number | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeavePolicyInput {
  leaveType: string;
  label: string;
  isPaid: boolean;
  entitlementDays: number;
  carryForwardMax: number;
}

export interface CreateLeaveRequestInput {
  userId?: number;
  leaveType: string;
  fromDate: string;
  toDate: string;
  halfDay?: boolean;
  reason?: string;
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
  endDate?: string | null;
  recurringDays?: string[];
}

export interface ClockInInput {
  userId: number;
  notes?: string;
  source?: "web" | "mobile" | "manual";
}

export interface MarkAttendanceInput {
  userId: number;
  date: string;
  status: AttendanceStatus;
  notes?: string;
  workedMinutes?: number;
}

export interface PatchAttendanceInput {
  id: number;
  status?: AttendanceStatus;
  notes?: string;
  workedMinutes?: number;
  overtimeMinutes?: number;
  lateMinutes?: number;
  clockIn?: string;
  clockOut?: string;
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
  currency: string;
  billingPeriod: string;
  maxRestaurants: number;
  maxBranches: number;
  maxStaff: number;
  maxTables: number;
  maxMenuItems: number;
  features: string[] | null;
  featureFlags: Record<string, boolean> | null;
  trialDays: number;
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
  cashfreeCustomerId: string | null;
  cashfreeSubscriptionId: string | null;
  subscriptionStartedAt: string | null;
  subscriptionEndsAt: string | null;
}

export interface SubscriptionUsage {
  staffCount: number;
  tableCount: number;
  menuItemCount: number;
}

export interface SubscriptionGateways {
  stripe?: boolean;
  cashfree?: boolean;
}

export interface SubscriptionInfo {
  tenant: TenantSubscription;
  plan: SubscriptionPlan | null;
  plans: SubscriptionPlan[];
  usage: SubscriptionUsage;
  gateways?: SubscriptionGateways;
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
  varianceReason: string | null;
  createdAt: string;
  openedByName?: string | null;
  closedByName?: string | null;
}

export interface CashVarianceSession {
  id: number;
  openedAt: string;
  closedAt: string | null;
  closedByUserId: number | null;
  openedByUserId: number;
  expectedCash: string | null;
  actualCash: string | null;
  overShort: string | null;
  varianceReason: string | null;
  isBlindClose: boolean;
  closedByName: string | null;
  openedByName: string | null;
}

export interface CashVarianceCashier {
  userId: number;
  name: string | null;
  sessionCount: number;
  totalVariance: number;
  totalAbsVariance: number;
  overCount: number;
  shortCount: number;
  balancedCount: number;
  lastSessionAt: string | null;
}

export interface CashVarianceHistory {
  sessions: CashVarianceSession[];
  cashiers: CashVarianceCashier[];
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
  countedAmount?: number;
  isBlindClose?: boolean;
  closeNotes?: string;
  varianceReason?: string;
}

export interface CashMovementInput {
  type: "cash_in" | "cash_out" | "drop" | "payout" | "refund";
  amount: number;
  reason?: string;
}

// ===================== Payroll =====================

export interface PayrollRun {
  id: number;
  restaurantId: number;
  periodYear: number;
  periodMonth: number;
  status: "draft" | "finalized";
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  totalAdvancesSettled: string;
  notes: string | null;
  createdByUserId: number | null;
  finalizedByUserId: number | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollItemRow {
  id: number;
  runId: number;
  userId: number;
  userName: string;
  baseAmount: string;
  grossPay: string;
  advanceSettled: string;
  netPay: string;
  paymentStatus: "pending" | "partially_paid" | "paid";
  paidAmount: string;
  overridden: boolean;
  notes: string | null;
  daysWorked: string;
  daysAbsent: string;
  daysPaidLeave: string;
  daysUnpaidLeave: string;
  overtimeMinutes: number;
  earningsBreakdown: Array<{ label: string; amount: string }>;
  deductionsBreakdown: Array<{ label: string; amount: string }>;
}

export interface PayrollRunResponse {
  run: PayrollRun;
  items: PayrollItemRow[];
}

export interface PayrollItemOverrideInput {
  bonus?: string;
  otherDeductions?: string;
  advanceSettled?: string;
  overtimeAmount?: string;
  notes?: string;
}

export interface PayrollPaymentInput {
  amount: string;
  paidOn?: string;
  mode?: "cash" | "upi" | "bank_transfer" | "other";
  reference?: string;
  notes?: string;
}

export interface PayrollPayment {
  id: number;
  itemId: number;
  runId: number;
  amount: string;
  paidOn: string;
  mode: string;
  reference: string | null;
  notes: string | null;
  recordedByUserId: number | null;
  createdAt: string;
}

export interface PayrollSummaryRow {
  userId: number;
  itemId: number;
  runId: number;
  runStatus: "draft" | "finalized";
  paymentStatus: "pending" | "partially_paid" | "paid";
  netPay: string;
  paidAmount: string;
}
