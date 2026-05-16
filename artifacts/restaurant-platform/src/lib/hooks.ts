import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, getApiUrl } from "./api";
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
    mutationFn: (data: CreateOrderInput) => apiPost(`/restaurants/${RESTAURANT_ID}/orders`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] }),
  });
}

export function useUpdateOrder() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateOrderInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/orders/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] }),
  });
}

export function usePayOrder() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: PayOrderInput) => apiPost(`/restaurants/${RESTAURANT_ID}/orders/${id}/pay`, data),
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
    queryFn: () => apiGet<import("./types").RestaurantInfo & { autoReorderEnabled?: boolean; autoReorderCron?: string | null }>(`/restaurants/${RESTAURANT_ID}`),
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
    mutationFn: ({ orderId, amount }: { orderId: number; amount?: number }) =>
      apiPost<import("./types").PaymentIntentResult>(
        `/restaurants/${RESTAURANT_ID}/orders/${orderId}/payment-intent`,
        amount !== undefined ? { customAmount: amount } : {}
      ),
  });
}

export function useCreateRazorpayOrder() {
  const RESTAURANT_ID = useRestaurantId();
  return useMutation({
    mutationFn: ({ orderId, amount }: { orderId: number; amount?: number }) =>
      apiPost<import("./types").RazorpayOrderResult>(
        `/restaurants/${RESTAURANT_ID}/orders/${orderId}/razorpay-order`,
        amount !== undefined ? { customAmount: amount } : {}
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
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/split`, { splits }),
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
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/items`, data),
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
      apiDelete(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/items/${itemId}`),
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
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/discounts`, body),
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
      apiDelete(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/discounts/${discountId}`),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["orders", "detail", RESTAURANT_ID, vars.orderId] });
      qc.invalidateQueries({ queryKey: ["orders", RESTAURANT_ID] });
    },
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
    mutationFn: (orderId: number) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/orders/${orderId}/void`, {}),
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
    mutationFn: ({ id, status }: { id: number; status: string }) => apiPatch(`/restaurants/${RESTAURANT_ID}/kitchen/tickets/${id}/status`, { status }),
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
    mutationFn: ({ id, ...data }: UpdateTableInput) => apiPatch(`/restaurants/${RESTAURANT_ID}/tables/${id}`, data),
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

export function useCustomers(params?: { search?: string; page?: number }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.page) q.set("page", String(params.page));
  return useQuery({
    queryKey: ["customers", RESTAURANT_ID, params],
    queryFn: () => apiGet<CustomersResponse>(`/restaurants/${RESTAURANT_ID}/customers?${q}`),
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
    mutationFn: ({ id, ...data }: { id: number; status?: string; notes?: string; totalAmount?: string }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/purchase-orders/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-orders"] }),
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
    mutationFn: ({ restaurantId, planId, successUrl, cancelUrl }: { restaurantId: number; planId: number; successUrl: string; cancelUrl: string }) =>
      apiPost<{ url: string | null; sessionId?: string; mock?: boolean }>(`/restaurants/${restaurantId}/subscription/create-checkout`, { planId, successUrl, cancelUrl }),
  });
}

export function useCreateCashfreeOrder() {
  return useMutation({
    mutationFn: ({ restaurantId, planId, successUrl }: { restaurantId: number; planId: number; successUrl: string }) =>
      apiPost<{ url: string | null; orderId?: string; paymentSessionId?: string | null; mock?: boolean }>(
        `/restaurants/${restaurantId}/subscription/create-cashfree-order`,
        { planId, successUrl },
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
    bank: { enabled: boolean; bankName?: string; accountHolder?: string; accountNumber?: string; ifsc?: string; branch?: string; instructions?: string };
    upi:  { enabled: boolean; upiId?: string; payeeName?: string; qrUrl?: string };
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
    mutationFn: ({ restaurantId, planId }: { restaurantId: number; planId: number }) =>
      apiPost<{ orderId: string; amount: number; currency: string; keyId: string; receipt: string }>(
        `/restaurants/${restaurantId}/subscription/create-razorpay-order`, { planId },
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
    mutationFn: ({ restaurantId, planId, method, reference, proofUrl, note, amount }: { restaurantId: number; planId: number; method: "bank" | "upi"; reference?: string; proofUrl?: string; note?: string; amount?: number }) =>
      apiPost<{ id: number; status: string }>(`/restaurants/${restaurantId}/subscription/manual-payment`, { planId, method, reference, proofUrl, note, amount }),
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
    mutationFn: ({ restaurantId, planId }: { restaurantId: number; planId: number }) =>
      apiPost(`/restaurants/${restaurantId}/subscription/mock-activate`, { planId }),
    onSuccess: (_data, { restaurantId }) => {
      qc.invalidateQueries({ queryKey: ["subscription", restaurantId] });
    },
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
    mutationFn: (data: { name: string; color?: string; icon?: string }) =>
      apiPost(`/restaurants/${RESTAURANT_ID}/expense-categories`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense-categories"] }),
  });
}

export function useUpdateExpenseCategory() {
  const RESTAURANT_ID = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; color?: string; icon?: string; isActive?: boolean }) =>
      apiPatch(`/restaurants/${RESTAURANT_ID}/expense-categories/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense-categories"] }),
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

export function useExpenses(params?: { from?: string; to?: string; categoryId?: number; search?: string; page?: number }) {
  const RESTAURANT_ID = useRestaurantId();
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  if (params?.categoryId) q.set("categoryId", String(params.categoryId));
  if (params?.search) q.set("search", params.search);
  if (params?.page) q.set("page", String(params.page));
  return useQuery({
    queryKey: ["expenses", RESTAURANT_ID, params],
    queryFn: () => apiGet<import("./types").ExpensesResponse>(`/restaurants/${RESTAURANT_ID}/expenses?${q}`),
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


// ===================== Cash Register =====================

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

// ===================== Payroll =====================

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
export type EmailDriver = "smtp" | "sendgrid" | "mailgun" | "ses" | "custom";
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
