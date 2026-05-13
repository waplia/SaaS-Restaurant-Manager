import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "./api";
import type {
  DashboardSummary, RevenueTrendItem, PopularItem, LiveKitchenData, AuditLogEntry,
  OrdersResponse, CreateOrderInput, UpdateOrderInput, PayOrderInput,
  FloorTable, CreateTableInput, UpdateTableInput,
  Menu, MenuCategory, MenuItem, CreateMenuItemInput, UpdateMenuItemInput,
  CreateMenuInput, UpdateMenuInput, CreateCategoryInput, UpdateCategoryInput,
  ModifierGroup, Modifier, CreateModifierGroupInput, CreateModifierInput,
  InventoryItem, CreateInventoryItemInput, AdjustInventoryInput, UpdateInventoryItemInput,
  InventoryTransaction, PurchaseOrder, CreatePurchaseOrderInput,
  StaffMember, CreateUserInput,
  Shift, StaffShift, AttendanceRecord, AuditLog,
  CreateShiftInput, CreateStaffShiftInput, ClockInInput,
  Customer, CustomersResponse, CreateCustomerInput, UpdateCustomerInput,
  LoyaltyAccount, LoyaltyTransaction,
  Coupon, CreateCouponInput, UpdateCouponInput,
  CreateReservationInput, UpdateReservationInput, Reservation,
  AppNotification,
  ReportsData,
  Supplier, CreateSupplierInput, UpdateSupplierInput,
  Role, Permission,
} from "./types";

const RESTAURANT_ID = 1;

export function useRestaurantId() {
  return RESTAURANT_ID;
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboard", "summary", RESTAURANT_ID],
    queryFn: () => apiGet<DashboardSummary>(`/restaurants/${RESTAURANT_ID}/dashboard/summary`),
    refetchInterval: 30000,
  });
}

export function useRevenueTrend(period = "7d", groupBy = "daily") {
  return useQuery({
    queryKey: ["dashboard", "revenue-trend", RESTAURANT_ID, period, groupBy],
    queryFn: () => apiGet<RevenueTrendItem[]>(`/restaurants/${RESTAURANT_ID}/dashboard/revenue-trend?period=${period}&groupBy=${groupBy}`),
  });
}

export function usePopularItems(limit = 8) {
  return useQuery({
    queryKey: ["dashboard", "popular-items", RESTAURANT_ID, limit],
    queryFn: () => apiGet<PopularItem[]>(`/restaurants/${RESTAURANT_ID}/dashboard/popular-items?limit=${limit}`),
  });
}

export function useLiveKitchen() {
  return useQuery({
    queryKey: ["dashboard", "live-kitchen", RESTAURANT_ID],
    queryFn: () => apiGet<LiveKitchenData>(`/restaurants/${RESTAURANT_ID}/dashboard/live-kitchen`),
    refetchInterval: 10000,
  });
}

export function useStaffActivity() {
  return useQuery({
    queryKey: ["dashboard", "staff-activity", RESTAURANT_ID],
    queryFn: () => apiGet<AuditLogEntry[]>(`/restaurants/${RESTAURANT_ID}/dashboard/staff-activity`),
  });
}

export function useOrders(params?: { status?: string; tableId?: number; page?: number }) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.tableId) q.set("tableId", String(params.tableId));
  if (params?.page) q.set("page", String(params.page));
  return useQuery({
    queryKey: ["orders", RESTAURANT_ID, params],
    queryFn: () => apiGet<OrdersResponse>(`/restaurants/${RESTAURANT_ID}/orders?${q}`),
    refetchInterval: 15000,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateOrderInput) => apiPost(`/restaurants/${RESTAURANT_ID}/orders`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] }),
  });
}

export function useUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateOrderInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/orders/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] }),
  });
}

export function usePayOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: PayOrderInput) => apiPost(`/restaurants/${RESTAURANT_ID}/orders/${id}/pay`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] }),
  });
}

export function useRestaurantInfo() {
  return useQuery({
    queryKey: ["restaurant", RESTAURANT_ID],
    queryFn: () => apiGet<import("./types").RestaurantInfo>(`/restaurants/${RESTAURANT_ID}`),
    staleTime: 60000,
  });
}

