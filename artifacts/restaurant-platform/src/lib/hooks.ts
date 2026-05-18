import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, getApiUrl, wrapQueueable } from "./api";
import type { StaffIncentiveRule, StaffIncentive, StaffIncentiveLeaderboardRow, Order } from "./types";
import { useBranchContext } from "./branch";
import { useAuth } from "./auth";
import { toast as notify } from "@/hooks/use-toast";
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
  Shift, StaffShift, AttendanceRecord, AuditLog, AuditLogList, AuditLogDetail, AuditLogFilters,
  CreateShiftInput, CreateStaffShiftInput, ClockInInput, MarkAttendanceInput, PatchAttendanceInput,
  Customer, CustomersResponse, CreateCustomerInput, UpdateCustomerInput,
  LoyaltyAccount, LoyaltyTransaction,
  Coupon, CreateCouponInput, UpdateCouponInput,
  CreateReservationInput, UpdateReservationInput, Reservation,
  EventBooking, EventBookingDetail, EventQuotationData, CreateEventBookingInput,
  EventBookingType, EventBookingStatus,
  AppNotification,
  WaiterRequest,
  ReportsData,
  Supplier, CreateSupplierInput, UpdateSupplierInput,
  Role, Permission,
  LeavePolicy, LeaveBalance, LeaveRequest, CreateLeavePolicyInput, CreateLeaveRequestInput,
  Payment, PaymentsResponse, PaymentSummary, CreatePaymentInput, SettlePaymentInput,
  DuePaymentsData,
} from "./types";

// Legacy fallback only. Real code paths derive the effective restaurant id
// from auth + branch context via `useRestaurantId()` below.
const RESTAURANT_ID_FALLBACK = 1;

/**
 * Effective restaurant id for `/restaurants/:restaurantId/...` calls.
 *
 * Order of precedence:
 *  1. The authenticated user's pinned restaurantId on their JWT (waiter,
 *     kitchen, branch-scoped manager etc.) — backend will 403 anything
 *     else, so this is the only correct value for these roles.
 *  2. The branch the user has selected via the branch switcher.
 *  3. The first branch the user can see (consolidating owners that have
 *     not made a selection yet).
 *  4. The legacy hardcoded id `1` as an absolute last resort so SSR /
 *     pre-auth boot paths don't crash.
 */
export function useRestaurantId(): number {
  const { user } = useAuth();
  const { selectedBranchId, branches } = useBranchContext();
  if (user?.restaurantId != null) return user.restaurantId;
  if (selectedBranchId != null) return selectedBranchId;
  if (branches.length > 0) return branches[0].id;
  return RESTAURANT_ID_FALLBACK;
}

/** @deprecated Prefer `useRestaurantId()`. Kept for one-off non-hook callers. */
export const RESTAURANT_ID = RESTAURANT_ID_FALLBACK;

export function useDashboardSummary() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["dashboard", "summary", RESTAURANT_ID],
    queryFn: () => apiGet<DashboardSummary>(`/restaurants/${RESTAURANT_ID}/dashboard/summary`),
    refetchInterval: 30000,
  });
}

export function useRevenueTrend(period = "7d", groupBy = "daily") {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["dashboard", "revenue-trend", RESTAURANT_ID, period, groupBy],
    queryFn: () => apiGet<RevenueTrendItem[]>(`/restaurants/${RESTAURANT_ID}/dashboard/revenue-trend?period=${period}&groupBy=${groupBy}`),
  });
}

export function usePopularItems(limit = 8) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["dashboard", "popular-items", RESTAURANT_ID, limit],
    queryFn: () => apiGet<PopularItem[]>(`/restaurants/${RESTAURANT_ID}/dashboard/popular-items?limit=${limit}`),
  });
}

export function useLiveKitchen() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["dashboard", "live-kitchen", RESTAURANT_ID],
    queryFn: () => apiGet<LiveKitchenData>(`/restaurants/${RESTAURANT_ID}/dashboard/live-kitchen`),
    refetchInterval: 10000,
  });
}

export function useStaffActivity() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["dashboard", "staff-activity", RESTAURANT_ID],
    queryFn: () => apiGet<AuditLogEntry[]>(`/restaurants/${RESTAURANT_ID}/dashboard/staff-activity`),
  });
}

export function useOrders(params?: { status?: string; tableId?: number; page?: number }) {
  const RESTAURANT_ID = useRestaurantId();
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
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateOrderInput) => wrapQueueable(() => apiPost(`/restaurants/${RESTAURANT_ID}/orders`, data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] }),
  });
}

export function useUpdateOrder() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateOrderInput) => wrapQueueable(() => apiPatch(`/restaurants/${RESTAURANT_ID}/orders/${id}`, data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] }),
  });
}

export function useCurbsideQueue() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["curbside-queue", RESTAURANT_ID],
    queryFn: () => apiGet<Order[]>(`/restaurants/${RESTAURANT_ID}/orders/curbside/queue`),
    refetchInterval: 5000,
  });
}

export function useCurbsideHandover() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${RESTAURANT_ID}/orders/${id}/curbside/handover`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["curbside-queue", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
    },
  });
}

export function useCurbsideReport(from?: string, to?: string) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return useQuery({
    queryKey: ["curbside-report", RESTAURANT_ID, from, to],
    queryFn: () => apiGet<{ from: string; to: string; totalOrders: number; handedOver: number; noShows: number; avgPickupSeconds: number; revenue: string }>(`/restaurants/${RESTAURANT_ID}/reports/curbside?${q}`),
  });
}

export function usePayOrder() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: PayOrderInput) => wrapQueueable(() => apiPost(`/restaurants/${RESTAURANT_ID}/orders/${id}/pay`, data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] }),
  });
}

export function useSetting<T = Record<string, unknown>>(section: string) {
  return useQuery({
    queryKey: ["settings", section, RESTAURANT_ID],
    queryFn: () => apiGet<{ section: string; data: T; updatedAt: string | null }>(`/restaurants/${RESTAURANT_ID}/settings/${section}`),
    staleTime: 30000,
  });
}

export function useSaveSetting<T = Record<string, unknown>>(section: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: T) =>
      apiPut<{ section: string; data: T; updatedAt: string }>(
        `/restaurants/${RESTAURANT_ID}/settings/${section}`,
        { data },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", section, RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["settings", section] });
    },
  });
}

export function useRestaurantInfo() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["restaurant", RESTAURANT_ID],
    queryFn: () => apiGet<import("./types").RestaurantInfo & { autoReorderEnabled?: boolean; autoReorderCron?: string | null; enableVoiceOrdering?: boolean }>(`/restaurants/${RESTAURANT_ID}`),
    staleTime: 60000,
  });
}

export function useUpdateRestaurant() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPatch(`/restaurants/${RESTAURANT_ID}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["restaurant", RESTAURANT_ID] }),
  });
}

export function useRunAutoReorder() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<import("./types").AutoReorderRunResult>(`/restaurants/${RESTAURANT_ID}/auto-reorder/run`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
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
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: ({ orderId, amount, tipAmount }: { orderId: number; amount?: number; tipAmount?: number }) =>
      apiPost<import("./types").PaymentIntentResult>(
        `/restaurants/${RESTAURANT_ID}/orders/${orderId}/payment-intent`,
        {
          ...(amount !== undefined ? { customAmount: amount } : {}),
          ...(tipAmount && tipAmount > 0 ? { tipAmount } : {}),
        }
      ),
  });
}

export function useCreateRazorpayOrder() {
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: ({ orderId, amount, tipAmount }: { orderId: number; amount?: number; tipAmount?: number }) =>
      apiPost<import("./types").RazorpayOrderResult>(
        `/restaurants/${RESTAURANT_ID}/orders/${orderId}/razorpay-order`,
        {
          ...(amount !== undefined ? { customAmount: amount } : {}),
          ...(tipAmount && tipAmount > 0 ? { tipAmount } : {}),
        }
      ),
  });
}

export function useSplitOrder() {
  const RESTAURANT_ID = useRestaurantId();
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
      wrapQueueable(() => apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/split`, { splits })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["tables", RESTAURANT_ID] });
    },
  });
}

export function useOrderDetail(id?: number) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["orders", "detail", RESTAURANT_ID, id],
    queryFn: () => apiGet<import("./types").OrderDetail>(`/restaurants/${RESTAURANT_ID}/orders/${id}`),
    enabled: !!id,
  });
}

export function useAddOrderItem() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, ...data }: import("./types").AddOrderItemInput) =>
      wrapQueueable(() => apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/items`, data)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["orders", "detail", RESTAURANT_ID, vars.orderId] });
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
    },
  });
}

export function useRemoveOrderItem() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, itemId }: { orderId: number; itemId: number }) =>
      wrapQueueable(() => apiDelete(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/items/${itemId}`)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["orders", "detail", RESTAURANT_ID, vars.orderId] });
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
    },
  });
}

export function useApplyDiscountLine() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, ...body }: import("./types").ApplyDiscountLineInput) =>
      wrapQueueable(() => apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/discounts`, body)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["orders", "detail", RESTAURANT_ID, vars.orderId] });
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
    },
  });
}

export function useRemoveDiscountLine() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, discountId }: { orderId: number; discountId: number }) =>
      wrapQueueable(() => apiDelete(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/discounts/${discountId}`)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["orders", "detail", RESTAURANT_ID, vars.orderId] });
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
    },
  });
}

export function useRequestManagerDiscountOtp() {
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: () => apiPost<{ ok: boolean; otpId: number; recipientMasked: string | null; expiresInSec: number }>(
      `/restaurants/${RESTAURANT_ID}/manager-otp/discount-request`, {},
    ),
  });
}

export function useDiscountInsights(period: string, groupBy: string, custom?: { from?: string; to?: string }) {
  const RESTAURANT_ID = useRestaurantId();
  const qs = new URLSearchParams({ period, groupBy });
  if (custom?.from) qs.set("from", custom.from);
  if (custom?.to) qs.set("to", custom.to);
  return useQuery({
    queryKey: ["discount-insights", RESTAURANT_ID, period, groupBy, custom?.from ?? "", custom?.to ?? ""],
    queryFn: () => apiGet<import("./types").DiscountInsightsResponse>(
      `/restaurants/${RESTAURANT_ID}/reports/discount-insights?${qs.toString()}`,
    ),
    staleTime: 30_000,
  });
}

export function useDiscountsConfig() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["settings", "discounts", RESTAURANT_ID],
    queryFn: async () => {
      const res = await apiGet<{ section: string; data: import("./types").DiscountsConfig }>(`/restaurants/${RESTAURANT_ID}/settings/discounts`);
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useVoidOrder() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: number; reason: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/void`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["tables", RESTAURANT_ID] });
    },
  });
}

export function useKitchenTickets(statusOrParams?: string | { status?: string; kitchenId?: number | null }) {
  const RESTAURANT_ID = useRestaurantId();
  const params = typeof statusOrParams === "string" ? { status: statusOrParams } : (statusOrParams ?? {});
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.kitchenId != null) qs.set("kitchenId", String(params.kitchenId));
  const q = qs.toString() ? `?${qs.toString()}` : "";
  return useQuery({
    queryKey: ["kitchen", "tickets", RESTAURANT_ID, params.status ?? null, params.kitchenId ?? null],
    queryFn: () => apiGet<import("./types").KitchenTicket[]>(`/restaurants/${RESTAURANT_ID}/kitchen/tickets${q}`),
    refetchInterval: 8000,
  });
}

export function useKitchens() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["kitchens", RESTAURANT_ID],
    queryFn: () => apiGet<import("./types").Kitchen[]>(`/restaurants/${RESTAURANT_ID}/kitchens`),
    staleTime: 30000,
  });
}

export function useCreateKitchen() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: import("./types").CreateKitchenInput) =>
      apiPost<import("./types").Kitchen>(`/restaurants/${RESTAURANT_ID}/kitchens`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchens", RESTAURANT_ID] }),
  });
}

export function useUpdateKitchen() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: import("./types").UpdateKitchenInput) =>
      apiPatch<import("./types").Kitchen>(`/restaurants/${RESTAURANT_ID}/kitchens/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchens", RESTAURANT_ID] }),
  });
}

export function useDeleteKitchen() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/kitchens/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kitchens", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["menu", "items"] });
    },
  });
}

export function useReorderKitchens() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (order: number[]) => apiPost(`/restaurants/${RESTAURANT_ID}/kitchens/reorder`, { order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchens", RESTAURANT_ID] }),
  });
}

export function useBulkAssignKitchen() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemIds, kitchenId }: { itemIds: number[]; kitchenId: number | null }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/items/bulk-kitchen`, { itemIds, kitchenId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menu", "items"] }),
  });
}

export function useUpdateTicketStatus() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: string; reason?: string }) =>
      wrapQueueable(() => apiPatch(`/restaurants/${RESTAURANT_ID}/kitchen/tickets/${id}/status`, reason ? { status, reason } : { status })),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["kitchen"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      const label = vars.status === "ready" ? "Marked ready" : vars.status === "served" ? "Marked served" : `Status: ${vars.status}`;
      notify({ title: label });
    },
    onError: (e: Error) => notify({ title: "Could not update ticket", description: e.message, variant: "destructive" }),
  });
}

export function useFloorTables() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["tables", RESTAURANT_ID],
    queryFn: () => apiGet<FloorTable[]>(`/restaurants/${RESTAURANT_ID}/tables`),
    refetchInterval: 20000,
  });
}

export function useCreateTable() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTableInput) => apiPost(`/restaurants/${RESTAURANT_ID}/tables`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useUpdateTable() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateTableInput) => wrapQueueable(() => apiPatch(`/restaurants/${RESTAURANT_ID}/tables/${id}`, data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useGetTableQr(tableId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["table-qr", RESTAURANT_ID, tableId],
    queryFn: () => apiGet<{ qrUrl: string; tableNumber: string }>(`/restaurants/${RESTAURANT_ID}/tables/${tableId}/qr`),
    enabled: tableId !== null,
    staleTime: 60000,
  });
}

export function useMenus() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["menus", RESTAURANT_ID],
    queryFn: () => apiGet<Menu[]>(`/restaurants/${RESTAURANT_ID}/menus`),
  });
}

export function useMenuCategories(menuId?: number) {
  const RESTAURANT_ID = useRestaurantId();
  const q = menuId ? `?menuId=${menuId}` : "";
  return useQuery({
    queryKey: ["categories", RESTAURANT_ID, menuId],
    queryFn: () => apiGet<MenuCategory[]>(`/restaurants/${RESTAURANT_ID}/categories${q}`),
  });
}

export function useMenuItems(params?: { categoryId?: number; search?: string }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.categoryId) q.set("categoryId", String(params.categoryId));
  if (params?.search) q.set("search", params.search);
  return useQuery({
    queryKey: ["items", RESTAURANT_ID, params],
    queryFn: () => apiGet<MenuItem[]>(`/restaurants/${RESTAURANT_ID}/items?${q}`),
  });
}

export function useCreateMenuItem() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMenuItemInput) => apiPost(`/restaurants/${RESTAURANT_ID}/items`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });
}

export function useUpdateMenuItem() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateMenuItemInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/items/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });
}

export function useDeleteMenuItem() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });
}

function useInventoryRestaurantId() {
  // Same precedence as `useRestaurantId()`: a user pinned to a branch on
  // their JWT must never bypass scope, even if `selectedBranchId` is
  // somehow set; consolidating users may pick any accessible branch via
  // the switcher. Fall back to `useRestaurantId()` (auth + branch ctx)
  // rather than the legacy `RESTAURANT_ID = 1` constant.
  const { user } = useAuth();
  const { selectedBranchId } = useBranchContext();
  const effective = useRestaurantId();
  if (user?.restaurantId != null) return user.restaurantId;
  return selectedBranchId ?? effective;
}

export function useInventory(params?: { lowStock?: boolean; search?: string }) {
  const rid = useInventoryRestaurantId();
  const q = new URLSearchParams();
  if (params?.lowStock) q.set("lowStock", "true");
  if (params?.search) q.set("search", params.search);
  return useQuery({
    queryKey: ["inventory", rid, params],
    queryFn: () => apiGet<InventoryItem[]>(`/restaurants/${rid}/inventory?${q}`),
  });
}

export function useCreateInventoryItem() {
  const qc = useQueryClient();
  const rid = useInventoryRestaurantId();
  return useMutation({
    mutationFn: (data: CreateInventoryItemInput) => apiPost(`/restaurants/${rid}/inventory`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useAdjustInventory() {
  const qc = useQueryClient();
  const rid = useInventoryRestaurantId();
  return useMutation({
    mutationFn: ({ id, ...data }: AdjustInventoryInput) => apiPost(`/restaurants/${rid}/inventory/${id}/adjust`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useStaff(role?: string) {
  const RESTAURANT_ID = useRestaurantId();
  const q = role ? `?role=${role}` : "";
  return useQuery({
    queryKey: ["staff", RESTAURANT_ID, role],
    queryFn: () => apiGet<StaffMember[]>(`/restaurants/${RESTAURANT_ID}/staff${q}`),
  });
}

export function useUpdateStaffProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...patch }: { userId: number } & import("./types").StaffProfilePatch) =>
      apiPatch<StaffMember>(`/restaurants/${RESTAURANT_ID}/staff/${userId}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useStaffDocuments(userId: number | null) {
  return useQuery({
    queryKey: ["staff", "documents", RESTAURANT_ID, userId],
    queryFn: () => apiGet<import("./types").StaffDocument[]>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/documents`),
    enabled: userId !== null,
  });
}

export function useAddStaffDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: number; label: string; fileUrl: string; mimeType?: string; sizeBytes?: number }) =>
      apiPost<import("./types").StaffDocument>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/documents`, body),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["staff", "documents", RESTAURANT_ID, vars.userId] }),
  });
}

export function useDeleteStaffDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, docId }: { userId: number; docId: number }) =>
      apiDelete(`/restaurants/${RESTAURANT_ID}/staff/${userId}/documents/${docId}`),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["staff", "documents", RESTAURANT_ID, vars.userId] }),
  });
}

export function useStaffBankAccount(userId: number | null, reveal = false) {
  return useQuery({
    queryKey: ["staff", "bank", RESTAURANT_ID, userId, reveal],
    queryFn: () => apiGet<import("./types").StaffBankAccount | null>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/bank${reveal ? "?reveal=1" : ""}`),
    enabled: userId !== null,
  });
}

export function useSaveStaffBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: number; accountName?: string | null; accountNumber?: string | null; ifsc?: string | null; bankName?: string | null; upiId?: string | null }) =>
      apiPut<import("./types").StaffBankAccount>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/bank`, body),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["staff", "bank", RESTAURANT_ID, vars.userId] }),
  });
}

export function useSalaryStructure(userId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["staff", "salary-structure", RESTAURANT_ID, userId],
    queryFn: () => apiGet<import("./types").SalaryStructure | null>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/salary-structure`),
    enabled: userId !== null,
  });
}

export function useSaveSalaryStructure() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: number } & import("./types").SaveSalaryStructureInput) =>
      apiPut<import("./types").SalaryStructure>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/salary-structure`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["staff", "salary-structure", RESTAURANT_ID, vars.userId] });
      qc.invalidateQueries({ queryKey: ["staff", RESTAURANT_ID] });
    },
  });
}

export function useStaffAdvances(userId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["staff", "advances", RESTAURANT_ID, userId],
    queryFn: () => apiGet<import("./types").StaffAdvancesResponse>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/advances`),
    enabled: userId !== null,
  });
}

