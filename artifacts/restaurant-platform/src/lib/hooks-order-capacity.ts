import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "./api";
import { useRestaurantId } from "./hooks";

export interface OrderCapacityConfig {
  enabled: boolean;
  slotMinutes: number;
  maxOrdersPerSlot: number | null;
  pauseQrOrders: boolean;
  pauseOnlineOrders: boolean;
  pauseUntil: string | null;
  autoExtendThresholdPct: number;
  autoExtendPrepMinutes: number;
  managerAlertOnRush: boolean;
  itemCaps: { menuItemId: number; maxPerSlot: number }[];
  outletCaps: { branchId: number; maxPerSlot: number }[];
  orderTypeCaps: { orderType: string; maxPerSlot: number }[];
  pausedDeliveryZones: number[];
  unavailableMessage: string | null;
}

export interface OrderCapacityStatus {
  allowed: boolean;
  reason?: string;
  nextAvailableAt?: string | null;
  utilizationPct?: number;
  autoExtendApplied?: boolean;
}

export function useOrderCapacityConfig(opts?: { enabled?: boolean }) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: ["order-capacity", "config", restaurantId],
    queryFn: () => apiGet<OrderCapacityConfig>(`/restaurants/${restaurantId}/order-capacity`),
    enabled: opts?.enabled !== false && !!restaurantId,
  });
}

export function useSaveOrderCapacityConfig() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<OrderCapacityConfig>) =>
      apiPut<OrderCapacityConfig>(`/restaurants/${restaurantId}/order-capacity`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["order-capacity"] }),
  });
}

export function useOrderCapacityStatus(opts?: { enabled?: boolean }) {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: ["order-capacity", "status", restaurantId],
    queryFn: () => apiGet<OrderCapacityStatus>(`/restaurants/${restaurantId}/order-capacity/status`),
    refetchInterval: 15_000,
    enabled: opts?.enabled !== false && !!restaurantId,
  });
}

export function usePauseOrders() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { target: "qr" | "online" | "all" | "zone"; minutes?: number; zoneId?: number; reason?: string }) =>
      apiPost<OrderCapacityConfig>(`/restaurants/${restaurantId}/order-capacity/pause`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["order-capacity"] }),
  });
}

export function useResumeOrders() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { target: "qr" | "online" | "all" | "zone"; zoneId?: number }) =>
      apiPost<OrderCapacityConfig>(`/restaurants/${restaurantId}/order-capacity/resume`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["order-capacity"] }),
  });
}