export function useItemModifierGroups(menuItemId?: number) {
  return useQuery({
    queryKey: ["modifier-groups", menuItemId],
    queryFn: async () => {
      const groups = await apiGet<import("./types").PosModifierGroup[]>(`/items/${menuItemId}/modifier-groups`);
      const withMods = await Promise.all(
        groups.map(async g => {
          const modifiers = await apiGet<import("./types").PosModifier[]>(`/modifier-groups/${g.id}/modifiers`);
          return { ...g, modifiers: modifiers.filter(m => m.isAvailable) };
        })
      );
      return withMods as import("./types").PosModifierGroup[];
    },
    enabled: !!menuItemId,
    staleTime: 30000,
  });
}

export function useCreatePaymentIntent() {
  return useMutation({
    mutationFn: ({ orderId, amount }: { orderId: number; amount?: number }) =>
      apiPost<import("./types").PaymentIntentResult>(
        `/restaurants/${RESTAURANT_ID}/orders/${orderId}/payment-intent`,
        amount !== undefined ? { customAmount: amount } : {}
      ),
  });
}

export function useCreateRazorpayOrder() {
  return useMutation({
    mutationFn: ({ orderId, amount }: { orderId: number; amount?: number }) =>
      apiPost<import("./types").RazorpayOrderResult>(
        `/restaurants/${RESTAURANT_ID}/orders/${orderId}/razorpay-order`,
        amount !== undefined ? { customAmount: amount } : {}
      ),
  });
}

export function useSplitOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, splits }: {
      orderId: number;
      splits: Array<{
        paymentMethod: string;
        amount: number;
        amountTendered?: number;
        stripePaymentIntentId?: string;
        razorpayPaymentId?: string;
        razorpayOrderId?: string;
        razorpaySignature?: string;
      }>;
    }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/split`, { splits }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["tables", RESTAURANT_ID] });
    },
  });
}

export function useOrderDetail(id?: number) {
  return useQuery({
    queryKey: ["orders", "detail", RESTAURANT_ID, id],
    queryFn: () => apiGet<import("./types").OrderDetail>(`/restaurants/${RESTAURANT_ID}/orders/${id}`),
    enabled: !!id,
  });
}

export function useAddOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, ...data }: import("./types").AddOrderItemInput) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/items`, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["orders", "detail", RESTAURANT_ID, vars.orderId] });
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
    },
  });
}

export function useRemoveOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, itemId }: { orderId: number; itemId: number }) =>
      apiDelete(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/items/${itemId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useApplyDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, discountAmount }: import("./types").ApplyDiscountInput) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/discount`, { discountAmount }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["orders", "detail", RESTAURANT_ID, vars.orderId] });
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
    },
  });
}

export function useVoidOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/void`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["tables", RESTAURANT_ID] });
    },
  });
}

export function useKitchenTickets(status?: string) {
  const q = status ? `?status=${status}` : "";
  return useQuery({
    queryKey: ["kitchen", "tickets", RESTAURANT_ID, status],
    queryFn: () => apiGet<import("./types").KitchenTicket[]>(`/restaurants/${RESTAURANT_ID}/kitchen/tickets${q}`),
    refetchInterval: 8000,
  });
}

