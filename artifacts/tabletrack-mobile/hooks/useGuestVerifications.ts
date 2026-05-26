import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import { useAuth } from "@/context/AuthContext";

export interface GuestVerification {
  orderId: number;
  orderNumber: string;
  tableId: number | null;
  tableSessionId: number | null;
  totalAmount: string;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  createdAt: string;
  heldAt: string;
  sessionOpenedAt: string | null;
  ticketIds: number[];
  items: Array<{ orderId: number; name: string; quantity: number; unitPrice: string; notes: string | null }>;
}

async function callApi<T>(path: string, accessToken: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function useGuestVerifications() {
  const { restaurantId, accessToken } = useAuth();
  return useQuery({
    queryKey: ["guest-verifications", restaurantId],
    queryFn: () => callApi<GuestVerification[]>(`/api/restaurants/${restaurantId}/guest-verifications`, accessToken),
    enabled: !!restaurantId,
    refetchInterval: 15_000,
  });
}

export function useAcceptGuestVerification() {
  const qc = useQueryClient();
  const { restaurantId, accessToken } = useAuth();
  return useMutation({
    mutationFn: (orderId: number) =>
      callApi(`/api/restaurants/${restaurantId}/orders/${orderId}/accept-guest`, accessToken, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guest-verifications", restaurantId] });
    },
  });
}

export function useRejectGuestVerification() {
  const qc = useQueryClient();
  const { restaurantId, accessToken } = useAuth();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: number; reason?: string }) =>
      callApi(`/api/restaurants/${restaurantId}/orders/${orderId}/reject-guest`, accessToken, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guest-verifications", restaurantId] });
    },
  });
}
