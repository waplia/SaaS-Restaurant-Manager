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
  isActive: boolean;
}

export interface MenuCategory {
  id: number;
  name: string;
  menuId: number;
  sortOrder: number;
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
}

export interface CreateMenuItemInput {
  name: string;
  price: string;
  description: string;
  categoryId: number;
  isVeg: boolean;
  preparationTime: number;
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
}

export interface CreateUserInput {
  name: string;
  email: string;
  phone: string;
  role: string;
  passwordHash: string;
  restaurantId: number;
  tenantId: number;
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
  customerName: string;
  partySize: number;
  reservationTime: string;
  status: string;
  notes: string | null;
}

export interface CreateReservationInput {
  customerName: string;
  partySize: number;
  reservationTime: string;
  notes?: string;
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