export function useUpdateTicketStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiPatch(`/restaurants/${RESTAURANT_ID}/kitchen/tickets/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kitchen"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
  });
}

export function useFloorTables() {
  return useQuery({
    queryKey: ["tables", RESTAURANT_ID],
    queryFn: () => apiGet<FloorTable[]>(`/restaurants/${RESTAURANT_ID}/tables`),
    refetchInterval: 20000,
  });
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTableInput) => apiPost(`/restaurants/${RESTAURANT_ID}/tables`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateTableInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/tables/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useGetTableQr(tableId: number | null) {
  return useQuery({
    queryKey: ["table-qr", RESTAURANT_ID, tableId],
    queryFn: () => apiGet<{ qrUrl: string; tableNumber: string }>(`/restaurants/${RESTAURANT_ID}/tables/${tableId}/qr`),
    enabled: tableId !== null,
    staleTime: 60000,
  });
}

export function useMenus() {
  return useQuery({
    queryKey: ["menus", RESTAURANT_ID],
    queryFn: () => apiGet<Menu[]>(`/restaurants/${RESTAURANT_ID}/menus`),
  });
}

export function useMenuCategories(menuId?: number) {
  const q = menuId ? `?menuId=${menuId}` : "";
  return useQuery({
    queryKey: ["categories", RESTAURANT_ID, menuId],
    queryFn: () => apiGet<MenuCategory[]>(`/restaurants/${RESTAURANT_ID}/categories${q}`),
  });
}

export function useMenuItems(params?: { categoryId?: number; search?: string }) {
  const q = new URLSearchParams();
  if (params?.categoryId) q.set("categoryId", String(params.categoryId));
  if (params?.search) q.set("search", params.search);
  return useQuery({
    queryKey: ["items", RESTAURANT_ID, params],
    queryFn: () => apiGet<MenuItem[]>(`/restaurants/${RESTAURANT_ID}/items?${q}`),
  });
}

export function useCreateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMenuItemInput) => apiPost(`/restaurants/${RESTAURANT_ID}/items`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });
}

export function useUpdateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateMenuItemInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/items/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });
}

export function useDeleteMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });
}

export function useInventory(params?: { lowStock?: boolean; search?: string }) {
  const q = new URLSearchParams();
  if (params?.lowStock) q.set("lowStock", "true");
  if (params?.search) q.set("search", params.search);
  return useQuery({
    queryKey: ["inventory", RESTAURANT_ID, params],
    queryFn: () => apiGet<InventoryItem[]>(`/restaurants/${RESTAURANT_ID}/inventory?${q}`),
  });
}

export function useCreateInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateInventoryItemInput) => apiPost(`/restaurants/${RESTAURANT_ID}/inventory`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useAdjustInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: AdjustInventoryInput) => apiPost(`/restaurants/${RESTAURANT_ID}/inventory/${id}/adjust`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useStaff(role?: string) {
  const q = role ? `?role=${role}` : "";
  return useQuery({
    queryKey: ["staff", RESTAURANT_ID, role],
    queryFn: () => apiGet<StaffMember[]>(`/restaurants/${RESTAURANT_ID}/staff${q}`),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserInput) => apiPost(`/users`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useCustomers(params?: { search?: string; page?: number }) {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.page) q.set("page", String(params.page));
  return useQuery({
    queryKey: ["customers", RESTAURANT_ID, params],
    queryFn: () => apiGet<CustomersResponse>(`/restaurants/${RESTAURANT_ID}/customers?${q}`),
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCustomerInput) => apiPost(`/restaurants/${RESTAURANT_ID}/customers`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useReservations(params?: { date?: string; status?: string }) {
  const q = new URLSearchParams();
  if (params?.date) q.set("date", params.date);
  if (params?.status) q.set("status", params.status);
  return useQuery({
    queryKey: ["reservations", RESTAURANT_ID, params],
    queryFn: () => apiGet<import("./types").Reservation[]>(`/restaurants/${RESTAURANT_ID}/reservations?${q}`),
  });
}

export function useCreateReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReservationInput) => apiPost(`/restaurants/${RESTAURANT_ID}/reservations`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reservations"] }),
  });
}

export function useUpdateReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateReservationInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/reservations/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reservations"] }); qc.invalidateQueries({ queryKey: ["tables"] }); },
  });
}

export function useDeleteReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/reservations/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reservations"] }); qc.invalidateQueries({ queryKey: ["tables"] }); },
  });
}

export function useUpdateTicketPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPatch(`/restaurants/${RESTAURANT_ID}/kitchen/tickets/${id}/priority`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen"] }),
  });
}

export function useMergeTables() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceTableId, targetTableId }: { sourceTableId: number; targetTableId: number }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/tables/merge`, { sourceTableId, targetTableId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tables"] }); qc.invalidateQueries({ queryKey: ["orders"] }); },
  });
}