export function useCreateStaffAdvance() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: number; amount: string | number; paidOn?: string; notes?: string | null }) =>
      apiPost<import("./types").StaffAdvance>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/advances`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["staff", "advances", RESTAURANT_ID, vars.userId] });
      qc.invalidateQueries({ queryKey: ["staff", RESTAURANT_ID] });
    },
  });
}

export function useUpdateStaffAdvance() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, advanceId, ...body }: { userId: number; advanceId: number; notes?: string | null; settledAmount?: string | number }) =>
      apiPatch<import("./types").StaffAdvance>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/advances/${advanceId}`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["staff", "advances", RESTAURANT_ID, vars.userId] });
      qc.invalidateQueries({ queryKey: ["staff", RESTAURANT_ID] });
    },
  });
}

export function useDeleteStaffAdvance() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, advanceId }: { userId: number; advanceId: number }) =>
      apiDelete(`/restaurants/${RESTAURANT_ID}/staff/${userId}/advances/${advanceId}`),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["staff", "advances", RESTAURANT_ID, vars.userId] });
      qc.invalidateQueries({ queryKey: ["staff", RESTAURANT_ID] });
    },
  });
}

export function useStaffAdjustments(userId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["staff", "adjustments", RESTAURANT_ID, userId],
    queryFn: () => apiGet<import("./types").StaffAdjustment[]>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/adjustments`),
    enabled: userId !== null,
  });
}

export function useCreateStaffAdjustment() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: number; kind: "bonus" | "deduction"; amount: string | number; label: string; appliesToMonth?: string | null; isRecurring?: boolean }) =>
      apiPost<import("./types").StaffAdjustment>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/adjustments`, body),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["staff", "adjustments", RESTAURANT_ID, vars.userId] }),
  });
}

export function useDeleteStaffAdjustment() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, adjId }: { userId: number; adjId: number }) =>
      apiDelete(`/restaurants/${RESTAURANT_ID}/staff/${userId}/adjustments/${adjId}`),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["staff", "adjustments", RESTAURANT_ID, vars.userId] }),
  });
}

export function usePerformanceNotes(userId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["staff", "performance-notes", RESTAURANT_ID, userId],
    queryFn: () => apiGet<import("./types").PerformanceNote[]>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/performance-notes`),
    enabled: userId !== null,
  });
}

export function useCreatePerformanceNote() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: number; body: string; rating?: number | null }) =>
      apiPost<import("./types").PerformanceNote>(`/restaurants/${RESTAURANT_ID}/staff/${userId}/performance-notes`, body),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["staff", "performance-notes", RESTAURANT_ID, vars.userId] }),
  });
}

export function useDeletePerformanceNote() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, noteId }: { userId: number; noteId: number }) =>
      apiDelete(`/restaurants/${RESTAURANT_ID}/staff/${userId}/performance-notes/${noteId}`),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["staff", "performance-notes", RESTAURANT_ID, vars.userId] }),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserInput) => apiPost(`/users`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useCustomers(params?: import("./types").CustomerListFilters) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.page) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.tag) q.set("tag", params.tag);
  if (params?.vip) q.set("vip", "true");
  if (params?.preferredChannel) q.set("preferredChannel", params.preferredChannel);
  if (params?.whatsappOptIn !== undefined) q.set("whatsappOptIn", String(params.whatsappOptIn));
  if (params?.hasComplaints) q.set("hasComplaints", "true");
  if (params?.lastVisitFrom) q.set("lastVisitFrom", params.lastVisitFrom);
  if (params?.lastVisitTo) q.set("lastVisitTo", params.lastVisitTo);
  if (params?.birthdayMonth) q.set("birthdayMonth", String(params.birthdayMonth));
  if (params?.anniversaryMonth) q.set("anniversaryMonth", String(params.anniversaryMonth));
  if (params?.tier) q.set("tier", params.tier);
  if (params?.tierMin) q.set("tierMin", String(params.tierMin));
  return useQuery({
    queryKey: ["customers", RESTAURANT_ID, params],
    queryFn: () => apiGet<CustomersResponse>(`/restaurants/${RESTAURANT_ID}/customers?${q}`),
  });
}

export function useCustomerProfile(id: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["customers", "profile", RESTAURANT_ID, id],
    queryFn: () => apiGet<import("./types").CustomerProfile>(`/restaurants/${RESTAURANT_ID}/customers/${id}`),
    enabled: id !== null,
  });
}

export function useCustomerTags(search?: string) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (search) q.set("search", search);
  return useQuery({
    queryKey: ["customer-tags", RESTAURANT_ID, search ?? null],
    queryFn: () => apiGet<import("./types").CustomerTagRef[]>(`/restaurants/${RESTAURANT_ID}/customer-tags?${q}`),
  });
}

export function useAddCustomerTag() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, name }: { customerId: number; name: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/tags`, { name }),
    onSuccess: (_d, { customerId }) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer-tags"] });
      qc.invalidateQueries({ queryKey: ["customers", "profile", RESTAURANT_ID, customerId] });
    },
  });
}

export function useRemoveCustomerTag() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, tagId }: { customerId: number; tagId: number }) =>
      apiDelete(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/tags/${tagId}`),
    onSuccess: (_d, { customerId }) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customers", "profile", RESTAURANT_ID, customerId] });
    },
  });
}

export function useCustomerNotes(customerId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["customer-notes", RESTAURANT_ID, customerId],
    queryFn: () => apiGet<import("./types").CustomerNote[]>(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/notes`),
    enabled: customerId !== null,
  });
}

export function useCreateCustomerNote() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, body }: { customerId: number; body: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/notes`, { body }),
    onSuccess: (_d, { customerId }) => qc.invalidateQueries({ queryKey: ["customer-notes", RESTAURANT_ID, customerId] }),
  });
}

export function useUpdateCustomerNote() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, noteId, body }: { customerId: number; noteId: number; body: string }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/notes/${noteId}`, { body }),
    onSuccess: (_d, { customerId }) => qc.invalidateQueries({ queryKey: ["customer-notes", RESTAURANT_ID, customerId] }),
  });
}

export function useDeleteCustomerNote() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, noteId }: { customerId: number; noteId: number }) =>
      apiDelete(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/notes/${noteId}`),
    onSuccess: (_d, { customerId }) => qc.invalidateQueries({ queryKey: ["customer-notes", RESTAURANT_ID, customerId] }),
  });
}

export function useCustomerComplaints(customerId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["customer-complaints", RESTAURANT_ID, customerId],
    queryFn: () => apiGet<import("./types").CustomerComplaint[]>(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/complaints`),
    enabled: customerId !== null,
  });
}

export function useCreateCustomerComplaint() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, ...data }: { customerId: number; channel: string; summary: string; details?: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/complaints`, data),
    onSuccess: (_d, { customerId }) => {
      qc.invalidateQueries({ queryKey: ["customer-complaints", RESTAURANT_ID, customerId] });
      qc.invalidateQueries({ queryKey: ["customers", "profile", RESTAURANT_ID, customerId] });
    },
  });
}

export function useUpdateCustomerComplaint() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, complaintId, ...data }: { customerId: number; complaintId: number; status?: string; resolutionNotes?: string; summary?: string; details?: string; channel?: string }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/complaints/${complaintId}`, data),
    onSuccess: (_d, { customerId }) => {
      qc.invalidateQueries({ queryKey: ["customer-complaints", RESTAURANT_ID, customerId] });
      qc.invalidateQueries({ queryKey: ["customers", "profile", RESTAURANT_ID, customerId] });
    },
  });
}

export function useCreateCustomer() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCustomerInput) => apiPost(`/restaurants/${RESTAURANT_ID}/customers`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useReservations(params?: { date?: string; status?: string }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.date) q.set("date", params.date);
  if (params?.status) q.set("status", params.status);
  return useQuery({
    queryKey: ["reservations", RESTAURANT_ID, params],
    queryFn: () => apiGet<import("./types").Reservation[]>(`/restaurants/${RESTAURANT_ID}/reservations?${q.toString()}`),
    refetchInterval: 30000,
  });
}

export function useCreateReservation() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReservationInput) => apiPost(`/restaurants/${RESTAURANT_ID}/reservations`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reservations"] }),
  });
}

export function useUpdateReservation() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateReservationInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/reservations/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reservations"] }); qc.invalidateQueries({ queryKey: ["tables"] }); },
  });
}

export function useDeleteReservation() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/reservations/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reservations"] }); qc.invalidateQueries({ queryKey: ["tables"] }); },
  });
}

// Task #431 — table-pacing rule management.
export function useReservationPacingRules() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["reservations", "pacing-rules", RESTAURANT_ID],
    queryFn: () => apiGet<import("./types").ReservationPacingRules>(`/restaurants/${RESTAURANT_ID}/reservations/pacing-rules`),
    enabled: !!RESTAURANT_ID,
  });
}

export function useUpdateReservationPacingRules() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<import("./types").ReservationPacingRules>) =>
      apiPut(`/restaurants/${RESTAURANT_ID}/reservations/pacing-rules`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reservations", "pacing-rules", RESTAURANT_ID] }),
  });
}

export function useUpdateTicketPriority() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPatch(`/restaurants/${RESTAURANT_ID}/kitchen/tickets/${id}/priority`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen"] }),
  });
}

export function useMergeTables() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceTableId, targetTableId }: { sourceTableId: number; targetTableId: number }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/tables/merge`, { sourceTableId, targetTableId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tables"] }); qc.invalidateQueries({ queryKey: ["orders"] }); },
  });
}

export function useSplitOrderToTable() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, targetTableId, itemIds }: { orderId: number; targetTableId: number; itemIds: number[] }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/split-to-table`, { targetTableId, itemIds }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tables"] }); qc.invalidateQueries({ queryKey: ["orders"] }); },
  });
}

export { type Reservation };

export function useWaitlist(status?: string) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  return useQuery({
    queryKey: ["waitlist", RESTAURANT_ID, status],
    queryFn: () => apiGet<import("./types").WaitlistEntry[]>(`/restaurants/${RESTAURANT_ID}/waitlist?${q.toString()}`),
    refetchInterval: 20000,
  });
}

export function useCreateWaitlistEntry() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: import("./types").CreateWaitlistInput) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/waitlist`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waitlist"] }),
  });
}

export function useUpdateWaitlistEntry() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: import("./types").UpdateWaitlistInput) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/waitlist/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waitlist"] }),
  });
}

export function useSeatWaitlistEntry() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tableId }: { id: number; tableId?: number | null }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/waitlist/${id}/seat`, { tableId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["waitlist"] });
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
  });
}

export function useDeleteWaitlistEntry() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/waitlist/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waitlist"] }),
  });
}

export function useMarkTableClean() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableId: number) => apiPost(`/restaurants/${RESTAURANT_ID}/tables/${tableId}/mark-clean`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useMarkTableDirty() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableId: number) => apiPost(`/restaurants/${RESTAURANT_ID}/tables/${tableId}/mark-dirty`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useCreateWalkIn() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { guestName: string; guestPhone?: string; partySize: number; tableId?: number; notes?: string; isVip?: boolean }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/reservations/walkin`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
  });
}

export function useSuppliers() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["suppliers", RESTAURANT_ID],
    queryFn: () => apiGet<Supplier[]>(`/restaurants/${RESTAURANT_ID}/suppliers`),
  });
}

export function useWaiterRequests(opts?: { enabled?: boolean }) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["waiter-requests", RESTAURANT_ID],
    queryFn: () => apiGet<WaiterRequest[]>(`/restaurants/${RESTAURANT_ID}/waiter-requests`),
    refetchInterval: 15000,
    enabled: opts?.enabled ?? true,
  });
}

export function useAcknowledgeWaiterRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${RESTAURANT_ID}/waiter-requests/${id}/acknowledge`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waiter-requests", RESTAURANT_ID] }),
  });
}

export function useResolveWaiterRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${RESTAURANT_ID}/waiter-requests/${id}/resolve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waiter-requests", RESTAURANT_ID] }),
  });
}

export function useNotifications() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["notifications", RESTAURANT_ID],
    queryFn: () => apiGet<AppNotification[]>(`/restaurants/${RESTAURANT_ID}/notifications`),
    refetchInterval: 15000,
  });
}

export interface KitchenPerformanceData {
  window: { from: string; to: string };
  kitchenId: number | null;
  summary: {
    ticketsTotal: number;
    ticketsDelayed: number;
    delayedPct: number;
    avgPrepMinutes: number | null;
    alertsTotal: number;
  };
  stations: Array<{
    station: { id: number | null; name: string };
    ticketsTotal: number;
    ticketsDelayed: number;
    avgPrepMinutes: number | null;
    delayedPct: number;
  }>;
  topDelayedItems: Array<{ menuItemId: number | null; name: string; ticketsDelayed: number; avgDelayMinutes: number }>;
  peakHours: Array<{ hour: number; ticketsDelayed: number }>;
  overload: Array<{ stationId: number | null; stationName: string; peakConcurrent: number }>;
}

export interface KitchenAiSummary {
  summary: string;
  insights: string[];
  generatedAt: string;
  cached: boolean;
}

export function useKitchenPerformance(custom?: { from: string; to: string }, kitchenId?: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  const params = new URLSearchParams();
  if (custom) { params.set("from", custom.from); params.set("to", custom.to); }
  if (kitchenId != null) params.set("kitchenId", String(kitchenId));
  const q = params.toString();
  return useQuery({
    queryKey: ["kitchen-performance", RESTAURANT_ID, custom, kitchenId],
    queryFn: () => apiGet<KitchenPerformanceData>(`/restaurants/${RESTAURANT_ID}/dashboard/kitchen-performance${q ? `?${q}` : ""}`),
    refetchInterval: 60_000,
  });
}

export function useKitchenPerformanceAiSummary(custom?: { from: string; to: string }, enabled = true) {
  const RESTAURANT_ID = useRestaurantId();
  const params = new URLSearchParams();
  if (custom) { params.set("from", custom.from); params.set("to", custom.to); }
  const q = params.toString();
  return useQuery({
    queryKey: ["kitchen-performance", "ai", RESTAURANT_ID, custom],
    queryFn: () => apiGet<KitchenAiSummary>(`/restaurants/${RESTAURANT_ID}/dashboard/kitchen-performance/ai-summary${q ? `?${q}` : ""}`),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useKitchenDelayConfig() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["settings", "kitchen-delay", RESTAURANT_ID],
    queryFn: () => apiGet<{ section: string; data: { enabled?: boolean; thresholdMinutes?: number; perKitchen?: Record<string, number> } }>(`/restaurants/${RESTAURANT_ID}/settings/kitchen-delay`),
  });
}

export function useUpdateKitchenDelayConfig() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { enabled?: boolean; thresholdMinutes?: number; perKitchen?: Record<string, number> }) =>
      apiPut(`/restaurants/${RESTAURANT_ID}/settings/kitchen-delay`, { data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "kitchen-delay", RESTAURANT_ID] }),
  });
}

export function useReports(period = "7d", custom?: { from: string; to: string }, groupBy = "daily") {
  const RESTAURANT_ID = useRestaurantId();
  const q = custom
    ? `from=${custom.from}&to=${custom.to}&groupBy=${groupBy}`
    : `period=${period}&groupBy=${groupBy}`;
  return useQuery({
    queryKey: ["reports", RESTAURANT_ID, period, custom, groupBy],
    queryFn: () => apiGet<ReportsData>(`/restaurants/${RESTAURANT_ID}/dashboard/reports?${q}`),
  });
}

export function useCreateMenu() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMenuInput) => apiPost<Menu>(`/restaurants/${RESTAURANT_ID}/menus`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menus"] }),
  });
}

export function useUpdateMenu() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateMenuInput) => apiPatch<Menu>(`/restaurants/${RESTAURANT_ID}/menus/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menus"] }),
  });
}

export function useDeleteMenu() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/menus/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["menus"] }),
  });
}

export function useCreateCategory() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCategoryInput) => apiPost<MenuCategory>(`/restaurants/${RESTAURANT_ID}/categories`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useUpdateCategory() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateCategoryInput) => apiPatch<MenuCategory>(`/restaurants/${RESTAURANT_ID}/categories/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useDeleteCategory() {
  const RESTAURANT_ID = useRestaurantId();
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
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["shifts", RESTAURANT_ID],
    queryFn: () => apiGet<Shift[]>(`/restaurants/${RESTAURANT_ID}/shifts`),
  });
}

export function useCreateShift() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateShiftInput) => apiPost<Shift>(`/restaurants/${RESTAURANT_ID}/shifts`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

export function useUpdateShift() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<CreateShiftInput> & { id: number }) => apiPatch<Shift>(`/restaurants/${RESTAURANT_ID}/shifts/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

export function useDeleteShift() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/shifts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shifts"] }),
  });
}

export function useStaffShifts(userId?: number) {
  const RESTAURANT_ID = useRestaurantId();
  const q = userId ? `?userId=${userId}` : "";
  return useQuery({
    queryKey: ["staff-shifts", RESTAURANT_ID, userId],
    queryFn: () => apiGet<StaffShift[]>(`/restaurants/${RESTAURANT_ID}/staff-shifts${q}`),
  });
}

export function useCreateStaffShift() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateStaffShiftInput) => apiPost<StaffShift>(`/restaurants/${RESTAURANT_ID}/staff-shifts`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-shifts"] }),
  });
}

export function useAttendance(params?: { userId?: number; from?: string; to?: string }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.userId) q.set("userId", String(params.userId));
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  const qs = q.toString();
  return useQuery({
    queryKey: ["attendance", RESTAURANT_ID, params],
    queryFn: () => apiGet<AttendanceRecord[]>(`/restaurants/${RESTAURANT_ID}/attendance${qs ? `?${qs}` : ""}`),
  });
}

export function useClockIn() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ClockInInput) => apiPost<AttendanceRecord>(`/restaurants/${RESTAURANT_ID}/attendance/punch-in`, { ...data, source: data.source ?? "web" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function useClockOut() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: number; notes?: string }) => apiPatch<AttendanceRecord>(`/restaurants/${RESTAURANT_ID}/attendance/${id}/clock-out`, { notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function usePunchOut() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { userId?: number; notes?: string }) => apiPost<AttendanceRecord>(`/restaurants/${RESTAURANT_ID}/attendance/punch-out`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function useMarkAttendance() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MarkAttendanceInput) => apiPost<AttendanceRecord>(`/restaurants/${RESTAURANT_ID}/attendance/mark`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function usePatchAttendance() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: PatchAttendanceInput) => apiPatch<AttendanceRecord>(`/restaurants/${RESTAURANT_ID}/attendance/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function useBulkWeeklyOff() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { userIds: number[]; date: string }) => apiPost<AttendanceRecord[]>(`/restaurants/${RESTAURANT_ID}/attendance/weekly-off`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function useDeleteAttendance() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/attendance/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
  });
}

export function useDeleteStaffShift() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/staff-shifts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-shifts"] }),
  });
}

// ---------- Leave management ----------

export function useLeavePolicies() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["leave-policies", RESTAURANT_ID],
    queryFn: () => apiGet<LeavePolicy[]>(`/restaurants/${RESTAURANT_ID}/leave-policies`),
  });
}

export function useCreateLeavePolicy() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateLeavePolicyInput) => apiPost<LeavePolicy>(`/restaurants/${RESTAURANT_ID}/leave-policies`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave-policies", RESTAURANT_ID] }),
  });
}

