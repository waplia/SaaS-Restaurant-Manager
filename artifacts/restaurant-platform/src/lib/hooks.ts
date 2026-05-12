import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "./api";
import type {
  DashboardSummary, RevenueTrendItem, PopularItem, LiveKitchenData, AuditLogEntry,
  OrdersResponse, CreateOrderInput, UpdateOrderInput, PayOrderInput,
  FloorTable, CreateTableInput, UpdateTableInput,
  Menu, MenuCategory, MenuItem, CreateMenuItemInput, UpdateMenuItemInput,
  InventoryItem, CreateInventoryItemInput, AdjustInventoryInput,
  StaffMember, CreateUserInput,
  CustomersResponse, CreateCustomerInput,
  CreateReservationInput, UpdateReservationInput, Reservation,
  AppNotification,
  ReportsData,
  Supplier,
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