export function useSplitOrderToTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, targetTableId, itemIds }: { orderId: number; targetTableId: number; itemIds: number[] }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/split-to-table`, { targetTableId, itemIds }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tables"] }); qc.invalidateQueries({ queryKey: ["orders"] }); },
  });
}

export { type Reservation };

export function useSuppliers() {
  return useQuery({
    queryKey: ["suppliers", RESTAURANT_ID],
    queryFn: () => apiGet<Supplier[]>(`/restaurants/${RESTAURANT_ID}/suppliers`),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications", RESTAURANT_ID],
    queryFn: () => apiGet<AppNotification[]>(`/restaurants/${RESTAURANT_ID}/notifications`),
    refetchInterval: 15000,
  });
}

export function useReports(period = "7d", custom?: { from: string; to: string }, groupBy = "daily") {
  const q = custom
    ? `from=${custom.from}&to=${custom.to}&groupBy=${groupBy}`
    : `period=${period}&groupBy=${groupBy}`;
  return useQuery({
    queryKey: ["reports", RESTAURANT_ID, period, custom, groupBy],
    queryFn: () => apiGet<ReportsData>(`/restaurants/${RESTAURANT_ID}/dashboard/reports?${q}`),
  });
}

export function useCreateMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMenuInput) => apiPost<Menu>(`/restaurants/${RESTAURANT_ID}/menus`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menus"] }),
  });
}

export function useUpdateMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateMenuInput) => apiPatch<Menu>(`/restaurants/${RESTAURANT_ID}/menus/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menus"] }),
  });
}

export function useDeleteMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/menus/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menus"] }),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCategoryInput) => apiPost<MenuCategory>(`/restaurants/${RESTAURANT_ID}/categories`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateCategoryInput) => apiPatch<MenuCategory>(`/restaurants/${RESTAURANT_ID}/categories/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/categories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); qc.invalidateQueries({ queryKey: ["items"] }); },
  });
}

export function useModifierGroups(menuItemId?: number) {
  return useQuery({
    queryKey: ["modifier-groups-mgmt", menuItemId],
    queryFn: () => apiGet<ModifierGroup[]>(`/items/${menuItemId}/modifier-groups`),
    enabled: !!menuItemId,
  });
}

export function useModifiers(groupId?: number) {
  return useQuery({
    queryKey: ["modifiers", groupId],
    queryFn: () => apiGet<Modifier[]>(`/modifier-groups/${groupId}/modifiers`),
    enabled: !!groupId,
  });
}

export function useCreateModifierGroup(menuItemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateModifierGroupInput) => apiPost<ModifierGroup>(`/items/${menuItemId}/modifier-groups`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["modifier-groups-mgmt", menuItemId] }),
  });
}

export function useCreateModifier(groupId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateModifierInput) => apiPost<Modifier>(`/modifier-groups/${groupId}/modifiers`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["modifiers", groupId] }),
  });
}

export function useShifts() {
  return useQuery({
    queryKey: ["shifts", RESTAURANT_ID],
    queryFn: () => apiGet<Shift[]>(`/restaurants/${RESTAURANT_ID}/shifts`),
  });
}

