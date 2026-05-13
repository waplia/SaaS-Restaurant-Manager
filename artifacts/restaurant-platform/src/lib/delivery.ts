import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch } from "./api";
import { RESTAURANT_ID } from "./hooks";

export interface DeliveryRider {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  activeDeliveries: number;
}

export interface DeliveryAssignment {
  id: number;
  restaurantId: number;
  orderId: number;
  riderId: number;
  status: "assigned" | "picked_up" | "delivered" | "cancelled";
  codAmount: string;
  codCollected: boolean;
  codHandedIn: boolean;
  notes: string | null;
  assignedAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  rider?: { id: number; name: string; phone: string | null };
  order?: {
    id: number;
    orderNumber: string;
    customerName: string | null;
    customerPhone: string | null;
    totalAmount: string;
    paymentStatus: string;
    notes: string | null;
  };
}

export interface CodSummaryRow {
  riderId: number;
  riderName: string;
  riderPhone: string | null;
  outstanding: number;
  deliveredCount: number;
}

export interface CodHandover {
  id: number;
  riderId: number;
  amount: string;
  notes: string | null;
  handedInAt: string;
  rider: { id: number; name: string };
}

export function useDeliveryExecutives() {
  return useQuery({
    queryKey: ["delivery", "executives", RESTAURANT_ID],
    queryFn: () => apiGet<DeliveryRider[]>(`/restaurants/${RESTAURANT_ID}/delivery/executives`),
    refetchInterval: 30_000,
  });
}

export function useDeliveryAssignments(status?: string) {
  return useQuery({
    queryKey: ["delivery", "assignments", RESTAURANT_ID, status],
    queryFn: () => apiGet<DeliveryAssignment[]>(`/restaurants/${RESTAURANT_ID}/delivery/assignments${status ? `?status=${status}` : ""}`),
    refetchInterval: 15_000,
  });
}

export function useAssignRider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { orderId: number; riderId: number; notes?: string }) =>
      apiPost<DeliveryAssignment>(`/restaurants/${RESTAURANT_ID}/delivery/assign`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useUpdateAssignmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, codCollected }: { id: number; status: string; codCollected?: boolean }) =>
      apiPatch<DeliveryAssignment>(`/restaurants/${RESTAURANT_ID}/delivery/assignments/${id}/status`, { status, codCollected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useCodSummary() {
  return useQuery({
    queryKey: ["delivery", "cod-summary", RESTAURANT_ID],
    queryFn: () => apiGet<CodSummaryRow[]>(`/restaurants/${RESTAURANT_ID}/delivery/cod-summary`),
    refetchInterval: 20_000,
  });
}

export function useCodHandovers() {
  return useQuery({
    queryKey: ["delivery", "handovers", RESTAURANT_ID],
    queryFn: () => apiGet<CodHandover[]>(`/restaurants/${RESTAURANT_ID}/delivery/handovers`),
  });
}

export function useRecordCodHandover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { riderId: number; amount: number; notes?: string }) =>
      apiPost<CodHandover>(`/restaurants/${RESTAURANT_ID}/delivery/handovers`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["delivery"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
    },
  });
}