export function useUpdateLeavePolicy() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Partial<CreateLeavePolicyInput> & { isActive?: boolean }) =>
      apiPatch<LeavePolicy>(`/restaurants/${RESTAURANT_ID}/leave-policies/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave-policies", RESTAURANT_ID] }),
  });
}

export function useDeleteLeavePolicy() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/leave-policies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave-policies", RESTAURANT_ID] }),
  });
}

export function useLeaveBalances(userId: number | null, year?: number) {
  const RESTAURANT_ID = useRestaurantId();
  const y = year ?? new Date().getFullYear();
  return useQuery({
    queryKey: ["leave-balances", RESTAURANT_ID, userId, y],
    queryFn: () => apiGet<LeaveBalance[]>(`/restaurants/${RESTAURANT_ID}/leave-balances?userId=${userId}&year=${y}`),
    enabled: userId !== null,
  });
}

export function useSetLeaveBalance() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { userId: number; year: number; leaveType: string; opening: number }) =>
      apiPost<LeaveBalance>(`/restaurants/${RESTAURANT_ID}/leave-balances`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave-balances", RESTAURANT_ID] }),
  });
}

export function useLeaveRequests(params?: { status?: string; userId?: number }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.userId) q.set("userId", String(params.userId));
  return useQuery({
    queryKey: ["leave-requests", RESTAURANT_ID, params],
    queryFn: () => apiGet<LeaveRequest[]>(`/restaurants/${RESTAURANT_ID}/leave-requests?${q}`),
  });
}

export function useCreateLeaveRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateLeaveRequestInput) => apiPost<LeaveRequest>(`/restaurants/${RESTAURANT_ID}/leave-requests`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["leave-balances", RESTAURANT_ID] });
    },
  });
}

export function useApproveLeaveRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decisionNote }: { id: number; decisionNote?: string }) =>
      apiPost<LeaveRequest>(`/restaurants/${RESTAURANT_ID}/leave-requests/${id}/approve`, { decisionNote }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["leave-balances", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

export function useRejectLeaveRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decisionNote }: { id: number; decisionNote?: string }) =>
      apiPost<LeaveRequest>(`/restaurants/${RESTAURANT_ID}/leave-requests/${id}/reject`, { decisionNote }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["leave-balances", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

export function useCancelLeaveRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost<LeaveRequest>(`/restaurants/${RESTAURANT_ID}/leave-requests/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["leave-balances", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

function buildAuditQuery(params?: AuditLogFilters): string {
  const q = new URLSearchParams();
  if (!params) return q.toString();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  return q.toString();
}

export function useAuditLogs(params?: AuditLogFilters) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["audit-logs", RESTAURANT_ID, params],
    queryFn: () => apiGet<AuditLogList>(`/restaurants/${RESTAURANT_ID}/audit-logs?${buildAuditQuery(params)}`),
  });
}

export function useAuditLogDetail(id: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["audit-log-detail", RESTAURANT_ID, id],
    queryFn: () => apiGet<AuditLog>(`/restaurants/${RESTAURANT_ID}/audit-logs/${id}`),
    enabled: !!id,
  });
}

export function useAdminAuditLogs(params?: AuditLogFilters) {
  return useQuery({
    queryKey: ["admin-audit-logs", params],
    queryFn: () => apiGet<AuditLogList>(`/admin/audit-logs?${buildAuditQuery(params)}`),
  });
}

export function useAdminAuditLogDetail(id: number | null) {
  return useQuery({
    queryKey: ["admin-audit-log-detail", id],
    queryFn: () => apiGet<AuditLogDetail>(`/admin/audit-logs/${id}`),
    enabled: !!id,
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
  const rid = useInventoryRestaurantId();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateInventoryItemInput) => apiPatch(`/restaurants/${rid}/inventory/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useDeleteInventoryItem() {
  const qc = useQueryClient();
  const rid = useInventoryRestaurantId();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${rid}/inventory/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useInventoryTransactions(itemId: number | null) {
  const rid = useInventoryRestaurantId();
  return useQuery({
    queryKey: ["inventory", "transactions", rid, itemId],
    queryFn: () => apiGet<InventoryTransaction[]>(`/restaurants/${rid}/inventory/${itemId}/transactions`),
    enabled: itemId !== null,
  });
}

export function useInventoryItemBatches(itemId: number | null, opts?: { onlyOpen?: boolean }) {
  const rid = useInventoryRestaurantId();
  const onlyOpen = opts?.onlyOpen ?? true;
  return useQuery({
    queryKey: ["inventory", "batches", rid, itemId, onlyOpen],
    queryFn: () => apiGet<import("./types").InventoryItemBatch[]>(
      `/restaurants/${rid}/inventory/${itemId}/batches?onlyOpen=${onlyOpen}`,
    ),
    enabled: itemId !== null,
  });
}

export function useDeleteInventoryBatch() {
  const rid = useInventoryRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: number) => apiDelete(`/restaurants/${rid}/inventory/batches/${batchId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}

export function useCreateSupplier() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSupplierInput) => apiPost(`/restaurants/${RESTAURANT_ID}/suppliers`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

export function useUpdateSupplier() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateSupplierInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/suppliers/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

export function useDeleteSupplier() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/suppliers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

export function usePurchaseOrders() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["purchase-orders", RESTAURANT_ID],
    queryFn: () => apiGet<PurchaseOrder[]>(`/restaurants/${RESTAURANT_ID}/purchase-orders`),
  });
}

export function useCreatePurchaseOrder() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePurchaseOrderInput) => apiPost(`/restaurants/${RESTAURANT_ID}/purchase-orders`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
}

export function useUpdatePurchaseOrder() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: {
      id: number; status?: string; notes?: string; totalAmount?: string; paymentMethod?: string;
      batches?: Array<{ purchaseOrderItemId: number; batchNumber?: string | null; expiryDate?: string | null; quantity?: string | number }>;
    }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/purchase-orders/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}

export function useUpdatePurchaseOrderItems() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: number; items: Array<{ inventoryItemId?: number | null; name: string; unit: string; quantity: string; costPerUnit: string }> }) =>
      apiPut(`/restaurants/${RESTAURANT_ID}/purchase-orders/${id}/items`, { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
}

export function useDeletePurchaseOrder() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/purchase-orders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
}

export function useCustomer(id: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["customers", RESTAURANT_ID, id],
    queryFn: () => apiGet<Customer>(`/restaurants/${RESTAURANT_ID}/customers/${id}`),
    enabled: id !== null,
  });
}

export function useUpdateCustomer() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateCustomerInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/customers/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useCustomerLoyalty(customerId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["customers", "loyalty", RESTAURANT_ID, customerId],
    queryFn: () => apiGet<LoyaltyAccount>(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/loyalty`),
    enabled: customerId !== null,
  });
}

export function useAddLoyaltyPoints() {
  const RESTAURANT_ID = useRestaurantId();
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
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["coupons", RESTAURANT_ID],
    queryFn: () => apiGet<Coupon[]>(`/restaurants/${RESTAURANT_ID}/coupons`),
  });
}

// ===== Loyalty 2.0 hooks =====
export function useLoyalty2Summary(customerId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["loyalty2", "summary", RESTAURANT_ID, customerId],
    queryFn: () => apiGet<any>(`/restaurants/${RESTAURANT_ID}/loyalty/summary/${customerId}`),
    enabled: customerId !== null,
  });
}

export function useLoyalty2Cashback(customerId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["loyalty2", "cashback", RESTAURANT_ID, customerId],
    queryFn: () => apiGet<any>(`/restaurants/${RESTAURANT_ID}/loyalty/cashback/${customerId}`),
    enabled: customerId !== null,
  });
}

export function useLoyalty2CashbackMutate() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, ...body }: { customerId: number; amount: number; type: "credit" | "redeem"; reason?: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/loyalty/cashback/${customerId}`, body),
    onSuccess: (_d, { customerId }) => {
      qc.invalidateQueries({ queryKey: ["loyalty2", "cashback", RESTAURANT_ID, customerId] });
      qc.invalidateQueries({ queryKey: ["loyalty2", "summary", RESTAURANT_ID, customerId] });
    },
  });
}

export function useLoyalty2AddStamp() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, cardKey, qty }: { customerId: number; cardKey: string; qty?: number }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/loyalty/stamps/${customerId}`, { cardKey, qty }),
    onSuccess: (_d, { customerId }) => qc.invalidateQueries({ queryKey: ["loyalty2", "summary", RESTAURANT_ID, customerId] }),
  });
}

export function useLoyalty2FamilyAdd() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, phone }: { customerId: number; phone: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/loyalty/family/${customerId}/add`, { phone }),
    onSuccess: (_d, { customerId }) => qc.invalidateQueries({ queryKey: ["loyalty2", "summary", RESTAURANT_ID, customerId] }),
  });
}

export function useLoyalty2Analytics(days: number = 30) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["loyalty2", "analytics", RESTAURANT_ID, days],
    queryFn: () => apiGet<any>(`/restaurants/${RESTAURANT_ID}/loyalty/analytics?days=${days}`),
  });
}

export function loyalty2AnalyticsCsvUrl(restaurantId: number, days: number = 30) {
  return `/api/restaurants/${restaurantId}/loyalty/analytics/export.csv?days=${days}`;
}

export function useLoyalty2ReferralLeaderboard() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["loyalty2", "leaderboard", RESTAURANT_ID],
    queryFn: () => apiGet<any[]>(`/restaurants/${RESTAURANT_ID}/loyalty/referral/leaderboard?limit=20`),
  });
}

export function useLoyalty2RevealMystery() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, id }: { customerId: number; id: number }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/loyalty/mystery/${customerId}/reveal/${id}`, {}),
    onSuccess: (_d, { customerId }) => qc.invalidateQueries({ queryKey: ["loyalty2", "summary", RESTAURANT_ID, customerId] }),
  });
}

export function useCreateCoupon() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCouponInput) => apiPost(`/restaurants/${RESTAURANT_ID}/coupons`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

export function useUpdateCoupon() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateCouponInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/coupons/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

export function useDeleteCoupon() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/coupons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

export function useCustomerOrders(customerId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["orders", "customer", RESTAURANT_ID, customerId],
    queryFn: () => apiGet<{ data: import("./types").Order[]; total: number }>(`/restaurants/${RESTAURANT_ID}/orders?customerId=${customerId}&limit=20`),
    enabled: customerId !== null,
  });
}

export function useWasteLog() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["inventory", "waste-log", RESTAURANT_ID],
    queryFn: () => apiGet<(import("./types").InventoryTransaction & { itemName: string; unit: string })[]>(`/restaurants/${RESTAURANT_ID}/inventory/waste-log`),
  });
}

export function useRecipeMappings(params?: { menuItemId?: number; inventoryItemId?: number }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.menuItemId) q.set("menuItemId", String(params.menuItemId));
  if (params?.inventoryItemId) q.set("inventoryItemId", String(params.inventoryItemId));
  return useQuery({
    queryKey: ["recipe-mappings", RESTAURANT_ID, params],
    queryFn: () => apiGet<import("./types").RecipeMapping[]>(`/restaurants/${RESTAURANT_ID}/recipe-mappings?${q}`),
  });
}

export function useCreateRecipeMapping() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: import("./types").CreateRecipeMappingInput) => apiPost(`/restaurants/${RESTAURANT_ID}/recipe-mappings`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipe-mappings"] });
      qc.invalidateQueries({ queryKey: ["food-cost"] });
    },
  });
}

export function useDeleteRecipeMapping() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/recipe-mappings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipe-mappings"] });
      qc.invalidateQueries({ queryKey: ["food-cost"] });
    },
  });
}

export function useUpdateRecipeMapping() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: import("./types").UpdateRecipeMappingInput) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/recipe-mappings/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipe-mappings"] });
      qc.invalidateQueries({ queryKey: ["food-cost"] });
    },
  });
}

export function useFoodCostReport(threshold: number = 65) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["food-cost", RESTAURANT_ID, threshold],
    queryFn: () => apiGet<import("./types").FoodCostReport>(`/restaurants/${RESTAURANT_ID}/food-cost?threshold=${threshold}`),
  });
}

export interface AddonsReportRow {
  modifierId: number | null;
  name: string;
  groupName: string | null;
  totalQuantity: number;
  totalRevenue: number;
  orderCount: number;
}
export interface AddonsReport {
  rows: AddonsReportRow[];
  totalRevenue: number;
  totalQuantity: number;
}
export function useAddonsReport(opts: { period?: string; custom?: { from: string; to: string } }) {
  const RESTAURANT_ID = useRestaurantId();
  const qs = new URLSearchParams();
  if (opts.custom) { qs.set("from", opts.custom.from); qs.set("to", opts.custom.to); }
  else qs.set("period", opts.period ?? "30d");
  return useQuery({
    queryKey: ["addons-report", RESTAURANT_ID, opts.period ?? null, opts.custom ?? null],
    queryFn: () => apiGet<AddonsReport>(`/restaurants/${RESTAURANT_ID}/reports/addons?${qs.toString()}`),
  });
}

export function useMenuEngineeringReport(opts: {
  period?: string;
  custom?: { from: string; to: string };
  marginThreshold?: number | null;
  popularityThreshold?: number | null;
}) {
  const RESTAURANT_ID = useRestaurantId();
  const qs = new URLSearchParams();
  if (opts.custom) {
    qs.set("from", opts.custom.from);
    qs.set("to", opts.custom.to);
  } else {
    qs.set("period", opts.period ?? "30d");
  }
  if (opts.marginThreshold != null) qs.set("marginThreshold", String(opts.marginThreshold));
  if (opts.popularityThreshold != null) qs.set("popularityThreshold", String(opts.popularityThreshold));
  return useQuery({
    queryKey: ["menu-engineering", RESTAURANT_ID, opts.period ?? null, opts.custom ?? null, opts.marginThreshold ?? null, opts.popularityThreshold ?? null],
    queryFn: () => apiGet<import("./types").MenuEngineeringReport>(`/restaurants/${RESTAURANT_ID}/menu-engineering?${qs.toString()}`),
  });
}

export function useCustomerAddresses(customerId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["customer-addresses", customerId],
    queryFn: () => apiGet<import("./types").CustomerAddress[]>(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/addresses`),
    enabled: customerId !== null,
  });
}

export function useCreateCustomerAddress() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, address, label, isDefault }: { customerId: number; address: string; label?: string; isDefault?: boolean }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/addresses`, { address, label, isDefault }),
    onSuccess: (_: unknown, vars: { customerId: number; address: string; label?: string; isDefault?: boolean }) =>
      qc.invalidateQueries({ queryKey: ["customer-addresses", vars.customerId] }),
  });
}

export function useDeleteCustomerAddress() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, addressId }: { customerId: number; addressId: number }) =>
      apiDelete(`/restaurants/${RESTAURANT_ID}/customers/${customerId}/addresses/${addressId}`),
    onSuccess: (_: unknown, vars: { customerId: number; addressId: number }) =>
      qc.invalidateQueries({ queryKey: ["customer-addresses", vars.customerId] }),
  });
}

export function useApplyCoupon() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, code }: { orderId: number; code: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/apply-coupon`, { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
}

export function useApplyLoyalty() {
  const RESTAURANT_ID = useRestaurantId();
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
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["customers", "phone", RESTAURANT_ID, phone],
    queryFn: () => apiGet<{ data: import("./types").Customer[]; total: number }>(`/restaurants/${RESTAURANT_ID}/customers?search=${encodeURIComponent(phone!)}`),
    enabled: !!phone && phone.length >= 6,
    select: (res) => (res.data ?? [])[0] ?? null,
  });
}

export function useMarkAllNotificationsRead() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost(`/restaurants/${RESTAURANT_ID}/notifications/mark-read`, { all: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", RESTAURANT_ID] });
    },
  });
}

export function useSubscription(restaurantId: number) {
  return useQuery({
    queryKey: ["subscription", restaurantId],
    queryFn: () => apiGet<import("./types").SubscriptionInfo>(`/restaurants/${restaurantId}/subscription`),
    staleTime: 60000,
  });
}

export function useCreateCheckout() {
  return useMutation({
    mutationFn: ({ restaurantId, planId, successUrl, cancelUrl, couponCode, billingPeriod }: { restaurantId: number; planId: number; successUrl: string; cancelUrl: string; couponCode?: string; billingPeriod?: "monthly" | "yearly" }) =>
      apiPost<{ url: string | null; sessionId?: string; mock?: boolean; activated?: boolean; freeActivation?: boolean; couponCode?: string | null }>(
        `/restaurants/${restaurantId}/subscription/create-checkout`,
        { planId, successUrl, cancelUrl, couponCode, billingPeriod },
      ),
  });
}

export function useCreateCashfreeOrder() {
  return useMutation({
    mutationFn: ({ restaurantId, planId, successUrl, couponCode, billingPeriod }: { restaurantId: number; planId: number; successUrl: string; couponCode?: string; billingPeriod?: "monthly" | "yearly" }) =>
      apiPost<{ url: string | null; orderId?: string; paymentSessionId?: string | null; mock?: boolean; activated?: boolean; freeActivation?: boolean; couponCode?: string | null }>(
        `/restaurants/${restaurantId}/subscription/create-cashfree-order`,
        { planId, successUrl, couponCode, billingPeriod },
      ),
  });
}

export function useConfirmCashfreeOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ restaurantId, orderId }: { restaurantId: number; orderId: string }) =>
      apiPost<{ activated: boolean; status?: string; mock?: boolean }>(`/restaurants/${restaurantId}/subscription/cashfree-confirm`, { orderId }),
    onSuccess: (_d, { restaurantId }) => {
      qc.invalidateQueries({ queryKey: ["subscription", restaurantId] });
    },
  });
}

// ─── Razorpay + manual payment methods ──────────────────────────
export interface PaymentMethodsView {
  online: {
    cashfree: { enabled: boolean };
    razorpay: { enabled: boolean; keyId: string | null };
    stripe:   { enabled: boolean };
    default: "cashfree" | "razorpay" | null;
  };
  manual: {
    bank: { enabled: boolean; isPlaceholder?: boolean; bankName?: string; accountHolder?: string; accountNumber?: string; ifsc?: string; branch?: string; instructions?: string };
    upi:  { enabled: boolean; isPlaceholder?: boolean; upiId?: string; payeeName?: string; qrUrl?: string };
  };
  latestManual: {
    id: number; planId: number; method: string; amount: string; currency: string;
    reference: string | null; proofUrl: string | null; note: string | null;
    status: "pending" | "approved" | "rejected"; reviewerNote: string | null;
    submittedAt: string; reviewedAt: string | null;
  } | null;
  pendingManual: { id: number; planId: number; method: string; amount: string; status: string; submittedAt: string } | null;
}

export function usePaymentMethods(restaurantId: number) {
  return useQuery({
    queryKey: ["billing", "methods", restaurantId],
    queryFn: () => apiGet<PaymentMethodsView>(`/restaurants/${restaurantId}/billing/methods`),
    staleTime: 60_000,
  });
}

export function useCreateSubscriptionRazorpayOrder() {
  return useMutation({
    mutationFn: ({ restaurantId, planId, couponCode, billingPeriod }: { restaurantId: number; planId: number; couponCode?: string; billingPeriod?: "monthly" | "yearly" }) =>
      apiPost<{ orderId?: string; amount?: number; currency?: string; keyId?: string; receipt?: string; activated?: boolean }>(
        `/restaurants/${restaurantId}/subscription/create-razorpay-order`, { planId, couponCode, billingPeriod },
      ),
  });
}

export function useConfirmSubscriptionRazorpayOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ restaurantId, orderId, paymentId, signature }: { restaurantId: number; orderId: string; paymentId: string; signature: string }) =>
      apiPost<{ activated: boolean; status?: string }>(`/restaurants/${restaurantId}/subscription/razorpay-confirm`, { orderId, paymentId, signature }),
    onSuccess: (_d, { restaurantId }) => {
      qc.invalidateQueries({ queryKey: ["subscription", restaurantId] });
      qc.invalidateQueries({ queryKey: ["billing", "methods", restaurantId] });
    },
  });
}