export function useCreateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateShiftInput) => apiPost<Shift>(`/restaurants/${RESTAURANT_ID}/shifts`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

export function useUpdateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<CreateShiftInput> & { id: number }) => apiPatch<Shift>(`/restaurants/${RESTAURANT_ID}/shifts/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

export function useDeleteShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/shifts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

export function useStaffShifts(userId?: number) {
  const q = userId ? `?userId=${userId}` : "";
  return useQuery({
    queryKey: ["staff-shifts", RESTAURANT_ID, userId],
    queryFn: () => apiGet<StaffShift[]>(`/restaurants/${RESTAURANT_ID}/staff-shifts${q}`),
  });
}

export function useCreateStaffShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateStaffShiftInput) => apiPost<StaffShift>(`/restaurants/${RESTAURANT_ID}/staff-shifts`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-shifts"] }),
  });
}

export function useAttendance(userId?: number) {
  const q = userId ? `?userId=${userId}` : "";
  return useQuery({
    queryKey: ["attendance", RESTAURANT_ID, userId],
    queryFn: () => apiGet<AttendanceRecord[]>(`/restaurants/${RESTAURANT_ID}/attendance${q}`),
  });
}

export function useClockIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ClockInInput) => apiPost<AttendanceRecord>(`/restaurants/${RESTAURANT_ID}/attendance`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function useClockOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: number; notes?: string }) => apiPatch<AttendanceRecord>(`/restaurants/${RESTAURANT_ID}/attendance/${id}/clock-out`, { notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function useAuditLogs(params?: { userId?: number; action?: string; page?: number }) {
  const q = new URLSearchParams();
  if (params?.userId) q.set("userId", String(params.userId));
  if (params?.action) q.set("action", params.action);
  if (params?.page) q.set("page", String(params.page));
  return useQuery({
    queryKey: ["audit-logs", RESTAURANT_ID, params],
    queryFn: () => apiGet<AuditLog[]>(`/restaurants/${RESTAURANT_ID}/audit-logs?${q}`),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; phone?: string; role?: string; isActive?: boolean }) => apiPatch(`/users/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: () => apiGet<Role[]>("/roles"),
  });
}

export function usePermissions() {
  return useQuery({
    queryKey: ["permissions"],
    queryFn: () => apiGet<Permission[]>("/permissions"),
  });
}

export function useRoleWithPermissions(roleId: number | null) {
  return useQuery({
    queryKey: ["roles", roleId, "permissions"],
    queryFn: () => apiGet<Role>(`/roles/${roleId}`),
    enabled: roleId !== null,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string }) => apiPost<Role>("/roles", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useAddRolePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, permissionId }: { roleId: number; permissionId: number }) =>
      apiPost(`/roles/${roleId}/permissions`, { permissionId }),
    onSuccess: (_d, { roleId }) => {
      qc.invalidateQueries({ queryKey: ["roles", roleId, "permissions"] });
    },
  });
}

export function useRemoveRolePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, permissionId }: { roleId: number; permissionId: number }) =>
      apiDelete(`/roles/${roleId}/permissions/${permissionId}`),
    onSuccess: (_d, { roleId }) => {
      qc.invalidateQueries({ queryKey: ["roles", roleId, "permissions"] });
    },
  });
}

export function useUpdateInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateInventoryItemInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/inventory/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useDeleteInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/inventory/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useInventoryTransactions(itemId: number | null) {
  return useQuery({
    queryKey: ["inventory", "transactions", RESTAURANT_ID, itemId],
    queryFn: () => apiGet<InventoryTransaction[]>(`/restaurants/${RESTAURANT_ID}/inventory/${itemId}/transactions`),
    enabled: itemId !== null,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSupplierInput) => apiPost(`/restaurants/${RESTAURANT_ID}/suppliers`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateSupplierInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/suppliers/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/suppliers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ["purchase-orders", RESTAURANT_ID],
    queryFn: () => apiGet<PurchaseOrder[]>(`/restaurants/${RESTAURANT_ID}/purchase-orders`),
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePurchaseOrderInput) => apiPost(`/restaurants/${RESTAURANT_ID}/purchase-orders`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
}

export function useUpdatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; status?: string; notes?: string; totalAmount?: string }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/purchase-orders/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
}

export function useDeletePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/purchase-orders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
}

