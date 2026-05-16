import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "./api";
import { useRestaurantId } from "./hooks";

export type TiffinPlan = {
  id: number;
  name: string;
  description: string | null;
  mealType: string;
  cuisine: string;
  pricePerMeal: string;
  monthlyPrice: string;
  trialAvailable: boolean;
  trialPrice: string | null;
  daysOfWeek: string;
  isActive: boolean;
};

export type TiffinSubscription = {
  id: number;
  customerId: number;
  customerName: string | null;
  customerPhone: string | null;
  planId: number;
  planName: string | null;
  status: string;
  startDate: string;
  endDate: string | null;
  pausedFrom: string | null;
  pausedTo: string | null;
  deliveryAddress: string;
  routeId: number | null;
  routeStop: number | null;
  preferredSlot: string;
  mealsPerDay: number;
  notes: string | null;
  monthlyPrice: string | null;
  pricePerMeal: string | null;
};

export type TiffinRoute = {
  id: number;
  name: string;
  description: string | null;
  riderId: number | null;
  slot: string;
  isActive: boolean;
  riderName: string | null;
};

export type TiffinDelivery = {
  id: number;
  subscriptionId: number;
  routeId: number | null;
  riderId: number | null;
  deliveryDate: string;
  slot: string;
  status: string;
  mealsCount: number;
  skippedReason: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  routeStop: number | null;
  routeName: string | null;
};

export type TiffinInvoice = {
  id: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string | null;
  customerPhone: string | null;
  subscriptionId: number;
  periodStart: string;
  periodEnd: string;
  mealsDelivered: number;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  amountPaid: string;
  status: string;
  dueDate: string;
  paidAt: string | null;
};

export function useTiffinPlans() {
  const rid = useRestaurantId();
  return useQuery<TiffinPlan[]>({ queryKey: ["tiffin-plans", rid], queryFn: () => apiGet(`/restaurants/${rid}/tiffin/plans`) });
}

export function useCreateTiffinPlan() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<TiffinPlan>) => apiPost(`/restaurants/${rid}/tiffin/plans`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-plans", rid] }),
  });
}

export function useUpdateTiffinPlan() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Partial<TiffinPlan>) =>
      apiPatch(`/restaurants/${rid}/tiffin/plans/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-plans", rid] }),
  });
}

export function useDeleteTiffinPlan() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`/restaurants/${rid}/tiffin/plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-plans", rid] }),
  });
}

export function useTiffinSubscriptions(status?: string) {
  const rid = useRestaurantId();
  const qs = status ? `?status=${status}` : "";
  return useQuery<TiffinSubscription[]>({
    queryKey: ["tiffin-subs", rid, status],
    queryFn: () => apiGet(`/restaurants/${rid}/tiffin/subscriptions${qs}`),
  });
}

export function useCreateTiffinSubscription() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<TiffinSubscription>) => apiPost(`/restaurants/${rid}/tiffin/subscriptions`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-subs", rid] }),
  });
}

export function usePauseTiffinSubscription() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, from, to }: { id: number; from: string; to: string }) =>
      apiPost(`/restaurants/${rid}/tiffin/subscriptions/${id}/pause`, { from, to }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-subs", rid] }),
  });
}

export function useResumeTiffinSubscription() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${rid}/tiffin/subscriptions/${id}/resume`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-subs", rid] }),
  });
}

export function useCancelTiffinSubscription() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`/restaurants/${rid}/tiffin/subscriptions/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-subs", rid] }),
  });
}

export function useGenerateCalendar() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, from, to }: { id: number; from: string; to: string }) =>
      apiPost(`/restaurants/${rid}/tiffin/subscriptions/${id}/generate-calendar`, { from, to }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-deliveries", rid] }),
  });
}

export function useTiffinRoutes() {
  const rid = useRestaurantId();
  return useQuery<TiffinRoute[]>({ queryKey: ["tiffin-routes", rid], queryFn: () => apiGet(`/restaurants/${rid}/tiffin/routes`) });
}

export function useCreateTiffinRoute() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<TiffinRoute>) => apiPost(`/restaurants/${rid}/tiffin/routes`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-routes", rid] }),
  });
}

export function useTiffinDeliveries(date?: string, routeId?: number) {
  const rid = useRestaurantId();
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (routeId) params.set("routeId", String(routeId));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return useQuery<TiffinDelivery[]>({
    queryKey: ["tiffin-deliveries", rid, date ?? "", routeId ?? 0],
    queryFn: () => apiGet(`/restaurants/${rid}/tiffin/deliveries${qs}`),
  });
}

export function useMarkAttendance() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: string; reason?: string }) =>
      apiPost(`/restaurants/${rid}/tiffin/deliveries/${id}/attendance`, { status, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-deliveries", rid] }),
  });
}

export function useUpdateDelivery() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; status?: string; riderId?: number | null; routeId?: number | null }) =>
      apiPatch(`/restaurants/${rid}/tiffin/deliveries/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-deliveries", rid] }),
  });
}

export function useTiffinInvoices(status?: string) {
  const rid = useRestaurantId();
  const qs = status ? `?status=${status}` : "";
  return useQuery<TiffinInvoice[]>({
    queryKey: ["tiffin-invoices", rid, status],
    queryFn: () => apiGet(`/restaurants/${rid}/tiffin/invoices${qs}`),
  });
}

export function useRunBilling() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ periodStart, periodEnd }: { periodStart: string; periodEnd: string }) =>
      apiPost(`/restaurants/${rid}/tiffin/billing/run`, { periodStart, periodEnd }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-invoices", rid] }),
  });
}

export function useMarkInvoicePaid() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, method }: { id: number; method: string }) =>
      apiPost(`/restaurants/${rid}/tiffin/invoices/${id}/pay`, { method }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tiffin-invoices", rid] }),
  });
}

export function useCustomerTiffinHistory(customerId: number) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["tiffin-customer-history", rid, customerId],
    queryFn: () => apiGet(`/restaurants/${rid}/tiffin/customers/${customerId}/history`),
    enabled: customerId > 0,
  });
}