export function useSubmitManualPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ restaurantId, planId, method, reference, proofUrl, note, amount, couponCode, billingPeriod }: { restaurantId: number; planId: number; method: "bank" | "upi"; reference?: string; proofUrl?: string; note?: string; amount?: number; couponCode?: string; billingPeriod?: "monthly" | "yearly" }) =>
      apiPost<{ id: number; status: string }>(`/restaurants/${restaurantId}/subscription/manual-payment`, { planId, method, reference, proofUrl, note, amount, couponCode, billingPeriod }),
    onSuccess: (_d, { restaurantId }) => {
      qc.invalidateQueries({ queryKey: ["billing", "methods", restaurantId] });
      qc.invalidateQueries({ queryKey: ["subscription", restaurantId] });
    },
  });
}

// ─── Super-admin: payment-method settings + approvals ───────────
export interface PaymentProviderRow {
  provider: "cashfree" | "razorpay" | "bank" | "upi";
  isEnabled: boolean;
  isDefault: boolean;
  config: Record<string, unknown>;
  updatedAt: string | null;
}

export function useAdminPaymentMethods() {
  return useQuery({
    queryKey: ["admin", "payment-methods"],
    queryFn: () => apiGet<{ providers: PaymentProviderRow[] }>("/admin/payment-methods"),
  });
}

export function useUpdateAdminPaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, ...body }: { provider: string; isEnabled?: boolean; isDefault?: boolean; config?: Record<string, unknown> }) =>
      apiPut<PaymentProviderRow>(`/admin/payment-methods/${provider}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "payment-methods"] });
      qc.invalidateQueries({ queryKey: ["billing", "methods"] });
    },
  });
}

export interface AdminManualPaymentRow {
  id: number; tenantId: number; tenantName: string | null;
  planId: number; planName: string | null;
  amount: string; currency: string;
  method: string; reference: string | null; proofUrl: string | null; note: string | null;
  status: "pending" | "approved" | "rejected";
  reviewerNote: string | null; reviewedBy: number | null; reviewedAt: string | null;
  submittedBy: number | null; submittedByName: string | null;
  createdAt: string;
}

export function useAdminManualPayments(status: "pending" | "approved" | "rejected" | "all" = "pending") {
  return useQuery({
    queryKey: ["admin", "manual-payments", status],
    queryFn: () => apiGet<{ data: AdminManualPaymentRow[] }>(`/admin/manual-payments?status=${status}`),
    refetchInterval: 30_000,
  });
}

export function useApproveManualPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) => apiPost(`/admin/manual-payments/${id}/approve`, { note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "manual-payments"] }),
  });
}

export function useRejectManualPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => apiPost(`/admin/manual-payments/${id}/reject`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "manual-payments"] }),
  });
}

export function useMockActivate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ restaurantId, planId, couponCode, billingPeriod }: { restaurantId: number; planId: number; couponCode?: string; billingPeriod?: "monthly" | "yearly" }) =>
      apiPost(`/restaurants/${restaurantId}/subscription/mock-activate`, { planId, couponCode, billingPeriod }),
    onSuccess: (_data, { restaurantId }) => {
      qc.invalidateQueries({ queryKey: ["subscription", restaurantId] });
    },
  });
}

export interface CouponValidationResult {
  valid: boolean;
  code?: string;
  discountType?: "flat" | "percent" | "trial_extension" | "first_month" | "lifetime";
  discountValue?: number;
  discountApplied?: number;
  trialDaysAdded?: number;
  finalAmount?: number;
  originalAmount?: number;
  currency?: string;
  message?: string;
  reason?: string;
}

export function useValidateCoupon() {
  return useMutation({
    mutationFn: ({ code, planId, restaurantId, tenantId }: { code: string; planId: number; restaurantId?: number; tenantId?: number }) =>
      apiPost<CouponValidationResult>(`/coupons/validate`, { code, planId, restaurantId, tenantId }),
  });
}

export { type InventoryItem, type Customer, type Coupon, type LoyaltyTransaction };
export { type Supplier, type PurchaseOrder, type InventoryTransaction };

export function useExpenseCategories() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["expense-categories", RESTAURANT_ID],
    queryFn: () => apiGet<import("./types").ExpenseCategory[]>(`/restaurants/${RESTAURANT_ID}/expense-categories`),
  });
}

export function useCreateExpenseCategory() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color?: string; icon?: string; categoryKind?: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/expense-categories`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense-categories"] }),
  });
}

export function useUpdateExpenseCategory() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; color?: string; icon?: string; categoryKind?: string; isActive?: boolean }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/expense-categories/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense-categories"] }),
  });
}

export function useExpenses(params?: {
  from?: string; to?: string; categoryId?: number; search?: string; page?: number; status?: string;
}) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  if (params?.categoryId) q.set("categoryId", String(params.categoryId));
  if (params?.search) q.set("search", params.search);
  if (params?.page) q.set("page", String(params.page));
  if (params?.status) q.set("status", params.status);
  return useQuery({
    queryKey: ["expenses", RESTAURANT_ID, params],
    queryFn: () => apiGet<import("./types").ExpensesResponse>(`/restaurants/${RESTAURANT_ID}/expenses?${q}`),
  });
}

export function useApproveExpense() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${RESTAURANT_ID}/expenses/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-summary"] });
      qc.invalidateQueries({ queryKey: ["pnl"] });
    },
  });
}

export function useRejectExpense() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/expenses/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-summary"] });
    },
  });
}

export function useDeleteExpenseCategory() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/expense-categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense-categories"] }),
  });
}

export function useCreateExpense() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: import("./types").CreateExpenseInput) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/expenses`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useUpdateExpense() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<import("./types").CreateExpenseInput> & { id: number }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/expenses/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useDeleteExpense() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/expenses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "summary"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}



export function useCurrentCashRegister() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["cash-register", "current", RESTAURANT_ID],
    queryFn: () => apiGet<import("./types").CashRegisterCurrent>(`/restaurants/${RESTAURANT_ID}/cash-register/current`),
    refetchInterval: 15000,
  });
}

export function useCashRegisterSessions(params?: { from?: string; to?: string; status?: string; page?: number; pageSize?: number }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  if (params?.status) q.set("status", params.status);
  if (params?.page) q.set("page", String(params.page));
  if (params?.pageSize) q.set("pageSize", String(params.pageSize));
  return useQuery({
    queryKey: ["cash-register", "sessions", RESTAURANT_ID, params],
    queryFn: () => apiGet<import("./types").CashRegisterSessionsResponse>(`/restaurants/${RESTAURANT_ID}/cash-register/sessions?${q}`),
  });
}

export function useCashRegisterSession(sessionId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["cash-register", "session", RESTAURANT_ID, sessionId],
    queryFn: () => apiGet<import("./types").CashRegisterSessionDetail>(`/restaurants/${RESTAURANT_ID}/cash-register/sessions/${sessionId}`),
    enabled: sessionId !== null,
  });
}

export function useOpenCashRegister() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: import("./types").OpenRegisterInput) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/cash-register/sessions/open`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash-register"] });
    },
  });
}

export function useCloseCashRegister() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, ...data }: import("./types").CloseRegisterInput & { sessionId: number }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/cash-register/sessions/${sessionId}/close`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash-register"] });
    },
  });
}

export function useRecordCashMovement() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, ...data }: import("./types").CashMovementInput & { sessionId: number }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/cash-register/sessions/${sessionId}/movements`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash-register"] });
    },
  });
}

export function useCashVarianceHistory(params?: { from?: string; to?: string }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  return useQuery({
    queryKey: ["cash-register", "variance-history", RESTAURANT_ID, params],
    queryFn: () => apiGet<import("./types").CashVarianceHistory>(`/restaurants/${RESTAURANT_ID}/cash-register/variance-history?${q}`),
  });
}

export function useCashRegisterReport(sessionId: number | null, kind: "x" | "z") {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["cash-register", "report", RESTAURANT_ID, sessionId, kind],
    queryFn: () => apiGet<import("./types").CashRegisterReport>(`/restaurants/${RESTAURANT_ID}/cash-register/sessions/${sessionId}/${kind}-report`),
    enabled: sessionId !== null,
  });
}

export function useExpenseSummary(params?: { from?: string; to?: string }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  return useQuery({
    queryKey: ["expense-summary", RESTAURANT_ID, params],
    queryFn: () => apiGet<import("./types").ExpenseSummary>(`/restaurants/${RESTAURANT_ID}/expenses/summary?${q}`),
  });
}

export function useRecurringExpenses() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["recurring-expenses", RESTAURANT_ID],
    queryFn: () => apiGet<import("./types").RecurringExpense[]>(`/restaurants/${RESTAURANT_ID}/recurring-expenses`),
  });
}

export function useCreateRecurringExpense() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: import("./types").CreateRecurringExpenseInput) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/recurring-expenses`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring-expenses"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
  });
}

export function useUpdateRecurringExpense() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<import("./types").CreateRecurringExpenseInput> & { id: number; isActive?: boolean }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/recurring-expenses/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring-expenses"] }),
  });
}

export function useDeleteRecurringExpense() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/recurring-expenses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring-expenses"] }),
  });
}

export function usePayments(params?: {
  from?: string; to?: string; method?: string; direction?: string;
  partyType?: string; page?: number; pageSize?: number;
}) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  if (params?.method) q.set("method", params.method);
  if (params?.direction) q.set("direction", params.direction);
  if (params?.partyType) q.set("partyType", params.partyType);
  if (params?.page) q.set("page", String(params.page));
  if (params?.pageSize) q.set("pageSize", String(params.pageSize));
  return useQuery({
    queryKey: ["payments", RESTAURANT_ID, params],
    queryFn: () => apiGet<PaymentsResponse>(`/restaurants/${RESTAURANT_ID}/payments?${q}`),
  });
}

export function usePaymentSummary(params?: { from?: string; to?: string }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  return useQuery({
    queryKey: ["payments", "summary", RESTAURANT_ID, params],
    queryFn: () => apiGet<PaymentSummary>(`/restaurants/${RESTAURANT_ID}/payments/summary?${q}`),
  });
}

export function useCreatePayment() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePaymentInput) => apiPost<Payment>(`/restaurants/${RESTAURANT_ID}/payments`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["payments", "summary", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["due-payments", RESTAURANT_ID] });
    },
  });
}

export function useSettlePayment() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SettlePaymentInput) => apiPost<Payment>(`/restaurants/${RESTAURANT_ID}/payments/settle`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["payments", "summary", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["due-payments", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
    },
  });
}

export function useDuePayments() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["due-payments", RESTAURANT_ID],
    queryFn: () => apiGet<DuePaymentsData>(`/restaurants/${RESTAURANT_ID}/due-payments`),
    refetchInterval: 30000,
  });
}

// ---------------------------------------------------------------------------
// Multi-branch consolidated dashboard hooks.
//
// When the branch switcher is on "All branches" these hooks hit the
// tenant-level endpoints; when a specific branch is selected they fall back
// to the existing per-restaurant endpoints.
// ---------------------------------------------------------------------------

export interface CompareBranchRow {
  restaurantId: number;
  name: string;
  city: string | null;
  revenue: string;
  orders: number;
  tax: string;
  avgOrderValue: string;
  expenses: string | null;
  netProfit: string | null;
}

export interface AggregateInventoryItem {
  key: string;
  name: string;
  unit: string;
  category: string;
  totalStock: string;
  totalMin: string;
  branchCount: number;
  lowStockBranches: number;
  isLowStock: boolean;
  branches: {
    restaurantId: number;
    restaurantName: string;
    currentStock: string;
    minStockLevel: string;
    isLowStock: boolean;
  }[];
}

export function useBranchAwareDashboardSummary() {
  const RESTAURANT_ID = useRestaurantId();
  const { tenantId, selectedBranchId, isAllBranches } = useBranchContext();
  const branchId = selectedBranchId ?? RESTAURANT_ID;
  return useQuery({
    queryKey: ["dashboard", "summary", { tenantId, selectedBranchId }],
    queryFn: () =>
      isAllBranches && tenantId != null
        ? apiGet<DashboardSummary>(`/tenants/${tenantId}/dashboard/summary?branchId=all`)
        : apiGet<DashboardSummary>(`/restaurants/${branchId}/dashboard/summary`),
    refetchInterval: 30000,
    enabled: tenantId != null || !isAllBranches,
  });
}

export function useBranchAwareRevenueTrend(period = "7d", groupBy = "daily") {
  const RESTAURANT_ID = useRestaurantId();
  const { tenantId, selectedBranchId, isAllBranches } = useBranchContext();
  const branchId = selectedBranchId ?? RESTAURANT_ID;
  return useQuery({
    queryKey: ["dashboard", "revenue-trend", { tenantId, selectedBranchId, period, groupBy }],
    queryFn: () =>
      isAllBranches && tenantId != null
        ? apiGet<RevenueTrendItem[]>(`/tenants/${tenantId}/dashboard/revenue-trend?branchId=all&period=${period}&groupBy=${groupBy}`)
        : apiGet<RevenueTrendItem[]>(`/restaurants/${branchId}/dashboard/revenue-trend?period=${period}&groupBy=${groupBy}`),
    enabled: tenantId != null || !isAllBranches,
  });
}

export function useBranchAwarePopularItems(limit = 8) {
  const RESTAURANT_ID = useRestaurantId();
  const { tenantId, selectedBranchId, isAllBranches } = useBranchContext();
  const branchId = selectedBranchId ?? RESTAURANT_ID;
  return useQuery({
    queryKey: ["dashboard", "popular-items", { tenantId, selectedBranchId, limit }],
    queryFn: () =>
      isAllBranches && tenantId != null
        ? apiGet<PopularItem[]>(`/tenants/${tenantId}/dashboard/popular-items?branchId=all&limit=${limit}`)
        : apiGet<PopularItem[]>(`/restaurants/${branchId}/dashboard/popular-items?limit=${limit}`),
    enabled: tenantId != null || !isAllBranches,
  });
}

export function useBranchAwareReports(period = "7d", custom?: { from: string; to: string }, groupBy = "daily") {
  const RESTAURANT_ID = useRestaurantId();
  const { tenantId, selectedBranchId, isAllBranches } = useBranchContext();
  const branchId = selectedBranchId ?? RESTAURANT_ID;
  const qs = custom
    ? `from=${custom.from}&to=${custom.to}&groupBy=${groupBy}`
    : `period=${period}&groupBy=${groupBy}`;
  return useQuery({
    queryKey: ["reports", { tenantId, selectedBranchId, period, custom, groupBy }],
    queryFn: () =>
      isAllBranches && tenantId != null
        ? apiGet<ReportsData>(`/tenants/${tenantId}/dashboard/reports?branchId=all&${qs}`)
        : apiGet<ReportsData>(`/restaurants/${branchId}/dashboard/reports?${qs}`),
    enabled: tenantId != null || !isAllBranches,
  });
}

export function useCompareBranches(period = "30d", custom?: { from: string; to: string }) {
  const { tenantId, canConsolidate, hasMultipleBranches } = useBranchContext();
  const qs = custom ? `from=${custom.from}&to=${custom.to}` : `period=${period}`;
  return useQuery({
    queryKey: ["compare-branches", tenantId, period, custom],
    queryFn: () => apiGet<{ branches: CompareBranchRow[] }>(`/tenants/${tenantId}/dashboard/compare-branches?${qs}`),
    enabled: tenantId != null && canConsolidate && hasMultipleBranches,
  });
}

export function useAggregateInventory() {
  const { tenantId, canConsolidate, hasMultipleBranches } = useBranchContext();
  return useQuery({
    queryKey: ["inventory", "aggregate", tenantId],
    queryFn: () => apiGet<AggregateInventoryItem[]>(`/tenants/${tenantId}/inventory/aggregate`),
    enabled: tenantId != null && canConsolidate && hasMultipleBranches,
  });
}


export function usePayrollRuns() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["payroll-runs", RESTAURANT_ID],
    queryFn: () => apiGet<import("./types").PayrollRun[]>(`/restaurants/${RESTAURANT_ID}/payroll-runs`),
  });
}

export function usePayrollRun(runId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["payroll-run", RESTAURANT_ID, runId],
    queryFn: () => apiGet<import("./types").PayrollRunResponse>(`/restaurants/${RESTAURANT_ID}/payroll-runs/${runId}`),
    enabled: runId !== null,
  });
}

export function useCreatePayrollRun() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) =>
      apiPost<import("./types").PayrollRunResponse>(`/restaurants/${RESTAURANT_ID}/payroll-runs`, {
        periodYear: year,
        periodMonth: month,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-runs", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["payroll-summary", RESTAURANT_ID] });
    },
  });
}

export function usePatchPayrollItem() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, patch }: { itemId: number; patch: import("./types").PayrollItemOverrideInput }) =>
      apiPatch<import("./types").PayrollRunResponse>(`/restaurants/${RESTAURANT_ID}/payroll-items/${itemId}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["payroll-run", RESTAURANT_ID, data.run.id] });
      qc.invalidateQueries({ queryKey: ["payroll-runs", RESTAURANT_ID] });
    },
  });
}

export function useFinalizePayrollRun() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: number) =>
      apiPost<import("./types").PayrollRunResponse>(`/restaurants/${RESTAURANT_ID}/payroll-runs/${runId}/finalize`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["payroll-run", RESTAURANT_ID, data.run.id] });
      qc.invalidateQueries({ queryKey: ["payroll-runs", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["payroll-summary", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["staff", "advances"] });
    },
  });
}

export function useRecordPayrollPayment() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, payment }: { itemId: number; payment: import("./types").PayrollPaymentInput }) =>
      apiPost<import("./types").PayrollRunResponse>(`/restaurants/${RESTAURANT_ID}/payroll-items/${itemId}/payments`, payment),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["payroll-run", RESTAURANT_ID, data.run.id] });
      qc.invalidateQueries({ queryKey: ["payroll-summary", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["payroll-payments"] });
    },
  });
}

export function usePayrollPayments(itemId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["payroll-payments", RESTAURANT_ID, itemId],
    queryFn: () => apiGet<import("./types").PayrollPayment[]>(`/restaurants/${RESTAURANT_ID}/payroll-items/${itemId}/payments`),
    enabled: itemId !== null,
  });
}

export function usePayrollSummary(year: number, month: number) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["payroll-summary", RESTAURANT_ID, year, month],
    queryFn: () => apiGet<import("./types").PayrollSummaryRow[]>(`/restaurants/${RESTAURANT_ID}/payroll-summary?year=${year}&month=${month}`),
    enabled: year > 0 && month > 0,
  });
}

export function payrollSlipUrl(restaurantId: number, itemId: number, print = false): string {
  const base = getApiUrl(`/restaurants/${restaurantId}/payroll-items/${itemId}/slip`);
  return print ? `${base}?print=1` : base;
}

// ─── Admin: Notification Center (broadcasts + templates) ──────────
export type BroadcastChannel = "in_app" | "email" | "sms" | "whatsapp" | "push";
export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
export type BroadcastPriority = "low" | "medium" | "high" | "urgent";
export type DeliveryStatus = "queued" | "sent" | "delivered" | "failed" | "skipped" | "pending";

/** Combinable filter — each populated field narrows the audience with AND. */
export type AudienceFilter = {
  tenantIds?: number[];
  planIds?: number[];
  planStatuses?: string[];
  countries?: string[];
  cities?: string[];
  roles?: string[];
};