export function useCustomer(id: number | null) {
  return useQuery({
    queryKey: ["customers", RESTAURANT_ID, id],
    queryFn: () => apiGet<Customer>(`/restaurants/${RESTAURANT_ID}/customers/${id}`),
    enabled: id !== null,
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateCustomerInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/customers/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useCustomerLoyalty(customerId: number | null) {
  return useQuery({
    queryKey: ["customers", "loyalty", RESTAURANT_ID, customerId],
    queryFn: () => apiGet<LoyaltyAccount>(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/loyalty`),
    enabled: customerId !== null,
  });
}

export function useAddLoyaltyPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, ...data }: { customerId: number; points: number; type: string; reason?: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/loyalty`, data),
    onSuccess: (_d, { customerId }) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customers", "loyalty", RESTAURANT_ID, customerId] });
    },
  });
}

export function useCoupons() {
  return useQuery({
    queryKey: ["coupons", RESTAURANT_ID],
    queryFn: () => apiGet<Coupon[]>(`/restaurants/${RESTAURANT_ID}/coupons`),
  });
}

export function useCreateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCouponInput) => apiPost(`/restaurants/${RESTAURANT_ID}/coupons`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

export function useUpdateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateCouponInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/coupons/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/coupons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

export function useCustomerOrders(customerId: number | null) {
  return useQuery({
    queryKey: ["orders", "customer", RESTAURANT_ID, customerId],
    queryFn: () => apiGet<{ data: import("./types").Order[]; total: number }>(`/restaurants/${RESTAURANT_ID}/orders?customerId=${customerId}&limit=20`),
    enabled: customerId !== null,
  });
}

export function useWasteLog() {
  return useQuery({
    queryKey: ["inventory", "waste-log", RESTAURANT_ID],
    queryFn: () => apiGet<(import("./types").InventoryTransaction & { itemName: string; unit: string })[]>(`/restaurants/${RESTAURANT_ID}/inventory/waste-log`),
  });
}

export function useRecipeMappings(params?: { menuItemId?: number; inventoryItemId?: number }) {
  const q = new URLSearchParams();
  if (params?.menuItemId) q.set("menuItemId", String(params.menuItemId));
  if (params?.inventoryItemId) q.set("inventoryItemId", String(params.inventoryItemId));
  return useQuery({
    queryKey: ["recipe-mappings", RESTAURANT_ID, params],
    queryFn: () => apiGet<import("./types").RecipeMapping[]>(`/restaurants/${RESTAURANT_ID}/recipe-mappings?${q}`),
  });
}

export function useCreateRecipeMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: import("./types").CreateRecipeMappingInput) => apiPost(`/restaurants/${RESTAURANT_ID}/recipe-mappings`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipe-mappings"] }),
  });
}

export function useDeleteRecipeMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/recipe-mappings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipe-mappings"] }),
  });
}

export function useCustomerAddresses(customerId: number | null) {
  return useQuery({
    queryKey: ["customer-addresses", customerId],
    queryFn: () => apiGet<import("./types").CustomerAddress[]>(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/addresses`),
    enabled: customerId !== null,
  });
}

export function useCreateCustomerAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, address, label, isDefault }: { customerId: number; address: string; label?: string; isDefault?: boolean }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/addresses`, { address, label, isDefault }),
    onSuccess: (_: unknown, vars: { customerId: number; address: string; label?: string; isDefault?: boolean }) =>
      qc.invalidateQueries({ queryKey: ["customer-addresses", vars.customerId] }),
  });
}

export function useDeleteCustomerAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, addressId }: { customerId: number; addressId: number }) =>
      apiDelete(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/addresses/${addressId}`),
    onSuccess: (_: unknown, vars: { customerId: number; addressId: number }) =>
      qc.invalidateQueries({ queryKey: ["customer-addresses", vars.customerId] }),
  });
}

export function useApplyCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, code }: { orderId: number; code: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/apply-coupon`, { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
}

export function useApplyLoyalty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, points }: { orderId: number; points: number }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/apply-loyalty`, { points }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

export function useCustomerByPhone(phone: string | null) {
  return useQuery({
    queryKey: ["customers", "phone", RESTAURANT_ID, phone],
    queryFn: () => apiGet<{ data: import("./types").Customer[]; total: number }>(`/restaurants/${RESTAURANT_ID}/customers?search=${encodeURIComponent(phone!)}`),
    enabled: !!phone && phone.length >= 6,
    select: (res) => (res.data ?? [])[0] ?? null,
  });
}

export { type InventoryItem, type Customer, type Coupon, type LoyaltyTransaction };
export { type Supplier, type PurchaseOrder, type InventoryTransaction };
