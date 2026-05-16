import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, apiPut } from "./api";
import { useRestaurantId } from "./hooks";

export interface TokenSettings {
  enabled: boolean;
  resetMode: "daily" | "manual";
  prefix: string;
  startNumber: number;
  padding: number;
  maxNumber: number;
  defaultCounter: number;
  whatsappOnReady: boolean;
  whatsappTemplate: string;
  showCustomerName: boolean;
  enabledOrderTypes: string[];
  recallTtsEnabled: boolean;
}

export interface TokenRow {
  id: number;
  token: string;
  number: number;
  counter: number;
  status: string;
  orderId: number;
  orderType: string;
  customerName: string | null; // masked
  customerNameRaw: string | null; // unmasked (mgmt only)
  customerPhone: string | null;
  branchId: number | null;
  issuedAt: string;
  readyAt: string | null;
  servedAt: string | null;
  recalledAt: string | null;
  recalledCount: number;
}

export function useTokensToday(params: { status?: string; branchId?: number } = {}) {
  const restaurantId = useRestaurantId();
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.branchId) qs.set("branchId", String(params.branchId));
  const q = qs.toString() ? `?${qs.toString()}` : "";
  return useQuery({
    queryKey: ["tokens", "today", restaurantId, params.status ?? null, params.branchId ?? null],
    queryFn: () => apiGet<TokenRow[]>(`/restaurants/${restaurantId}/tokens${q}`),
    refetchInterval: 8000,
  });
}

export function useTokensHistory(params: { from: string; to: string; branchId?: number }) {
  const restaurantId = useRestaurantId();
  const qs = new URLSearchParams({ from: params.from, to: params.to });
  if (params.branchId) qs.set("branchId", String(params.branchId));
  return useQuery({
    queryKey: ["tokens", "history", restaurantId, params.from, params.to, params.branchId ?? null],
    queryFn: () => apiGet<TokenRow[]>(`/restaurants/${restaurantId}/tokens?${qs.toString()}`),
  });
}

export function useUpdateToken() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, counter }: { id: number; status?: string; counter?: number }) =>
      apiPatch<TokenRow>(`/restaurants/${restaurantId}/tokens/${id}`, { status, counter }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });
}

export function useRecallToken() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, counter }: { id: number; counter?: number }) =>
      apiPost<TokenRow>(`/restaurants/${restaurantId}/tokens/${id}/recall`, { counter }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });
}

export interface TokenPrintPayload {
  token: string; number: number; counter: number; customerName: string | null;
  orderType: string; orderNumber: string | null; totalAmount: string | null; issuedAt: string;
}

export function useReprintToken() {
  const restaurantId = useRestaurantId();
  return useMutation({
    mutationFn: (id: number) => apiGet<TokenPrintPayload>(`/restaurants/${restaurantId}/tokens/${id}/print`),
  });
}

export function useTokenSettings() {
  const restaurantId = useRestaurantId();
  return useQuery({
    queryKey: ["token-settings", restaurantId],
    queryFn: () => apiGet<TokenSettings>(`/restaurants/${restaurantId}/token-settings`),
    staleTime: 30000,
  });
}

export function useSaveTokenSettings() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TokenSettings) => apiPut<TokenSettings>(`/restaurants/${restaurantId}/token-settings`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["token-settings"] }),
  });
}

export function useResetTokens() {
  const restaurantId = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId }: { branchId?: number }) =>
      apiPost(`/restaurants/${restaurantId}/token-settings/reset`, { branchId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens"] }),
  });
}