export interface AdminBroadcast {
  id: number;
  title: string;
  message: string;
  subject: string | null;
  channels: BroadcastChannel[];
  audience: AudienceFilter;
  priority: BroadcastPriority;
  templateId: number | null;
  status: BroadcastStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  totalRecipients: number;
  successCount: number;
  failureCount: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminNotificationTemplate {
  id: number;
  name: string;
  slug: string;
  channel: BroadcastChannel;
  subject: string | null;
  body: string;
  variables: string[];
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBroadcastDelivery {
  id: number;
  broadcastId: number;
  channel: BroadcastChannel;
  tenantId: number | null;
  userId: number | null;
  recipient: string | null;
  status: DeliveryStatus;
  error: string | null;
  providerMessageId: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface ChannelCapability { available: boolean; reason?: string }
export function useBroadcastChannelCapabilities() {
  return useQuery({
    queryKey: ["admin", "broadcasts", "channel-capabilities"],
    queryFn: () => apiGet<{ data: Record<BroadcastChannel, ChannelCapability> }>(`/admin/broadcasts/channel-capabilities`),
    staleTime: 60_000,
  });
}

export interface AdminTenantLite { id: number; name: string; slug: string; planStatus: string }
export function useAdminTenantsSearch(search: string) {
  return useQuery({
    queryKey: ["admin", "tenants", "search", search],
    queryFn: () => apiGet<{ data: AdminTenantLite[] }>(`/tenants?search=${encodeURIComponent(search)}&limit=20`),
    enabled: search.length >= 0,
    staleTime: 30_000,
  });
}

export function useAdminBroadcasts(status: BroadcastStatus | "all" = "all", page = 1, pageSize = 50) {
  const offset = (page - 1) * pageSize;
  return useQuery({
    queryKey: ["admin", "broadcasts", status, page, pageSize],
    queryFn: () => apiGet<{ data: AdminBroadcast[]; total: number; limit: number; offset: number }>(
      `/admin/broadcasts?status=${status}&limit=${pageSize}&offset=${offset}`,
    ),
    refetchInterval: 15_000,
  });
}

export interface BroadcastRecipientStat {
  channel: BroadcastChannel;
  status: DeliveryStatus;
  count: number;
}

export function useAdminBroadcastRecipientStats(id: number | null) {
  return useQuery({
    queryKey: ["admin", "broadcasts", "recipient-stats", id],
    queryFn: () => apiGet<{ data: BroadcastRecipientStat[] }>(`/admin/broadcasts/${id}/recipient-stats`),
    enabled: id !== null,
    refetchInterval: 15_000,
  });
}

export function useAdminBroadcast(id: number | null) {
  return useQuery({
    queryKey: ["admin", "broadcasts", "detail", id],
    queryFn: () => apiGet<{ broadcast: AdminBroadcast }>(`/admin/broadcasts/${id}`),
    enabled: id !== null,
  });
}

export interface RecipientFilters {
  channel?: string;
  status?: string;
  search?: string;
  tenantId?: number | null;
  dateFrom?: string;
  dateTo?: string;
}

export function useAdminBroadcastRecipients(id: number | null, filters: RecipientFilters = {}) {
  const qs = new URLSearchParams();
  if (filters.channel && filters.channel !== "all") qs.set("channel", filters.channel);
  if (filters.status && filters.status !== "all") qs.set("status", filters.status);
  if (filters.search) qs.set("search", filters.search);
  if (filters.tenantId) qs.set("tenantId", String(filters.tenantId));
  if (filters.dateFrom) qs.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) qs.set("dateTo", filters.dateTo);
  return useQuery({
    queryKey: ["admin", "broadcasts", "recipients", id, filters],
    queryFn: () => apiGet<{ data: AdminBroadcastDelivery[] }>(`/admin/broadcasts/${id}/recipients?${qs.toString()}`),
    enabled: id !== null,
    refetchInterval: 5_000,
  });
}

export function useAdminBroadcastsStats() {
  return useQuery({
    queryKey: ["admin", "broadcasts", "stats"],
    queryFn: () => apiGet<{ byStatus: Array<{ status: string; count: number }>; totals: { totalRecipients: number; successCount: number; failureCount: number } }>(`/admin/broadcasts-stats`),
    refetchInterval: 30_000,
  });
}

export interface CreateAdminBroadcastBody {
  title: string;
  message: string;
  subject?: string;
  channels: BroadcastChannel[];
  audience: AudienceFilter;
  priority?: BroadcastPriority;
  scheduledAt?: string | null;
  sendNow?: boolean;
  templateId?: number | null;
  saveAsTemplate?: boolean;
  templateName?: string;
  templateSlug?: string;
}

export function useCreateAdminBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAdminBroadcastBody) => apiPost<AdminBroadcast>("/admin/broadcasts", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "broadcasts"] });
      qc.invalidateQueries({ queryKey: ["admin", "notification-templates"] });
    },
  });
}

export function useUpdateAdminBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<Pick<CreateAdminBroadcastBody, "title" | "message" | "subject" | "channels" | "audience" | "priority" | "scheduledAt">>) =>
      apiPut<AdminBroadcast>(`/admin/broadcasts/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "broadcasts"] }),
  });
}

export function useResendFailedBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost<{ retried: number; succeeded: number; failed: number }>(`/admin/broadcasts/${id}/resend-failed`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "broadcasts"] }),
  });
}

export function useRetryBroadcastRecipient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ broadcastId, deliveryId }: { broadcastId: number; deliveryId: number }) =>
      apiPost<AdminBroadcastDelivery>(`/admin/broadcasts/${broadcastId}/recipients/${deliveryId}/retry`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "broadcasts"] }),
  });
}

export function useSendAdminBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/admin/broadcasts/${id}/send`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "broadcasts"] }),
  });
}

export function useCancelAdminBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/admin/broadcasts/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "broadcasts"] }),
  });
}

export function useDeleteAdminBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/admin/broadcasts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "broadcasts"] }),
  });
}

export function useAudiencePreview() {
  return useMutation({
    mutationFn: (audience: AudienceFilter) =>
      apiPost<{ total: number; withEmail: number; withPhone: number; withPush: number; sample: Array<{ tenantId: number; name: string | null; email: string | null; phone: string | null }> }>(
        "/admin/broadcasts/audience-preview", { audience },
      ),
  });
}

export function useAdminNotificationTemplates() {
  return useQuery({
    queryKey: ["admin", "notification-templates"],
    queryFn: () => apiGet<{ data: AdminNotificationTemplate[] }>("/admin/notification-templates"),
  });
}

export function useCreateAdminNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; slug: string; channel: BroadcastChannel; subject?: string; body: string; variables?: string[] }) =>
      apiPost<AdminNotificationTemplate>("/admin/notification-templates", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "notification-templates"] }),
  });
}

export function useUpdateAdminNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; channel?: BroadcastChannel; subject?: string; body?: string; variables?: string[] }) =>
      apiPut<AdminNotificationTemplate>(`/admin/notification-templates/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "notification-templates"] }),
  });
}

export function useDeleteAdminNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/admin/notification-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "notification-templates"] }),
  });
}

// ─── Admin email (Task #27) ───────────────────────────────────────
export type EmailDriver = "smtp" | "sendgrid" | "mailgun" | "ses" | "resend" | "postmark" | "custom";
export type EmailLogStatus = "queued" | "sent" | "delivered" | "bounced" | "failed";

export interface AdminEmailProvider {
  id: number; name: string; driver: EmailDriver;
  config: Record<string, unknown>;
  fromName: string; fromEmail: string; replyTo: string | null;
  isEnabled: boolean; isDefault: boolean;
  createdAt: string; updatedAt: string;
}
export interface AdminEmailTemplate {
  id: number; key: string; name: string; event: string | null;
  subject: string; body: string; variables: string[];
  isEnabled: boolean; createdAt: string; updatedAt: string;
}
export interface AdminEmailLog {
  id: number; tenantId: number | null; tenantName: string | null;
  recipient: string; templateKey: string | null; templateId: number | null;
  providerId: number | null; providerDriver: EmailDriver | null;
  subject: string | null; status: EmailLogStatus; providerMessageId: string | null;
  error: string | null; retryOf: number | null; sentAt: string | null; createdAt: string;
}

export function useAdminEmailProviders() {
  return useQuery({
    queryKey: ["admin", "email", "providers"],
    queryFn: () => apiGet<{ data: AdminEmailProvider[] }>("/admin/email/providers"),
  });
}
export function useCreateAdminEmailProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AdminEmailProvider>) => apiPost<AdminEmailProvider>("/admin/email/providers", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "providers"] }),
  });
}
export function useUpdateAdminEmailProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<AdminEmailProvider> & { id: number }) =>
      apiPut<AdminEmailProvider>(`/admin/email/providers/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "providers"] }),
  });
}
export function useDeleteAdminEmailProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/admin/email/providers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "providers"] }),
  });
}
export function useSetDefaultAdminEmailProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost<AdminEmailProvider>(`/admin/email/providers/${id}/set-default`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "providers"] }),
  });
}
export function useTestAdminEmailProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to, subject, body }: { id: number; to: string; subject?: string; body?: string }) =>
      apiPost<{ ok: boolean; logId: number; providerMessageId?: string | null }>(`/admin/email/providers/${id}/test`, { to, subject, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "logs"] }),
  });
}

export function useAdminEmailTemplates() {
  return useQuery({
    queryKey: ["admin", "email", "templates"],
    queryFn: () => apiGet<{ data: AdminEmailTemplate[]; defaults: Array<{ key: string; name: string; event: string | null }> }>("/admin/email/templates"),
  });
}
export function useCreateAdminEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AdminEmailTemplate>) => apiPost<AdminEmailTemplate>("/admin/email/templates", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "templates"] }),
  });
}
export function useUpdateAdminEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<AdminEmailTemplate> & { id: number }) =>
      apiPut<AdminEmailTemplate>(`/admin/email/templates/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "templates"] }),
  });
}
export function useDeleteAdminEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/admin/email/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "templates"] }),
  });
}
export function usePreviewAdminEmailTemplate() {
  return useMutation({
    mutationFn: ({ id, sample }: { id: number; sample: Record<string, unknown> }) =>
      apiPost<{ subject: string; html: string; text: string }>(`/admin/email/templates/${id}/preview`, { sample }),
  });
}
export function useTestAdminEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to, sample, providerId }: { id: number; to: string; sample?: Record<string, unknown>; providerId?: number }) =>
      apiPost<{ ok: boolean; logId: number }>(`/admin/email/templates/${id}/test`, { to, sample, providerId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "logs"] }),
  });
}

export interface AdminEmailLogFilters {
  status?: EmailLogStatus | "all";
  provider?: string;
  tenantId?: number | null;
  template?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}
export function useAdminEmailLogs(filters: AdminEmailLogFilters = {}) {
  const qs = new URLSearchParams();
  if (filters.status && filters.status !== "all") qs.set("status", filters.status);
  if (filters.provider && filters.provider !== "all") qs.set("provider", filters.provider);
  if (filters.tenantId) qs.set("tenantId", String(filters.tenantId));
  if (filters.template && filters.template !== "all") qs.set("template", filters.template);
  if (filters.search) qs.set("search", filters.search);
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.limit) qs.set("limit", String(filters.limit));
  if (filters.offset) qs.set("offset", String(filters.offset));
  return useQuery({
    queryKey: ["admin", "email", "logs", filters],
    queryFn: () => apiGet<{ data: AdminEmailLog[]; total: number; limit: number; offset: number }>(`/admin/email/logs?${qs.toString()}`),
    refetchInterval: 15_000,
  });
}
export function useSendAdminEmailAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      templateKey: string;
      audience: "all_tenants" | "tenants" | "single";
      tenantIds?: number[];
      recipient?: string;
      variables?: Record<string, unknown>;
    }) => apiPost<{ templateKey: string; audience: string; total: number; sent: number; failed: number }>("/admin/email/announcements", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "logs"] }),
  });
}
export function useRetryAdminEmailLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost<{ ok: boolean; newLogId?: number }>(`/admin/email/logs/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "logs"] }),
  });
}
export function useBulkRetryAdminEmailLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => apiPost<{ retried: number; succeeded: number; failed: number }>(`/admin/email/logs/retry`, { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "email", "logs"] }),
  });
}

// Devices & Hardware (Task 118)
// ---------------------------------------------------------------------------

export type DeviceType =
  | "thermal_printer" | "kot_printer" | "kitchen_display" | "customer_display"
  | "barcode_scanner" | "qr_scanner" | "cash_drawer" | "biometric"
  | "android_pos" | "tablet_menu" | "self_kiosk" | "token_display"
  | "card_terminal";

export type DeviceStatus = "online" | "offline" | "error" | "pairing";

export interface DeviceRecord {
  id: number;
  restaurantId: number;
  branchId: number | null;
  kitchenId: number | null;
  type: DeviceType;
  name: string;
  status: DeviceStatus;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  appVersion: string | null;
  registrationToken: string | null;
  pairedAt: string | null;
  paperSize: string | null;
  consecutiveErrors: number;
  metadata: Record<string, unknown>;
  assignedUserId: number | null;
  isHandheld: boolean;
  createdAt: string;
  updatedAt: string;
  sync?: { lastSyncAt: string | null; pendingCount: number } | null;
  pairingToken?: string;
}

export interface DeviceLogRecord {
  id: number;
  deviceId: number;
  eventType: string;
  message: string | null;
  metadata: Record<string, unknown>;
  source: string | null;
  createdAt: string;
}

export interface DeviceRoutingRule {
  id?: number;
  deviceId?: number;
  branchId: number | null;
  categoryId: number | null;
  kitchenId: number | null;
  orderType: string | null;
  isDefaultReceipt: boolean;
  priority: number;
}

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  thermal_printer: "Thermal Printer",
  kot_printer: "KOT Printer",
  kitchen_display: "Kitchen Display (KDS)",
  customer_display: "Customer Display",
  barcode_scanner: "Barcode Scanner",
  qr_scanner: "QR Scanner",
  cash_drawer: "Cash Drawer",
  biometric: "Biometric",
  android_pos: "Android POS Terminal",
  tablet_menu: "Tablet Menu",
  self_kiosk: "Self-Service Kiosk",
  token_display: "Token Display",
  card_terminal: "Card Terminal",
};

export const PRINTER_TYPES: DeviceType[] = ["thermal_printer", "kot_printer"];
export const OFFLINE_CAPABLE_TYPES: DeviceType[] = ["android_pos", "tablet_menu", "self_kiosk"];
export const CARD_TERMINAL_TYPES: DeviceType[] = ["card_terminal"];

// ── Terminals (Task #420) ───────────────────────────────────────────────
export type TerminalProviderId = "stripe" | "square" | "clover" | "custom";

export interface TerminalRecord extends DeviceRecord {
  terminal: {
    provider?: TerminalProviderId;
    externalId?: string | null;
    serial?: string | null;
    model?: string | null;
  };
}

export interface TerminalProviderStatus {
  id: TerminalProviderId;
  label: string;
  configured: boolean;
}

export function useTerminals() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["terminals", RESTAURANT_ID],
    queryFn: () => apiGet<TerminalRecord[]>(`/restaurants/${RESTAURANT_ID}/terminals`),
    refetchInterval: 30_000,
  });
}

export function useTerminalProviders() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["terminal-providers", RESTAURANT_ID],
    queryFn: () => apiGet<{ providers: TerminalProviderStatus[] }>(`/restaurants/${RESTAURANT_ID}/terminals/providers`),
  });
}

export function usePairTerminal() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (data: { name: string; provider: TerminalProviderId; externalId?: string | null; branchId?: number | null; serial?: string | null; model?: string | null }) =>
      apiPost<TerminalRecord>(`/restaurants/${RESTAURANT_ID}/terminals/pair`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminals", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["devices", RESTAURANT_ID] });
    },
  });
}

export function useUnpairTerminal() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${RESTAURANT_ID}/terminals/${id}/unpair`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terminals", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["devices", RESTAURANT_ID] });
    },
  });
}

export function useTerminalCharge() {
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (data: { terminalId: number; orderId: number; amountMinor: number; tipMinor?: number; currency?: string }) =>
      apiPost<{ status: string; providerRef: string | null; receiptUrl: string | null; clientSecret: string | null; provider: TerminalProviderId; deviceId: number }>(
        `/restaurants/${RESTAURANT_ID}/terminals/${data.terminalId}/charge`,
        { orderId: data.orderId, amountMinor: data.amountMinor, tipMinor: data.tipMinor, currency: data.currency ?? "inr" },
      ),
  });
}

export function useTerminalRunOnReader() {
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (data: { terminalId: number; providerRef: string }) =>
      apiPost<{ status: string }>(
        `/restaurants/${RESTAURANT_ID}/terminals/${data.terminalId}/run-on-reader`,
        { providerRef: data.providerRef },
      ),
  });
}

export function useTerminalRecentPayments(terminalId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["terminal-recent-payments", RESTAURANT_ID, terminalId],
    enabled: terminalId != null,
    queryFn: () => apiGet<{ data: Array<{
      id: number; amount: string; direction: "in" | "out";
      paymentDate: string; referenceId: number | null;
      terminalRefId: string | null; notes: string | null;
    }> }>(`/restaurants/${RESTAURANT_ID}/terminals/${terminalId}/recent-payments`),
  });
}

export function useConfirmTerminalCharge() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (data: { terminalId: number; orderId: number; providerRef: string; amountMinor: number; tipMinor?: number; receiptUrl?: string | null }) =>
      apiPost<{ payment: { id: number }; receiptUrl: string | null }>(
        `/restaurants/${RESTAURANT_ID}/terminals/${data.terminalId}/confirm`,
        data,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["payments", RESTAURANT_ID] });
    },
  });
}

export function useTerminalRefund() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (data: { terminalId: number; paymentId: number; amountMinor: number; reason?: string }) =>
      apiPost<{ status: string; refund: { id: number } }>(
        `/restaurants/${RESTAURANT_ID}/terminals/${data.terminalId}/refund`,
        { paymentId: data.paymentId, amountMinor: data.amountMinor, reason: data.reason },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["terminal-payments", RESTAURANT_ID] });
    },
  });
}

export function useTerminalPaymentsByDevice(params?: { from?: string; to?: string }) {
  const RESTAURANT_ID = useRestaurantId();
  const search = new URLSearchParams();
  if (params?.from) search.set("from", params.from);
  if (params?.to) search.set("to", params.to);
  const q = search.toString() ? `?${search.toString()}` : "";
  return useQuery({
    queryKey: ["terminal-payments", RESTAURANT_ID, params ?? {}],
    queryFn: () => apiGet<{ data: Array<{ deviceId: number; deviceName: string; provider: string | null; grossIn: string; refundsOut: string; net: string; txCount: number; refundCount: number }> }>(
      `/restaurants/${RESTAURANT_ID}/terminals/payments-by-device${q}`,
    ),
  });
}

export function useDevices(filters?: { branchId?: number | null; type?: DeviceType; status?: DeviceStatus }) {
  const RESTAURANT_ID = useRestaurantId();
  const params = new URLSearchParams();
  if (filters?.branchId != null) params.set("branchId", String(filters.branchId));
  if (filters?.type) params.set("type", filters.type);
  if (filters?.status) params.set("status", filters.status);
  const q = params.toString() ? `?${params.toString()}` : "";
  return useQuery({
    queryKey: ["devices", RESTAURANT_ID, filters ?? {}],
    queryFn: () => apiGet<DeviceRecord[]>(`/restaurants/${RESTAURANT_ID}/devices${q}`),
    refetchInterval: 30_000,
  });
}

export function useDevice(id: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["device", RESTAURANT_ID, id],
    queryFn: () => apiGet<DeviceRecord & { stations: Array<{ kitchenId: number }>; rules: DeviceRoutingRule[] }>(`/restaurants/${RESTAURANT_ID}/devices/${id}`),
    enabled: id != null,
  });
}

export function useDeviceLogs(id: number | null, limit = 100) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["device-logs", RESTAURANT_ID, id, limit],
    queryFn: () => apiGet<DeviceLogRecord[]>(`/restaurants/${RESTAURANT_ID}/devices/${id}/logs?limit=${limit}`),
    enabled: id != null,
    refetchInterval: 15_000,
  });
}

export function useCreateDevice() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (data: { name: string; type: DeviceType; branchId?: number | null; kitchenId?: number | null; paperSize?: string | null; assignedUserId?: number | null; isHandheld?: boolean }) =>
      apiPost<DeviceRecord>(`/restaurants/${RESTAURANT_ID}/devices`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices", RESTAURANT_ID] }),
  });
}

export function useUpdateDevice() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Partial<{ name: string; branchId: number | null; kitchenId: number | null; paperSize: string | null; status: DeviceStatus; metadata: Record<string, unknown>; assignedUserId: number | null; isHandheld: boolean }>) =>
      apiPatch<DeviceRecord>(`/restaurants/${RESTAURANT_ID}/devices/${id}`, data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["devices", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["device", RESTAURANT_ID, vars.id] });
    },
  });
}
export function useDeleteDevice() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/devices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices", RESTAURANT_ID] }),
  });
}

export function useTestPrintDevice() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (id: number) => apiPost<{ queued: boolean; success: boolean }>(`/restaurants/${RESTAURANT_ID}/devices/${id}/test-print`, {}),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["device-logs", RESTAURANT_ID, id] });
      qc.invalidateQueries({ queryKey: ["devices", RESTAURANT_ID] });
    },
  });
}

export function useUpdateDeviceRoutingRules() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: ({ id, rules }: { id: number; rules: DeviceRoutingRule[] }) =>
      apiPut<DeviceRoutingRule[]>(`/restaurants/${RESTAURANT_ID}/devices/${id}/routing-rules`, { rules }),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["device", RESTAURANT_ID, vars.id] }),
  });
}

export function useUpdateDeviceStations() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: ({ id, kitchenIds }: { id: number; kitchenIds: number[] }) =>
      apiPut(`/restaurants/${RESTAURANT_ID}/devices/${id}/station-mappings`, { kitchenIds }),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["device", RESTAURANT_ID, vars.id] }),
  });
}

export function useSyncDevice() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${RESTAURANT_ID}/devices/${id}/sync`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices", RESTAURANT_ID] }),
  });
}

