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
  menuItemName: string;
  quantity: number;
  notes: string | null;
}

export interface KitchenTicket {
  id: number;
  orderNumber: string;
  tableNumber: string | null;
  orderType: string;
  status: string;
  isPriority: boolean;
  createdAt: string;
  items: KitchenTicketItem[];
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

export interface OrderDetail extends Order {
  subtotal: string;
  taxAmount: string;
  serviceCharge: string;
  discountAmount: string;
  notes: string | null;
  customerPhone: string | null;
  items: OrderItem[];
}

export interface CreateOrderInput {
  tableId?: number;
  orderType: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  discountAmount?: string;
  isPriority?: boolean;
  items: { menuItemId: number; quantity: number; notes?: string }[];
}

export interface UpdateOrderInput {
  id: number;
  status?: string;
  paymentStatus?: string;
  discountAmount?: string;
  notes?: string;
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

export interface ApplyDiscountInput {
  orderId: number;
  discountAmount: number;
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
}

export interface CreateMenuItemInput {
  name: string;
  price: string;
  description: string;
  categoryId: number;
  isVeg: boolean;
  preparationTime: number;
  imageUrl?: string;
  calories?: number;
  tags?: string[];
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
  imageUrl?: string;
  calories?: number;
  tags?: string[];
  sortOrder?: number;
}

export interface InventoryItem {
  id: number;
  name: string;
  unit: string;
  currentStock: string;
  minStockLevel: string;
  costPerUnit: string;
  category: string;
  isLowStock: boolean;
}

export interface CreateInventoryItemInput {
  name: string;
  unit: string;
  currentStock: string;
  minStockLevel: string;
  costPerUnit: string;
  category: string;
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
  name: string;
  email: string | null;
  phone: string | null;
  totalOrders: number;
  totalSpent: string;
  loyaltyPoints: number;
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

export interface Reservation {
  id: number;
  restaurantId: number;
  tableId: number | null;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  partySize: number;
  scheduledAt: string;
  status: string;
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
  notes?: string;
}

export interface UpdateReservationInput {
  id: number;
  guestName?: string;
  guestPhone?: string;
  partySize?: number;
  scheduledAt?: string;
  status?: string;
  notes?: string;
  tableId?: number | null;
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
}

export interface Supplier {
  id: number;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
}

export interface RestaurantInfo {
  id: number;
  name: string;
  taxRate: string;
  serviceCharge: string;
  logoUrl: string | null;
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
  availableFrom?: string;
  availableTo?: string;
}

export interface UpdateMenuInput {
  id: number;
  name?: string;
  description?: string;
  availableFrom?: string | null;
  availableTo?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface CreateCategoryInput {
  menuId: number;
  name: string;
  description?: string;
  imageUrl?: string;
  sortOrder?: number;
}

export interface UpdateCategoryInput {
  id: number;
  name?: string;
  description?: string;
  imageUrl?: string;
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
