import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiPut } from "./api";
import { useRestaurantId } from "./hooks";

const base = (rid: number) => `/restaurants/${rid}/customer-quality`;

// VIP Alerts
export function useVipAlerts() {
  const rid = useRestaurantId();
  return useQuery<{ alerts: any[] }>({
    queryKey: ["cq", "vip-alerts", rid],
    queryFn: () => apiGet(`${base(rid)}/vip-alerts`),
    refetchInterval: 15000,
  });
}
export function useCreateVipAlert() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => apiPost(`${base(rid)}/vip-alerts`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "vip-alerts", rid] }),
  });
}
export function useAckVipAlert() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(`${base(rid)}/vip-alerts/${id}/ack`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "vip-alerts", rid] }),
  });
}

// Risk Flags / Blacklist
export function useRiskFlags() {
  const rid = useRestaurantId();
  return useQuery<{ flags: any[] }>({
    queryKey: ["cq", "risk-flags", rid],
    queryFn: () => apiGet(`${base(rid)}/risk-flags`),
  });
}
export function useCreateRiskFlag() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => apiPost(`${base(rid)}/risk-flags`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "risk-flags", rid] }),
  });
}
export function useUpdateRiskFlag() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => apiPatch(`${base(rid)}/risk-flags/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "risk-flags", rid] }),
  });
}

// Mood
export function useMoodData(days = 30) {
  const rid = useRestaurantId();
  return useQuery<{ responses: any[]; summary: any[]; averageScore: number; count: number }>({
    queryKey: ["cq", "mood", rid, days],
    queryFn: () => apiGet(`${base(rid)}/mood?days=${days}`),
  });
}
export function useCreateMood() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => apiPost(`${base(rid)}/mood`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "mood", rid] }),
  });
}

// Complaint Escalation
export function useEscalationRule() {
  const rid = useRestaurantId();
  return useQuery<{ rule: any }>({
    queryKey: ["cq", "esc-rule", rid],
    queryFn: () => apiGet(`${base(rid)}/escalation/rules`),
  });
}
export function useUpdateEscalationRule() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => apiPut(`${base(rid)}/escalation/rules`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "esc-rule", rid] }),
  });
}
export function useEscalationEvents() {
  const rid = useRestaurantId();
  return useQuery<{ events: any[] }>({
    queryKey: ["cq", "esc-events", rid],
    queryFn: () => apiGet(`${base(rid)}/escalation/events`),
    refetchInterval: 30000,
  });
}

// Repeat Clusters
export function useRepeatClusters() {
  const rid = useRestaurantId();
  return useQuery<{ clusters: any[] }>({
    queryKey: ["cq", "clusters", rid],
    queryFn: () => apiGet(`${base(rid)}/repeat-clusters`),
  });
}
export function useDismissCluster() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      apiPost(`${base(rid)}/repeat-clusters/${id}/dismiss`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "clusters", rid] }),
  });
}
export function useRebuildClusters() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`${base(rid)}/repeat-clusters/rebuild`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "clusters", rid] }),
  });
}

// Visit Calendar
export function useVisitCalendar(from?: string, to?: string, absentDays = 30) {
  const rid = useRestaurantId();
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  q.set("absentDays", String(absentDays));
  return useQuery<{ visits: any[]; reservations: any[]; customers: any[]; dropoff: any[]; absentDays: number }>({
    queryKey: ["cq", "calendar", rid, from, to, absentDays],
    queryFn: () => apiGet(`${base(rid)}/visit-calendar?${q}`),
  });
}

export function useSendWinback() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { customerId: number; channel?: string; message?: string }) =>
      apiPost(`${base(rid)}/visit-calendar/winback`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "calendar", rid] }),
  });
}

// Order status (authenticated lookup)
export function useOrderStatus(orderId: number | null) {
  const rid = useRestaurantId();
  return useQuery<{ order: any }>({
    queryKey: ["cq", "order-status", rid, orderId],
    queryFn: () => apiGet(`${base(rid)}/order-status/${orderId}`),
    enabled: !!orderId,
    refetchInterval: 5000,
  });
}

// Accuracy
export function useAccuracy(days = 30) {
  const rid = useRestaurantId();
  return useQuery<{ score: number; totalOrders: number; totalIssues: number; events: any[]; byStaff: any[] }>({
    queryKey: ["cq", "accuracy", rid, days],
    queryFn: () => apiGet(`${base(rid)}/accuracy?days=${days}`),
  });
}
export function useCreateAccuracy() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => apiPost(`${base(rid)}/accuracy`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "accuracy", rid] }),
  });
}

// Lost Sales
export function useLostSales(days = 30) {
  const rid = useRestaurantId();
  return useQuery<{ events: any[]; summary: any[]; totalLost: number; count: number }>({
    queryKey: ["cq", "lost-sales", rid, days],
    queryFn: () => apiGet(`${base(rid)}/lost-sales?days=${days}`),
  });
}
export function useCreateLostSale() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => apiPost(`${base(rid)}/lost-sales`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "lost-sales", rid] }),
  });
}

// Abandoned Carts
export function useCarts(status?: string) {
  const rid = useRestaurantId();
  const q = status ? `?status=${status}` : "";
  return useQuery<{ carts: any[]; events: any[] }>({
    queryKey: ["cq", "carts", rid, status],
    queryFn: () => apiGet(`${base(rid)}/carts${q}`),
    refetchInterval: 30000,
  });
}
export function useRecoverCart() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: any) => apiPost(`${base(rid)}/carts/${id}/recover`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cq", "carts", rid] }),
  });
}