export function useDeviceHeartbeat() {
  const qc = useQueryClient();
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${RESTAURANT_ID}/devices/${id}/heartbeat`, { status: "online" }),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["device", RESTAURANT_ID, id] });
    },
  });
}

export function useEvents(params?: Record<string, unknown>) {
  const RESTAURANT_ID = useRestaurantId();
  const qs = params ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString() : "";
  return useQuery({
    queryKey: ["events", RESTAURANT_ID, params ?? {}],
    queryFn: () => apiGet<unknown[]>(`/restaurants/${RESTAURANT_ID}/events${qs}`),
  });
}

export function useEventDetail(id: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["event-detail", RESTAURANT_ID, id],
    queryFn: () => apiGet<Record<string, unknown>>(`/restaurants/${RESTAURANT_ID}/events/${id}`),
    enabled: !!id,
  });
}

export function useEventCalendar(params?: { from?: string; to?: string }) {
  const RESTAURANT_ID = useRestaurantId();
  const qs = params ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString() : "";
  return useQuery({
    queryKey: ["event-calendar", RESTAURANT_ID, params ?? {}],
    queryFn: () => apiGet<unknown[]>(`/restaurants/${RESTAURANT_ID}/events/calendar${qs}`),
  });
}

export function useCreateEvent() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPost(`/restaurants/${RESTAURANT_ID}/events`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events", RESTAURANT_ID] }),
  });
}

export function useUpdateEvent() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Record<string, unknown>) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/events/${id}`, data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["events", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["event-detail", RESTAURANT_ID, vars.id] });
    },
  });
}

export function useDeleteEvent() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events", RESTAURANT_ID] }),
  });
}

function eventChildHook<T>(child: string, method: "post" | "delete" | "patch") {
  return function () {
    const RESTAURANT_ID = useRestaurantId();
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (vars: { eventId: number; childId?: number } & Record<string, unknown>) => {
        const { eventId, childId, ...data } = vars;
        const path = childId
          ? `/restaurants/${RESTAURANT_ID}/events/${eventId}/${child}/${childId}`
          : `/restaurants/${RESTAURANT_ID}/events/${eventId}/${child}`;
        if (method === "post") return apiPost<T>(path, data);
        if (method === "patch") return apiPatch<T>(path, data);
        return apiDelete(path) as unknown as Promise<T>;
      },
      onSuccess: (_d, vars) => {
        qc.invalidateQueries({ queryKey: ["event-detail", RESTAURANT_ID, vars.eventId] });
      },
    });
  };
}

export const useCreateEventItem = eventChildHook<unknown>("items", "post");
export const useDeleteEventItem = eventChildHook<unknown>("items", "delete");
export const useCreateEventPayment = eventChildHook<unknown>("payments", "post");
export const useUpdateEventPayment = eventChildHook<unknown>("payments", "patch");
export const useDeleteEventPayment = eventChildHook<unknown>("payments", "delete");
export const useCreateEventStaff = eventChildHook<unknown>("staff", "post");
export const useDeleteEventStaff = eventChildHook<unknown>("staff", "delete");
export const useCreateEventVendor = eventChildHook<unknown>("vendors", "post");
export const useDeleteEventVendor = eventChildHook<unknown>("vendors", "delete");
export const useCreateEventChecklistItem = eventChildHook<unknown>("checklist", "post");
export const useToggleEventChecklistItem = eventChildHook<unknown>("checklist", "patch");
export const useDeleteEventChecklistItem = eventChildHook<unknown>("checklist", "delete");

export function useEventStatusTransition() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/events/${id}/status`, { status }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["events", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["event-detail", RESTAURANT_ID, vars.id] });
    },
  });
}

export function useConvertEventToInvoice() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiPost<{ orderNumber: string; invoiceOrderId: number }>(
        `/restaurants/${RESTAURANT_ID}/events/${id}/convert-to-invoice`, {}
      ),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["events", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["event-detail", RESTAURANT_ID, id] });
    },
  });
}

// ===== Hotel Mode =====================================================

export function useToggleHotelMode() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/hotel-mode`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["restaurant", RESTAURANT_ID] }),
  });
}

export function useHotelGuests(q?: string) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["hotel-guests", RESTAURANT_ID, q ?? ""],
    queryFn: () => apiGet<import("./types").HotelGuest[]>(
      `/restaurants/${RESTAURANT_ID}/hotel/guests${q ? `?q=${encodeURIComponent(q)}` : ""}`
    ),
  });
}

export function useCreateHotelGuest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<import("./types").HotelGuest>) =>
      apiPost<import("./types").HotelGuest>(`/restaurants/${RESTAURANT_ID}/hotel/guests`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hotel-guests", RESTAURANT_ID] }),
  });
}

export function useHotelStays(status: string = "in_house") {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["hotel-stays", RESTAURANT_ID, status],
    queryFn: () => apiGet<import("./types").HotelStay[]>(
      `/restaurants/${RESTAURANT_ID}/hotel/stays?status=${encodeURIComponent(status)}`
    ),
  });
}

export function useHotelStay(stayId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["hotel-stay", RESTAURANT_ID, stayId],
    queryFn: () => apiGet<import("./types").HotelStay & {
      folio: import("./types").HotelFolio;
      lines: import("./types").HotelFolioLine[];
      package: import("./types").HotelPackage | null;
      packageUsedToday: number;
    }>(`/restaurants/${RESTAURANT_ID}/hotel/stays/${stayId}`),
    enabled: !!stayId,
  });
}

export function useCreateHotelStay() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { guestId: number; roomNumber: string; partySize?: number; packageId?: number; notes?: string }) =>
      apiPost<import("./types").HotelStay>(`/restaurants/${RESTAURANT_ID}/hotel/stays`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hotel-stays", RESTAURANT_ID] }),
  });
}

export function useHotelPackages() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["hotel-packages", RESTAURANT_ID],
    queryFn: () => apiGet<import("./types").HotelPackage[]>(`/restaurants/${RESTAURANT_ID}/hotel/packages`),
  });
}

export function useCreateHotelPackage() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<import("./types").HotelPackage>) =>
      apiPost<import("./types").HotelPackage>(`/restaurants/${RESTAURANT_ID}/hotel/packages`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hotel-packages", RESTAURANT_ID] }),
  });
}

export function useAddFolioLine() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ folioId, ...data }: { folioId: number; kind: string; description: string; amount: number; source?: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/hotel/folios/${folioId}/lines`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hotel-stay"] });
      qc.invalidateQueries({ queryKey: ["hotel-stays", RESTAURANT_ID] });
    },
  });
}

export function useCloseFolio() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ folioId, splits }: { folioId: number; splits: Array<{ method: string; amount: number; notes?: string }> }) =>
      apiPost<{ folioId: number; invoiceNumber: string; balance: number }>(
        `/restaurants/${RESTAURANT_ID}/hotel/folios/${folioId}/close`, { splits }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hotel-stay"] });
      qc.invalidateQueries({ queryKey: ["hotel-stays", RESTAURANT_ID] });
    },
  });
}

export function usePostMinibar() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { stayId: number; itemName: string; quantity: number; unitPrice: number; notes?: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/hotel/minibar`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hotel-stay"] });
      qc.invalidateQueries({ queryKey: ["hotel-minibar", RESTAURANT_ID] });
    },
  });
}

export function useMinibarPostings() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["hotel-minibar", RESTAURANT_ID],
    queryFn: () => apiGet<Array<{ id: number; itemName: string; quantity: number; unitPrice: string; totalAmount: string; createdAt: string; stayId: number }>>(
      `/restaurants/${RESTAURANT_ID}/hotel/minibar`
    ),
  });
}

export function useHousekeepingRequests() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["hotel-housekeeping", RESTAURANT_ID],
    queryFn: () => apiGet<Array<{ id: number; stayId: number; description: string; orderId: number | null; createdAt: string; status: string }>>(
      `/restaurants/${RESTAURANT_ID}/hotel/housekeeping-requests`
    ),
  });
}

export function useCreateHousekeepingRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { stayId: number; description: string; items?: Array<{ menuItemId: number; quantity: number; notes?: string }>; notes?: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/hotel/housekeeping-requests`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hotel-housekeeping", RESTAURANT_ID] }),
  });
}

export function useBanquetEvents() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["hotel-banquet", RESTAURANT_ID],
    queryFn: () => apiGet<import("./types").HotelBanquetEvent[]>(`/restaurants/${RESTAURANT_ID}/hotel/banquet-events`),
  });
}

export function useCreateBanquetEvent() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<import("./types").HotelBanquetEvent>) =>
      apiPost<import("./types").HotelBanquetEvent>(`/restaurants/${RESTAURANT_ID}/hotel/banquet-events`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hotel-banquet", RESTAURANT_ID] }),
  });
}

export function useCloseBanquetEvent() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, rollToHostFolio }: { eventId: number; rollToHostFolio?: boolean }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/hotel/banquet-events/${eventId}/close`, { rollToHostFolio: !!rollToHostFolio }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hotel-banquet", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["hotel-stays", RESTAURANT_ID] });
    },
  });
}

// ---------------------- Waste Management ----------------------
export function useWasteReasons() {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["waste-reasons", rid],
    queryFn: () => apiGet<import("./types").WasteReason[]>(`/restaurants/${rid}/waste/reasons`),
  });
}

export function useCreateWasteReason() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { label: string; sortOrder?: number }) =>
      apiPost(`/restaurants/${rid}/waste/reasons`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waste-reasons"] }),
  });
}

export function useUpdateWasteReason() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; label?: string; isActive?: boolean; sortOrder?: number }) =>
      apiPatch(`/restaurants/${rid}/waste/reasons/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waste-reasons"] }),
  });
}

export function useWasteSettings() {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["waste-settings", rid],
    queryFn: () => apiGet<import("./types").WasteSettings>(`/restaurants/${rid}/waste/settings`),
  });
}

export function useUpdateWasteSettings() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { approvalThreshold?: string | number; autoApproveBelowThreshold?: boolean }) =>
      apiPatch(`/restaurants/${rid}/waste/settings`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waste-settings"] }),
  });
}

export function useWasteEntries(params?: { status?: string; from?: string; to?: string; itemId?: number; wasteType?: string }) {
  const rid = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  if (params?.itemId) q.set("itemId", String(params.itemId));
  if (params?.wasteType) q.set("wasteType", params.wasteType);
  return useQuery({
    queryKey: ["waste-entries", rid, params],
    queryFn: () => apiGet<import("./types").WasteEntry[]>(`/restaurants/${rid}/waste/entries?${q}`),
  });
}

function invalidateAllWaste(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["waste-entries"] });
  qc.invalidateQueries({ queryKey: ["waste-summary"] });
  qc.invalidateQueries({ queryKey: ["waste-by-reason"] });
  qc.invalidateQueries({ queryKey: ["waste-by-staff"] });
  qc.invalidateQueries({ queryKey: ["waste-by-item"] });
  qc.invalidateQueries({ queryKey: ["waste-dashboard-tile"] });
  qc.invalidateQueries({ queryKey: ["inventory"] });
}

export function useCreateWasteEntry() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: import("./types").CreateWasteEntryInput) =>
      apiPost<import("./types").WasteEntry>(`/restaurants/${rid}/waste/entries`, data),
    onSuccess: () => invalidateAllWaste(qc),
  });
}

export function useUpdateWasteEntry() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Partial<import("./types").CreateWasteEntryInput>) =>
      apiPatch<import("./types").WasteEntry>(`/restaurants/${rid}/waste/entries/${id}`, data),
    onSuccess: () => invalidateAllWaste(qc),
  });
}

export function useApproveWasteEntry() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${rid}/waste/entries/${id}/approve`, {}),
    onSuccess: () => invalidateAllWaste(qc),
  });
}

export function useRejectWasteEntry() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rejectionNote }: { id: number; rejectionNote?: string }) =>
      apiPost(`/restaurants/${rid}/waste/entries/${id}/reject`, { rejectionNote }),
    onSuccess: () => invalidateAllWaste(qc),
  });
}

export function useDonateWasteEntry() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; donationRecipient: string; donationPickupAt?: string; donationNote?: string }) =>
      apiPost(`/restaurants/${rid}/waste/entries/${id}/donate`, data),
    onSuccess: () => invalidateAllWaste(qc),
  });
}

export function useWasteSummary(params?: { from?: string; to?: string }) {
  const rid = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  return useQuery({
    queryKey: ["waste-summary", rid, params],
    queryFn: () => apiGet<import("./types").WasteReportSummary>(`/restaurants/${rid}/waste/reports/summary?${q}`),
  });
}

export function useWasteByReason(params?: { from?: string; to?: string }) {
  const rid = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  return useQuery({
    queryKey: ["waste-by-reason", rid, params],
    queryFn: () => apiGet<import("./types").WasteByReason[]>(`/restaurants/${rid}/waste/reports/by-reason?${q}`),
  });
}

export function useWasteByStaff(params?: { from?: string; to?: string }) {
  const rid = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  return useQuery({
    queryKey: ["waste-by-staff", rid, params],
    queryFn: () => apiGet<import("./types").WasteByStaff[]>(`/restaurants/${rid}/waste/reports/by-staff?${q}`),
  });
}

export function useWasteByItem(params?: { from?: string; to?: string }) {
  const rid = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  return useQuery({
    queryKey: ["waste-by-item", rid, params],
    queryFn: () => apiGet<import("./types").WasteByItem[]>(`/restaurants/${rid}/waste/reports/by-item?${q}`),
  });
}

export function useWasteDashboardTile() {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["waste-dashboard-tile", rid],
    queryFn: () => apiGet<import("./types").WasteDashboardTile>(`/restaurants/${rid}/waste/dashboard-tile`),
    refetchInterval: 60_000,
  });
}

// ---------- Staff incentives (Task #199) ----------
export function useStaffIncentiveRules() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery<StaffIncentiveRule[]>({
    queryKey: ["staff-incentive-rules", RESTAURANT_ID],
    queryFn: () => apiGet(`/restaurants/${RESTAURANT_ID}/staff-incentive-rules`),
  });
}

export function useUpdateStaffIncentiveRule() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ruleType: string; enabled: boolean; params: Record<string, unknown>; monthlyCap: string | null }) =>
      apiPut(`/restaurants/${RESTAURANT_ID}/staff-incentive-rules/${input.ruleType}`, {
        enabled: input.enabled, params: input.params, monthlyCap: input.monthlyCap,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-incentive-rules", RESTAURANT_ID] });
    },
  });
}

export function useStaffIncentives(year: number, month: number, status?: string) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery<StaffIncentive[]>({
    queryKey: ["staff-incentives", RESTAURANT_ID, year, month, status ?? null],
    queryFn: () => {
      const qs = new URLSearchParams({ year: String(year), month: String(month) });
      if (status) qs.set("status", status);
      return apiGet(`/restaurants/${RESTAURANT_ID}/staff-incentives?${qs}`);
    },
  });
}

export function useRecomputeStaffIncentives() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { year: number; month: number }) =>
      apiPost<{ count: number }>(`/restaurants/${RESTAURANT_ID}/staff-incentives/recompute`, {
        periodYear: input.year, periodMonth: input.month,
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["staff-incentives", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["staff-incentive-leaderboard", RESTAURANT_ID, v.year, v.month] });
    },
  });
}

