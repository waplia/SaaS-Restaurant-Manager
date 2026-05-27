import { getApiBaseUrl } from "@/lib/apiBaseUrl";

export class CashierApiError extends Error {
  status: number;
  code?: string;
  body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    if (body && typeof body === "object" && "code" in body) {
      this.code = String((body as { code: unknown }).code);
    }
  }
}

export async function cashierFetch<T = unknown>(
  token: string | null,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${getApiBaseUrl()}/api${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: unknown = null;
    let text = "";
    try {
      text = await res.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const message =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : null) ??
      text ??
      `Request failed (${res.status})`;
    throw new CashierApiError(message, res.status, body);
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export const INR_DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export type DenominationCount = { denomination: number; count: number };

export interface CashRegisterSession {
  id: number;
  restaurantId: number;
  openedByUserId: number;
  openedByName?: string | null;
  openingFloat: string;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  closedByUserId: number | null;
  closedByName?: string | null;
  expectedCash: string | null;
  actualCash: string | null;
  overShort: string | null;
  notes: string | null;
  varianceReason: string | null;
  isBlindClose: boolean | null;
  shiftId: number | null;
}

export interface CashRegisterTotals {
  openingFloat: number;
  cashSales: number;
  refunds: number;
  cashIn: number;
  cashOut: number;
  drops: number;
  payouts: number;
  totalCashIn: number;
  totalCashOut: number;
  expectedCash: number;
}

export interface CashMovement {
  id: number;
  sessionId: number;
  type: "cash_in" | "cash_out" | "drop" | "payout" | "refund" | "sale";
  amount: string;
  reason: string | null;
  createdAt: string;
  createdByUserId: number | null;
  createdByName?: string | null;
}

export interface DeviceRow {
  id: number;
  name: string;
  type: string;
  status: string;
  lastSeenAt: string | null;
  branchId: number | null;
}

export interface PrinterRow {
  id: number;
  name: string;
  role: string;
  status: string | null;
  enabled: boolean;
  isDefault: boolean;
  lastSeenAt?: string | null;
  branchId: number | null;
  connectionType: string;
}