export function useDecideStaffIncentive() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; decision: "approve" | "reject"; approvedAmount?: string; notes?: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/staff-incentives/${input.id}/decide`, {
        decision: input.decision,
        approvedAmount: input.approvedAmount,
        notes: input.notes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-incentives", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["staff-incentive-leaderboard", RESTAURANT_ID] });
    },
  });
}

export function useApproveAllStaffIncentives() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { year: number; month: number }) =>
      apiPost<{ approved: number }>(`/restaurants/${RESTAURANT_ID}/staff-incentives/approve-all`, {
        periodYear: input.year, periodMonth: input.month,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-incentives", RESTAURANT_ID] });
      qc.invalidateQueries({ queryKey: ["staff-incentive-leaderboard", RESTAURANT_ID] });
    },
  });
}

export function useStaffIncentiveLeaderboard(year: number, month: number) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery<StaffIncentiveLeaderboardRow[]>({
    queryKey: ["staff-incentive-leaderboard", RESTAURANT_ID, year, month],
    queryFn: () => apiGet(`/restaurants/${RESTAURANT_ID}/staff-incentives/leaderboard?year=${year}&month=${month}`),
  });
}

export function staffIncentiveCsvUrl(restaurantId: number, year: number, month: number): string {
  return `/api/restaurants/${restaurantId}/staff-incentives/report.csv?year=${year}&month=${month}`;
}

// ────────────────────────────────────────────────────────────────
// Inventory Control pack (Task #369)
// ────────────────────────────────────────────────────────────────

export interface KindItem {
  id: number; restaurantId: number; name: string; unit: string;
  currentStock: string; minStockLevel: string; parLevel: string | null;
  reorderQuantity: string | null; costPerUnit: string; category: string | null;
  kind: string; isActive: boolean; supplierId: number | null;
}
export interface KindRecipe {
  id: number; menuItemId: number; menuItemName: string | null;
  inventoryItemId: number; inventoryItemName: string | null;
  quantity: string; unit: string; kind: string; costPerUnit: string | null;
}
export interface PortionDriftEvent {
  id: number; inventoryItemId: number; inventoryItemName: string | null; inventoryUnit: string | null;
  periodStart: string; periodEnd: string; expectedQuantity: string; actualQuantity: string;
  driftPct: string; severity: string; status: string; notes: string | null;
  createdAt: string; acknowledgedAt: string | null;
}
export interface RecipeVersionRow {
  id: number; menuItemId: number; menuItemName: string | null;
  versionNumber: number; status: string; isActive: boolean; totalCost: string;
  notes: string | null; createdBy: number | null; approvedBy: number | null;
  approvedAt: string | null; activatedAt: string | null; createdAt: string;
}
export interface RecipeVersionDetail extends RecipeVersionRow {
  lines: Array<{
    id: number; inventoryItemId: number; inventoryItemName: string | null;
    inventoryUnit: string | null; quantity: string; unit: string; costAtSnapshot: string;
  }>;
}
export interface TasteTestNote {
  id: number; menuItemId: number; menuItemName: string | null; recipeVersionId: number | null;
  tasterId: number | null; tasterName: string | null; rating: number;
  appearance: number | null; aroma: number | null; taste: number | null; texture: number | null; temperature: number | null;
  notes: string | null; correctiveActions: string | null;
  status: string; approvedBy: number | null; approvedAt: string | null; rejectedReason: string | null;
  createdAt: string;
}

function useKindItems(kind: "packaging" | "condiment") {
  const RID = useRestaurantId();
  return useQuery<KindItem[]>({
    queryKey: [`${kind}-items`, RID],
    queryFn: () => apiGet(`/restaurants/${RID}/${kind}-items`),
  });
}
function useCreateKindItem(kind: "packaging" | "condiment") {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<KindItem>) => apiPost(`/restaurants/${RID}/${kind}-items`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`${kind}-items`] }),
  });
}
function useUpdateKindItem(kind: "packaging" | "condiment") {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<KindItem> & { id: number }) =>
      apiPatch(`/restaurants/${RID}/${kind}-items/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`${kind}-items`] }),
  });
}
function useDeleteKindItem(kind: "packaging" | "condiment") {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RID}/${kind}-items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`${kind}-items`] }),
  });
}
function useAdjustKindItem(kind: "packaging" | "condiment") {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, delta, reason }: { id: number; delta: number; reason?: string }) =>
      apiPost(`/restaurants/${RID}/${kind}-items/${id}/adjust`, { delta, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`${kind}-items`] }),
  });
}
function useKindRecipes(kind: "packaging" | "condiment") {
  const RID = useRestaurantId();
  return useQuery<KindRecipe[]>({
    queryKey: [`${kind}-recipes`, RID],
    queryFn: () => apiGet(`/restaurants/${RID}/${kind}-recipes`),
  });
}
function useCreateKindRecipe(kind: "packaging" | "condiment") {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { menuItemId: number; inventoryItemId: number; quantity: number | string; unit?: string }) =>
      apiPost(`/restaurants/${RID}/${kind}-recipes`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`${kind}-recipes`] }),
  });
}
function useDeleteKindRecipe(kind: "packaging" | "condiment") {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RID}/${kind}-recipes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`${kind}-recipes`] }),
  });
}

export const usePackagingItems = () => useKindItems("packaging");
export const useCreatePackagingItem = () => useCreateKindItem("packaging");
export const useUpdatePackagingItem = () => useUpdateKindItem("packaging");
export const useDeletePackagingItem = () => useDeleteKindItem("packaging");
export const useAdjustPackagingItem = () => useAdjustKindItem("packaging");
export const usePackagingRecipes = () => useKindRecipes("packaging");
export const useCreatePackagingRecipe = () => useCreateKindRecipe("packaging");
export const useDeletePackagingRecipe = () => useDeleteKindRecipe("packaging");

export const useCondimentItems = () => useKindItems("condiment");
export const useCreateCondimentItem = () => useCreateKindItem("condiment");
export const useUpdateCondimentItem = () => useUpdateKindItem("condiment");
export const useDeleteCondimentItem = () => useDeleteKindItem("condiment");
export const useAdjustCondimentItem = () => useAdjustKindItem("condiment");
export const useCondimentRecipes = () => useKindRecipes("condiment");
export const useCreateCondimentRecipe = () => useCreateKindRecipe("condiment");
export const useDeleteCondimentRecipe = () => useDeleteKindRecipe("condiment");

export function usePortionDriftEvents(filters?: { status?: string; severity?: string }) {
  const RID = useRestaurantId();
  const q = new URLSearchParams();
  if (filters?.status) q.set("status", filters.status);
  if (filters?.severity) q.set("severity", filters.severity);
  return useQuery<PortionDriftEvent[]>({
    queryKey: ["portion-drift", RID, filters],
    queryFn: () => apiGet(`/restaurants/${RID}/portion-drift?${q.toString()}`),
  });
}
export function useAcknowledgePortionDrift() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes, resolved }: { id: number; notes?: string; resolved?: boolean }) =>
      apiPost(`/restaurants/${RID}/portion-drift/${id}/ack`, { notes, resolved }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portion-drift"] }),
  });
}
export function useRunPortionDriftSweep() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (days?: number) => apiPost(`/restaurants/${RID}/portion-drift/run`, { days: days ?? 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portion-drift"] }),
  });
}

export function useRecipeVersions(menuItemId?: number) {
  const RID = useRestaurantId();
  const q = menuItemId ? `?menuItemId=${menuItemId}` : "";
  return useQuery<RecipeVersionRow[]>({
    queryKey: ["recipe-versions", RID, menuItemId ?? null],
    queryFn: () => apiGet(`/restaurants/${RID}/recipe-versions${q}`),
  });
}
export function useRecipeVersionDetail(id: number | null) {
  const RID = useRestaurantId();
  return useQuery<RecipeVersionDetail>({
    queryKey: ["recipe-version-detail", RID, id],
    queryFn: () => apiGet(`/restaurants/${RID}/recipe-versions/${id}`),
    enabled: !!id,
  });
}
export function useCreateRecipeVersion() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { menuItemId: number; notes?: string; lines?: Array<{ inventoryItemId: number; quantity: string | number; unit?: string }> }) =>
      apiPost(`/restaurants/${RID}/recipe-versions`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipe-versions"] }),
  });
}
export function useUpdateRecipeVersion() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; notes?: string; lines?: Array<{ inventoryItemId: number; quantity: string | number; unit?: string }> }) =>
      apiPatch(`/restaurants/${RID}/recipe-versions/${id}`, data),
    onSuccess: (_d, v) => { const qc2 = qc; qc2.invalidateQueries({ queryKey: ["recipe-versions"] }); qc2.invalidateQueries({ queryKey: ["recipe-version-detail", RID, v.id] }); },
  });
}
export function useRecipeVersionAction() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: number; action: "submit" | "approve" | "reject" | "activate" | "rollback"; reason?: string }) =>
      apiPost(`/restaurants/${RID}/recipe-versions/${id}/${action}`, reason ? { reason } : {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recipe-versions"] }); qc.invalidateQueries({ queryKey: ["recipe-version-detail"] }); qc.invalidateQueries({ queryKey: ["recipe-mappings"] }); },
  });
}

export function useTasteTests(filters?: { status?: string; menuItemId?: number }) {
  const RID = useRestaurantId();
  const q = new URLSearchParams();
  if (filters?.status) q.set("status", filters.status);
  if (filters?.menuItemId) q.set("menuItemId", String(filters.menuItemId));
  return useQuery<TasteTestNote[]>({
    queryKey: ["taste-tests", RID, filters],
    queryFn: () => apiGet(`/restaurants/${RID}/taste-tests?${q.toString()}`),
  });
}
export function useCreateTasteTest() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<TasteTestNote>) => apiPost(`/restaurants/${RID}/taste-tests`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taste-tests"] }),
  });
}
export function useTasteTestAction() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: number; action: "approve" | "reject"; reason?: string }) =>
      apiPost(`/restaurants/${RID}/taste-tests/${id}/${action}`, reason ? { reason } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taste-tests"] }),
  });
}
export function useDeleteTasteTest() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RID}/taste-tests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taste-tests"] }),
  });
}

// ─── Vendor Invoice OCR (Task #427) ───────────────────────────────────────────

export type VendorInvoiceLine = {
  id: number;
  vendorInvoiceId: number;
  lineNumber: number;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  matchedInventoryItemId: number | null;
  matchedPoItemId: number | null;
  priceVariancePct: string | null;
  confidence: string;
  createdAt: string;
};
export type VendorInvoice = {
  id: number;
  restaurantId: number;
  supplierId: number | null;
  purchaseOrderId: number | null;
  expenseId: number | null;
  status: "draft" | "matched" | "approved" | "rejected";
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  vendorName: string | null;
  totalAmount: string;
  taxAmount: string;
  currency: string;
  uploadObjectPath: string;
  uploadMimeType: string | null;
  extractedData: Record<string, unknown>;
  confidenceScores: Record<string, number>;
  hasPriceVariance: "true" | "false";
  rejectionReason: string | null;
  notes: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function useVendorInvoices(status?: string) {
  const RID = useRestaurantId();
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return useQuery({
    queryKey: ["vendor-invoices", RID, status ?? "all"],
    queryFn: () => apiGet<VendorInvoice[]>(`/restaurants/${RID}/vendor-invoices${qs}`),
  });
}
export function useVendorInvoice(id: number | null) {
  const RID = useRestaurantId();
  return useQuery({
    queryKey: ["vendor-invoice", RID, id],
    queryFn: () => apiGet<{ invoice: VendorInvoice; lines: VendorInvoiceLine[] }>(`/restaurants/${RID}/vendor-invoices/${id}`),
    enabled: id != null,
  });
}
export function useUploadVendorInvoice() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { objectPath: string; purchaseOrderId?: number; pageCountHint?: number; notes?: string }) =>
      apiPost<{ id: number; hasPriceVariance: boolean; pages: number }>(`/restaurants/${RID}/vendor-invoices/upload`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendor-invoices"] }),
  });
}
export function useCorrectVendorInvoice() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      apiPatch<VendorInvoice>(`/restaurants/${RID}/vendor-invoices/${id}/correct`, body),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["vendor-invoices"] });
      qc.invalidateQueries({ queryKey: ["vendor-invoice", RID, v.id] });
    },
  });
}
export function useMatchVendorInvoicePo() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, purchaseOrderId }: { id: number; purchaseOrderId: number | null }) =>
      apiPost<VendorInvoice>(`/restaurants/${RID}/vendor-invoices/${id}/match-po`, { purchaseOrderId }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["vendor-invoices"] });
      qc.invalidateQueries({ queryKey: ["vendor-invoice", RID, v.id] });
    },
  });
}
export function useApproveVendorInvoice() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expenseCategoryId, paymentMethod }: { id: number; expenseCategoryId: number; paymentMethod?: string }) =>
      apiPost<{ id: number; expenseId: number; status: string }>(`/restaurants/${RID}/vendor-invoices/${id}/approve`, { expenseCategoryId, paymentMethod }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor-invoices"] });
      qc.invalidateQueries({ queryKey: ["vendor-invoice"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}
export function useRejectVendorInvoice() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiPost<{ id: number; status: string }>(`/restaurants/${RID}/vendor-invoices/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor-invoices"] });
      qc.invalidateQueries({ queryKey: ["vendor-invoice"] });
    },
  });
}
export function useDeleteVendorInvoice() {
  const RID = useRestaurantId(); const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RID}/vendor-invoices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendor-invoices"] }),
  });
}

// ─── Email Center: Sequences, Automations, Marketing Templates, Suppressions, etc. (Task #414) ───
export interface EmailSequenceRow { id: number; key: string; name: string; description: string; trigger: string; isEnabled: boolean; stopRules: Array<{ type: string; value?: unknown }>; createdAt: string; updatedAt: string; }
export interface EmailSequenceStepRow { id: number; sequenceId: number; position: number; delayHours: number; templateKey: string; conditionJson: Record<string, unknown> | null; isEnabled: boolean; label: string; }
export interface EmailSequenceEnrollmentRow { id: number; sequenceId: number; tenantId: number | null; recipientEmail: string; recipientName: string | null; currentStep: number; status: string; stopReason: string | null; nextRunAt: string; lastRunAt: string | null; enrolledAt: string; completedAt: string | null; }
export function useAdminEmailSequences() { return useQuery({ queryKey: ["admin","email","sequences"], queryFn: () => apiGet<{ data: EmailSequenceRow[] }>("/admin/email/sequences") }); }
export function useAdminEmailSequence(id: number | null) { return useQuery({ queryKey: ["admin","email","sequences", id], queryFn: () => apiGet<{ data: EmailSequenceRow & { steps: EmailSequenceStepRow[] } }>(`/admin/email/sequences/${id}`), enabled: !!id }); }
export function useCreateAdminEmailSequence() { const qc = useQueryClient(); return useMutation({ mutationFn: (b: Partial<EmailSequenceRow>) => apiPost<EmailSequenceRow>("/admin/email/sequences", b), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","sequences"] }) }); }
export function useUpdateAdminEmailSequence() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<EmailSequenceRow> & { id: number }) => apiPut<EmailSequenceRow>(`/admin/email/sequences/${id}`, b), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","sequences"] }) }); }
export function useDeleteAdminEmailSequence() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: number) => apiDelete(`/admin/email/sequences/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","sequences"] }) }); }
export function useAddAdminEmailSequenceStep() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<EmailSequenceStepRow> & { id: number }) => apiPost<EmailSequenceStepRow>(`/admin/email/sequences/${id}/steps`, b), onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["admin","email","sequences", v.id] }) }); }
export function useUpdateAdminEmailSequenceStep() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ stepId, ...b }: Partial<EmailSequenceStepRow> & { stepId: number }) => apiPut<EmailSequenceStepRow>(`/admin/email/sequence-steps/${stepId}`, b), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","sequences"] }) }); }
export function useDeleteAdminEmailSequenceStep() { const qc = useQueryClient(); return useMutation({ mutationFn: (stepId: number) => apiDelete(`/admin/email/sequence-steps/${stepId}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","sequences"] }) }); }
export function useAdminEmailSequenceEnrollments(id: number | null) { return useQuery({ queryKey: ["admin","email","sequences", id, "enrollments"], queryFn: () => apiGet<{ data: EmailSequenceEnrollmentRow[] }>(`/admin/email/sequences/${id}/enrollments`), enabled: !!id }); }
export function useRunAdminEmailSequenceTick() { const qc = useQueryClient(); return useMutation({ mutationFn: () => apiPost<{ ok: boolean }>("/admin/email/sequences/run-tick-now"), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email"] }) }); }

export interface EmailAutomationRow { id: number; name: string; description: string; trigger: string; conditionJson: Record<string, unknown>; actions: Array<{ type: string; params?: Record<string, unknown> }>; isEnabled: boolean; runCount: number; lastRunAt: string | null; createdAt: string; updatedAt: string; }
export interface EmailAutomationRunRow { id: number; automationId: number; trigger: string; context: Record<string, unknown>; matched: boolean; actionsRun: number; status: string; error: string | null; createdAt: string; }
export function useAdminEmailAutomations() { return useQuery({ queryKey: ["admin","email","automations"], queryFn: () => apiGet<{ data: EmailAutomationRow[] }>("/admin/email/automations") }); }
export function useCreateAdminEmailAutomation() { const qc = useQueryClient(); return useMutation({ mutationFn: (b: Partial<EmailAutomationRow>) => apiPost<EmailAutomationRow>("/admin/email/automations", b), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","automations"] }) }); }
export function useUpdateAdminEmailAutomation() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<EmailAutomationRow> & { id: number }) => apiPut<EmailAutomationRow>(`/admin/email/automations/${id}`, b), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","automations"] }) }); }
export function useDeleteAdminEmailAutomation() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: number) => apiDelete(`/admin/email/automations/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","automations"] }) }); }
export function useAdminEmailAutomationRuns(id: number | null) { return useQuery({ queryKey: ["admin","email","automations", id, "runs"], queryFn: () => apiGet<{ data: EmailAutomationRunRow[] }>(`/admin/email/automations/${id}/runs`), enabled: !!id }); }
export function useTestAdminEmailAutomation() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, context }: { id: number; context: Record<string, unknown> }) => apiPost<{ matched: boolean; actionsRun: number; status: string }>(`/admin/email/automations/${id}/test`, { context }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","automations"] }) }); }

export interface EmailMarketingTemplateRow { id: number; key: string; name: string; category: string; subject: string; preheader: string; body: string; ctaLabel: string | null; ctaUrl: string | null; brandColor: string; businessTypes: string[]; planRestrictions: number[]; isGlobal: boolean; isHidden: boolean; isAiGenerated: boolean; createdAt: string; updatedAt: string; }
export function useAdminEmailMarketingTemplates(category?: string) { return useQuery({ queryKey: ["admin","email","marketing-templates", category ?? "all"], queryFn: () => apiGet<{ data: EmailMarketingTemplateRow[] }>(`/admin/email/marketing-templates${category ? `?category=${encodeURIComponent(category)}` : ""}`) }); }
export function useCreateAdminEmailMarketingTemplate() { const qc = useQueryClient(); return useMutation({ mutationFn: (b: Partial<EmailMarketingTemplateRow>) => apiPost<EmailMarketingTemplateRow>("/admin/email/marketing-templates", b), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","marketing-templates"] }) }); }
export function useUpdateAdminEmailMarketingTemplate() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<EmailMarketingTemplateRow> & { id: number }) => apiPut<EmailMarketingTemplateRow>(`/admin/email/marketing-templates/${id}`, b), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","marketing-templates"] }) }); }
export function useDeleteAdminEmailMarketingTemplate() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: number) => apiDelete(`/admin/email/marketing-templates/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","marketing-templates"] }) }); }

export interface EmailSuppressionRow { id: number; email: string; scope: string; reason: string; source: string | null; tenantId: number | null; restaurantId: number | null; notes: string | null; createdAt: string; }
export function useAdminEmailSuppressions(search?: string) { return useQuery({ queryKey: ["admin","email","suppressions", search ?? ""], queryFn: () => apiGet<{ data: EmailSuppressionRow[] }>(`/admin/email/suppressions${search ? `?search=${encodeURIComponent(search)}` : ""}`) }); }
export function useCreateAdminEmailSuppression() { const qc = useQueryClient(); return useMutation({ mutationFn: (b: Partial<EmailSuppressionRow>) => apiPost<EmailSuppressionRow>("/admin/email/suppressions", b), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","suppressions"] }) }); }
export function useDeleteAdminEmailSuppression() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: number) => apiDelete(`/admin/email/suppressions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","suppressions"] }) }); }

export interface EmailUnsubscribeRow { id: number; email: string; restaurantId: number | null; scope: string; reason: string | null; source: string; createdAt: string; }
export function useAdminEmailUnsubscribes() { return useQuery({ queryKey: ["admin","email","unsubscribes"], queryFn: () => apiGet<{ data: EmailUnsubscribeRow[] }>("/admin/email/unsubscribes") }); }

export interface EmailTemplateVariableRow { id: number; domain: string; name: string; description: string; example: string; }
export function useAdminEmailVariables() { return useQuery({ queryKey: ["admin","email","variables"], queryFn: () => apiGet<{ data: EmailTemplateVariableRow[] }>("/admin/email/variables") }); }
// Variables registry is read-only per Task #414 spec — no create/delete hooks.

export function useGenerateAdminEmailAi() { return useMutation({ mutationFn: (b: { action: "compose" | "rewrite" | "subject_lines" | "shorten" | "expand"; prompt?: string; subject?: string; body?: string; tone?: string; audience?: string; brandName?: string; language?: string }) => apiPost<{ subject: string; preheader: string; body: string; subjectVariants?: string[]; provider?: string; model?: string }>("/admin/email/ai/generate", b) }); }

export interface EmailTemplateVersionRow { id: number; templateId: number; versionNumber: number; subject: string; preheader: string; body: string; plainText: string; ctaLabel: string | null; ctaUrl: string | null; changedBy: number | null; createdAt: string; }
export function useAdminEmailTemplateVersions(id: number | null) { return useQuery({ queryKey: ["admin","email","templates", id, "versions"], queryFn: () => apiGet<{ data: EmailTemplateVersionRow[] }>(`/admin/email/templates/${id}/versions`), enabled: !!id }); }
export function useSaveAdminEmailTemplateVersion() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: number) => apiPost<EmailTemplateVersionRow>(`/admin/email/templates/${id}/versions`), onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: ["admin","email","templates", id, "versions"] }) }); }
export function useRollbackAdminEmailTemplate() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, versionId }: { id: number; versionId: number }) => apiPost(`/admin/email/templates/${id}/rollback/${versionId}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin","email","templates"] }) }); }

export interface EmailDashboardData { counts: { total30: number; sent30: number; failed30: number; opens30: number; clicks30: number; since7Total: number; activeSequences: number; activeAutomations: number; enrollments: number; unsubs30: number }; byDay: Array<{ day: string; sent: number; failed: number; opened: number; clicked: number }>; topTemplates: Array<{ templateKey: string | null; sent: number; opened: number }>; }
export function useAdminEmailDashboard() { return useQuery({ queryKey: ["admin","email","dashboard"], queryFn: () => apiGet<EmailDashboardData>("/admin/email/dashboard"), refetchInterval: 30_000 }); }
export interface AdminEmailCampaignRow { id: number; tenantId: number | null; restaurantId: number | null; name: string; subject: string; status: string; segment: string; sentCount: number; failedCount: number; scheduledAt: string | null; sentAt: string | null; updatedAt: string; }
export function useAdminEmailCampaigns(params?: { status?: string; tenantId?: number }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.tenantId) qs.set("tenantId", String(params.tenantId));
  const s = qs.toString();
  return useQuery({ queryKey: ["admin","email","campaigns", s], queryFn: () => apiGet<{ data: AdminEmailCampaignRow[] }>(`/admin/email/campaigns${s ? `?${s}` : ""}`) });
}
export interface AdminEmailCampaignAnalytics { summary: { total: number; sent: number; scheduled: number; draft: number; failed: number; recipients: number; bounces: number }; top: AdminEmailCampaignRow[]; }
export function useAdminEmailCampaignAnalytics() { return useQuery({ queryKey: ["admin","email","campaigns","analytics"], queryFn: () => apiGet<AdminEmailCampaignAnalytics>("/admin/email/campaigns/analytics"), refetchInterval: 60_000 }); }

export interface EmailPerTenantReportRow { tenantId: number; tenantName: string; sent: number; delivered: number; opened: number; clicked: number; bounced: number; failed: number; unsubscribed: number; openRate: number; clickRate: number; }
export function useAdminEmailPerTenantReport() { return useQuery({ queryKey: ["admin","email","reports","per-tenant"], queryFn: () => apiGet<{ data: EmailPerTenantReportRow[] }>("/admin/email/reports/per-tenant") }); }
export function useAdminEmailLogEvents(id: number | null) { return useQuery({ queryKey: ["admin","email","logs", id, "events"], queryFn: () => apiGet<{ data: Array<{ id: number; eventType: string; url: string | null; userAgent: string | null; ip: string | null; createdAt: string }> }>(`/admin/email/logs/${id}/events`), enabled: !!id }); }

// ─── Restaurant-scoped email settings & campaigns (Task #414) ───
// Server resolves restaurant from the authenticated user, so paths are /email/* (not /restaurants/:id/email/*).
export interface RestaurantEmailSettings { restaurantId: number; marketingEnabled: boolean; followUpEnabled: boolean; fromName: string; replyTo: string | null; footerText: string; businessAddress: string; consentRequired: boolean; birthdayEnabled: boolean; feedbackEnabled: boolean; reviewEnabled: boolean; inactiveEnabled: boolean; updatedAt: string; }
export interface RestaurantEmailUsage { tenantId: number; year: number; month: number; transactionalSent: number; marketingSent: number; automationSent: number; sequenceSent: number; }
export interface RestaurantEmailLimits { marketingEnabled: boolean; sequencesEnabled: boolean; automationsEnabled: boolean; aiEnabled: boolean; monthlyMarketingCap: number | null; monthlyTransactionalCap: number | null; }
export function useRestaurantEmailSettings() {
  const RID = useRestaurantId();
  return useQuery({
    queryKey: ["restaurants", RID, "email", "settings"],
    queryFn: async () => {
      const r = await apiGet<{ data: RestaurantEmailSettings; limits: RestaurantEmailLimits | null; usage: RestaurantEmailUsage | null }>("/email/settings");
      return r.data;
    },
    enabled: !!RID,
  });
}
export function useRestaurantEmailSettingsWithLimits() {
  const RID = useRestaurantId();
  return useQuery({
    queryKey: ["restaurants", RID, "email", "settings", "full"],
    queryFn: () => apiGet<{ data: RestaurantEmailSettings; limits: RestaurantEmailLimits | null; usage: RestaurantEmailUsage | null }>("/email/settings"),
    enabled: !!RID,
  });
}
export function useUpdateRestaurantEmailSettings() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: Partial<RestaurantEmailSettings>) => {
      const r = await apiPut<{ data: RestaurantEmailSettings }>("/email/settings", b);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["restaurants", RID, "email", "settings"] });
      qc.invalidateQueries({ queryKey: ["restaurants", RID, "email", "settings", "full"] });
    },
  });
}
export function useRestaurantEmailMarketingTemplates(category?: string) { const RID = useRestaurantId(); return useQuery({ queryKey: ["restaurants", RID, "email","marketing-templates", category ?? "all"], queryFn: () => apiGet<{ data: EmailMarketingTemplateRow[] }>(`/email/marketing-templates${category ? `?category=${encodeURIComponent(category)}` : ""}`), enabled: !!RID }); }

export interface EmailCampaignRow { id: number; restaurantId: number; tenantId: number | null; name: string; marketingTemplateId: number | null; segment: string; audienceFilter: Record<string, unknown>; subject: string; preheader: string; body: string; ctaLabel: string | null; ctaUrl: string | null; brandColor: string; status: string; scheduledAt: string | null; startedAt: string | null; completedAt: string | null; recipientCount: number; sentCount: number; deliveredCount: number; openedCount: number; clickedCount: number; unsubscribedCount: number; bouncedCount: number; failedCount: number; blockedReason: string | null; createdAt: string; updatedAt: string; }
export function useRestaurantEmailCampaigns() { const RID = useRestaurantId(); return useQuery({ queryKey: ["restaurants", RID, "email","campaigns"], queryFn: () => apiGet<{ data: EmailCampaignRow[] }>("/email/campaigns"), enabled: !!RID }); }
export function useCreateRestaurantEmailCampaign() { const RID = useRestaurantId(); const qc = useQueryClient(); return useMutation({ mutationFn: (b: Partial<EmailCampaignRow>) => apiPost<EmailCampaignRow>("/email/campaigns", b), onSuccess: () => qc.invalidateQueries({ queryKey: ["restaurants", RID, "email","campaigns"] }) }); }
export function useUpdateRestaurantEmailCampaign() { const RID = useRestaurantId(); const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...b }: Partial<EmailCampaignRow> & { id: number }) => apiPut<EmailCampaignRow>(`/email/campaigns/${id}`, b), onSuccess: () => qc.invalidateQueries({ queryKey: ["restaurants", RID, "email","campaigns"] }) }); }
export function useDeleteRestaurantEmailCampaign() { const RID = useRestaurantId(); const qc = useQueryClient(); return useMutation({ mutationFn: (id: number) => apiDelete(`/email/campaigns/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["restaurants", RID, "email","campaigns"] }) }); }
export function useSendRestaurantEmailCampaignTest() { return useMutation({ mutationFn: ({ id, to }: { id: number; to: string }) => apiPost<{ ok: boolean; logId?: number; error?: string }>(`/email/campaigns/${id}/test`, { to }) }); }
export function usePreviewRestaurantEmailCampaignAudience() {
  return useMutation({
    mutationFn: ({ id, segment, audienceFilter }: { id: number; segment?: string; audienceFilter?: Record<string, unknown> }) =>
      apiPost<{ count: number; sample: Array<{ email: string; name: string | null }> }>(`/email/campaigns/${id}/audience-preview`, { segment, audienceFilter }),
  });
}
export function useSendRestaurantEmailCampaign() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) => apiPost<{ ok: boolean; queued: number }>(`/email/campaigns/${id}/send`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["restaurants", RID, "email", "campaigns"] }),
  });
}
export function useRestaurantEmailCampaignReport(id: number | null) { const RID = useRestaurantId(); return useQuery({ queryKey: ["restaurants", RID, "email","campaigns", id, "report"], queryFn: () => apiGet<{ campaign: EmailCampaignRow; stats: { opened: number; clicked: number; sent: number; failed: number }; recipients: Array<{ id: number; email: string; status: string; reason: string | null; sentAt: string | null }> }>(`/email/campaigns/${id}/report`), enabled: !!RID && !!id }); }
export function useSetCustomerMarketingConsent() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, optIn, source }: { id: number; optIn: boolean; source?: string }) => apiPost<{ ok: boolean }>(`/email/customers/${id}/marketing-consent`, { optIn, source }), onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }) }); }

// ─────────────────────────────────────────────────────────────────────────
// Task #424 — Advanced staff scheduling & labor forecasting
// ─────────────────────────────────────────────────────────────────────────

export function useStaffAvailability(userId?: number) {
  const RID = useRestaurantId();
  const q = userId ? `?userId=${userId}` : "";
  return useQuery({
    queryKey: ["staff-availability", RID, userId],
    queryFn: () => apiGet<import("./types").StaffAvailabilitySlot[]>(`/restaurants/${RID}/staff-availability${q}`),
  });
}

export function useReplaceStaffAvailability() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { userId?: number; slots: Array<{ dayOfWeek: number; startTime: string; endTime: string; isAvailable?: boolean; note?: string | null; effectiveFrom?: string | null }> }) =>
      apiPut<import("./types").StaffAvailabilitySlot[]>(`/restaurants/${RID}/staff-availability`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-availability"] }),
  });
}

export function useShiftTrades(status?: string) {
  const RID = useRestaurantId();
  const q = status ? `?status=${status}` : "";
  return useQuery({
    queryKey: ["shift-trades", RID, status],
    queryFn: () => apiGet<import("./types").ShiftTradeRequest[]>(`/restaurants/${RID}/shift-trades${q}`),
  });
}

export function useCreateShiftTrade() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { staffShiftId: number; toUserId?: number; tradeType?: "giveaway" | "swap"; swapStaffShiftId?: number; reason?: string }) =>
      apiPost<import("./types").ShiftTradeRequest>(`/restaurants/${RID}/shift-trades`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-trades"] }),
  });
}

export function useShiftTradePeerRespond() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accept }: { id: number; accept: boolean }) =>
      apiPost(`/restaurants/${RID}/shift-trades/${id}/peer-respond`, { accept }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-trades"] }),
  });
}

export function useShiftTradeDecide() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: number; decision: "approve" | "reject"; note?: string }) =>
      apiPost(`/restaurants/${RID}/shift-trades/${id}/decide`, { decision, note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shift-trades"] });
      qc.invalidateQueries({ queryKey: ["staff-shifts"] });
    },
  });
}

// ───────────────────────── Supplier Network (Task #428) ─────────────────────────
import type {
  SupplierCatalogItem, BestVendorResponse, PurchaseRequestSummary, PurchaseRequestDetail, PurchaseHistoryRow,
} from "./types";

export function useSupplierCatalog(opts?: { supplierId?: number; inventoryItemId?: number; q?: string }) {
  const RESTAURANT_ID = useRestaurantId();
  const params = new URLSearchParams();
  if (opts?.supplierId) params.set("supplierId", String(opts.supplierId));
  if (opts?.inventoryItemId) params.set("inventoryItemId", String(opts.inventoryItemId));
  if (opts?.q) params.set("q", opts.q);
  const qs = params.toString();
  return useQuery({
    queryKey: ["supplier-catalog", RESTAURANT_ID, opts ?? null],
    queryFn: () => apiGet<SupplierCatalogItem[]>(`/restaurants/${RESTAURANT_ID}/supplier-catalog${qs ? `?${qs}` : ""}`),
  });
}

export function useCreateSupplierCatalogItem() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<SupplierCatalogItem> & { supplierId: number; name: string }) =>
      apiPost<SupplierCatalogItem>(`/restaurants/${RESTAURANT_ID}/supplier-catalog`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supplier-catalog"] }),
  });
}

export function useUpdateSupplierCatalogItem() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<SupplierCatalogItem> & { id: number }) =>
      apiPatch<SupplierCatalogItem>(`/restaurants/${RESTAURANT_ID}/supplier-catalog/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supplier-catalog"] }),
  });
}

export function useDeleteSupplierCatalogItem() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${RESTAURANT_ID}/supplier-catalog/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supplier-catalog"] }),
  });
}

export function useBestVendorsForItem(inventoryItemId: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["supplier-catalog-by-item", RESTAURANT_ID, inventoryItemId],
    queryFn: () => apiGet<BestVendorResponse>(`/restaurants/${RESTAURANT_ID}/supplier-catalog/by-item/${inventoryItemId}`),
    enabled: inventoryItemId != null,
  });
}

export function usePurchaseRequests() {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["purchase-requests", RESTAURANT_ID],
    queryFn: () => apiGet<PurchaseRequestSummary[]>(`/restaurants/${RESTAURANT_ID}/purchase-requests`),
  });
}

export function usePurchaseRequest(id: number | null) {
  const RESTAURANT_ID = useRestaurantId();
  return useQuery({
    queryKey: ["purchase-request", RESTAURANT_ID, id],
    queryFn: () => apiGet<PurchaseRequestDetail>(`/restaurants/${RESTAURANT_ID}/purchase-requests/${id}`),
    enabled: id != null,
  });
}

export interface CreatePurchaseRequestInput {
  title: string;
  notes?: string | null;
  neededBy?: string | null;
  supplierIds?: number[];
  items: Array<{ inventoryItemId?: number | null; name: string; unit: string; quantity: number | string; notes?: string }>;
}

export function useCreatePurchaseRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePurchaseRequestInput) => apiPost<PurchaseRequestDetail>(`/restaurants/${RESTAURANT_ID}/purchase-requests`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-requests"] }),
  });
}

export function useSendPurchaseRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, supplierIds }: { id: number; supplierIds: number[] }) =>
      apiPost<PurchaseRequestDetail>(`/restaurants/${RESTAURANT_ID}/purchase-requests/${id}/send`, { supplierIds }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["purchase-requests"] });
      qc.invalidateQueries({ queryKey: ["purchase-request", RESTAURANT_ID, v.id] });
    },
  });
}

export function useShiftTradeCancel() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${RID}/shift-trades/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-trades"] }),
  });
}

export function useSchedulePublications() {
  const RID = useRestaurantId();
  return useQuery({
    queryKey: ["schedule-publications", RID],
    queryFn: () => apiGet<import("./types").SchedulePublication[]>(`/restaurants/${RID}/schedule-publications`),
  });
}

export function usePublishSchedule() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { weekStart: string; weekEnd: string; note?: string; channels?: { push?: boolean; sms?: boolean; whatsapp?: boolean } }) =>
      apiPost<import("./types").SchedulePublication>(`/restaurants/${RID}/schedule-publications`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedule-publications"] }),
  });
}

export function useLaborSettings() {
  const RID = useRestaurantId();
  return useQuery({
    queryKey: ["labor-settings", RID],
    queryFn: () => apiGet<import("./types").LaborSettings>(`/restaurants/${RID}/labor-settings`),
  });
}

export function useUpdateLaborSettings() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<import("./types").LaborSettings>) =>
      apiPatch<import("./types").LaborSettings>(`/restaurants/${RID}/labor-settings`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["labor-settings"] }),
  });
}

export function useLaborForecast(weekStart: string | null) {
  const RID = useRestaurantId();
  return useQuery({
    queryKey: ["labor-forecast", RID, weekStart],
    queryFn: () => apiGet<import("./types").LaborForecast>(`/restaurants/${RID}/labor-forecast?weekStart=${encodeURIComponent(weekStart!)}`),
    enabled: !!weekStart,
  });
}

export function useLaborReport(from: string | null, to: string | null) {
  const RID = useRestaurantId();
  return useQuery({
    queryKey: ["labor-report", RID, from, to],
    queryFn: () => apiGet<import("./types").LaborReport>(`/restaurants/${RID}/labor-report?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`),
    enabled: !!from && !!to,
  });
}

export function useLaborViolations() {
  const RID = useRestaurantId();
  return useQuery({
    queryKey: ["labor-violations", RID],
    queryFn: () => apiGet<import("./types").LaborViolationsResponse>(`/restaurants/${RID}/labor-violations`),
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useCopyScheduleWeek() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { fromWeekStart: string; toWeekStart: string }) =>
      apiPost<{ count: number; assignments: import("./types").StaffShift[] }>(`/restaurants/${RID}/staff-shifts/copy-week`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-shifts"] }),
  });
}

export function useBulkCreateStaffShifts() {
  const RID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { assignments: Array<{ userId: number; shiftId: number; date: string; endDate?: string | null; recurringDays?: string[] }> }) =>
      apiPost<import("./types").StaffShift[]>(`/restaurants/${RID}/staff-shifts/bulk`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-shifts"] }),
  });
}

export function useAddManualQuote() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, supplierId, leadTimeDays, notes, items }: {
      id: number;
      supplierId: number;
      leadTimeDays?: number;
      notes?: string;
      items: Array<{ requestItemId: number; pricePerUnit: number; available: boolean }>;
    }) =>
      apiPost<{ quoteId: number }>(`/restaurants/${RESTAURANT_ID}/purchase-requests/${id}/quotes`, {
        supplierId, leadTimeDays, notes, items,
      }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["purchase-requests"] });
      qc.invalidateQueries({ queryKey: ["purchase-request", RESTAURANT_ID, v.id] });
    },
  });
}

export function useAwardPurchaseRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, quoteId }: { id: number; quoteId: number }) =>
      apiPost<{ purchaseOrderId: number; requestId: number }>(`/restaurants/${RESTAURANT_ID}/purchase-requests/${id}/award`, { quoteId }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["purchase-requests"] });
      qc.invalidateQueries({ queryKey: ["purchase-request", RESTAURANT_ID, v.id] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function useCancelPurchaseRequest() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${RESTAURANT_ID}/purchase-requests/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-requests"] }),
  });
}

export function usePurchaseHistory(opts?: { supplierId?: number; inventoryItemId?: number }) {
  const RESTAURANT_ID = useRestaurantId();
  const params = new URLSearchParams();
  if (opts?.supplierId) params.set("supplierId", String(opts.supplierId));
  if (opts?.inventoryItemId) params.set("inventoryItemId", String(opts.inventoryItemId));
  const qs = params.toString();
  return useQuery({
    queryKey: ["purchase-history", RESTAURANT_ID, opts ?? null],
    queryFn: () => apiGet<PurchaseHistoryRow[]>(`/restaurants/${RESTAURANT_ID}/purchase-history${qs ? `?${qs}` : ""}`),
  });
}

export function useUpdateSupplierNetworkInfo() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; leadTimeDays?: number | null; minOrderValue?: string | null; paymentTerms?: string | null; reliabilityScore?: string | null; notes?: string | null; categoryTags?: string[]; isCatalogPublic?: boolean; regeneratePortalToken?: boolean }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/supplier-network/suppliers/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}
