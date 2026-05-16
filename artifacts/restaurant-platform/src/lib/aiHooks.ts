/**
 * React Query hooks for the Khana AI module. Wraps `/ai/wallet`,
 * `/ai/recharge-packages`, per-restaurant AI settings and usage summary.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/lib/api";
import { useRestaurantId } from "@/lib/hooks";

export interface AiWalletSummary {
  walletId: number;
  balance: number;
  monthlyBalance: number;
  purchasedBalance: number;
  bonusBalance: number;
  reservedCredits: number;
  lifetimeCreditsUsed: number;
  isBlocked: boolean;
  purchasedExpiresAt: string | null;
  planAiEnabled: boolean;
  planKhanaAiEnabled: boolean;
  planMonthlyIncluded: number;
  transactions: Array<{
    id: number;
    type: string;
    featureSlug: string | null;
    credits: number;
    bucket: string | null;
    balanceAfter: number;
    notes: string | null;
    createdAt: string;
  }>;
}

export interface AiRechargePackage {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  credits: number;
  bonusCredits: number;
  price: string;
  currency: string;
  validityDays: number | null;
  isActive: boolean;
  isFeatured: boolean;
  showToRestaurants: boolean;
  sortOrder: number;
}

export interface AiCreditRule {
  id: number;
  featureSlug: string;
  featureLabel: string;
  description: string | null;
  unitType: string;
  pricingMode: string;
  creditsPerUnit: string;
  minCharge: number;
  freeMonthlyQuota: number;
  isActive: boolean;
}

export interface AiSettings {
  id: number;
  restaurantId: number;
  defaultTone: string;
  defaultLanguage: string;
  defaultLength: string;
  requireApprovalForDescriptions: boolean;
  requireApprovalForImages: boolean;
  featureToggles: Record<string, boolean>;
}

export interface AiUsageSummary {
  sinceDays: number;
  byFeature: Array<{ featureSlug: string; status: string; count: number; creditsUsed: number }>;
  byDay: Array<{ day: string; feature: string; count: number; credits: number }>;
  debits: Array<{ featureSlug: string | null; spent: number }>;
}

export function useAiWallet() {
  return useQuery<AiWalletSummary>({
    queryKey: ["ai-wallet"],
    queryFn: () => apiGet<AiWalletSummary>("/ai/wallet"),
    staleTime: 15_000,
  });
}

export function useAiRechargePackages() {
  return useQuery<AiRechargePackage[]>({
    queryKey: ["ai-recharge-packages"],
    queryFn: () => apiGet<AiRechargePackage[]>("/ai/recharge-packages"),
    staleTime: 60_000,
  });
}

export function useAiSettings() {
  const restaurantId = useRestaurantId();
  return useQuery<AiSettings>({
    queryKey: ["ai-settings", restaurantId],
    queryFn: () => apiGet<AiSettings>(`/restaurants/${restaurantId}/ai/settings`),
  });
}

export function useUpdateAiSettings() {
  const qc = useQueryClient();
  const restaurantId = useRestaurantId();
  return useMutation({
    mutationFn: (patch: Partial<AiSettings>) =>
      apiPut<AiSettings>(`/restaurants/${restaurantId}/ai/settings`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-settings", restaurantId] });
    },
  });
}

export function useAiUsageSummary(days = 30) {
  const restaurantId = useRestaurantId();
  return useQuery<AiUsageSummary>({
    queryKey: ["ai-usage-summary", restaurantId, days],
    queryFn: () => apiGet<AiUsageSummary>(`/restaurants/${restaurantId}/ai/usage-summary?days=${days}`),
  });
}

export interface AiRecentGeneration {
  id: number;
  kind: "description" | "photo";
  payload: unknown;
  createdAt: string;
  menuItemId: number;
  itemName: string | null;
}

export function useAiRecentGenerations(limit = 20) {
  const restaurantId = useRestaurantId();
  return useQuery<{ data: AiRecentGeneration[] }>({
    queryKey: ["ai-recent-generations", restaurantId, limit],
    queryFn: () => apiGet(`/restaurants/${restaurantId}/ai/recent-generations?limit=${limit}`),
  });
}

// Server-side paginated, filtered transaction history. Backed by
// `/restaurants/:rid/ai/transactions`, which (unlike `/ai/wallet`) returns
// the full history so filters and CSV export operate on every row, not the
// last 25.
export interface AiTransactionsParams {
  page?: number;
  pageSize?: number;
  feature?: string | null;
  type?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface AiTransactionRow {
  id: number;
  type: string;
  featureSlug: string | null;
  credits: number;
  bucket: string | null;
  balanceAfter: number;
  notes: string | null;
  createdAt: string;
}

export interface AiTransactionsPage {
  data: AiTransactionRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function buildTxQuery(p: AiTransactionsParams) {
  const params = new URLSearchParams();
  if (p.page) params.set("page", String(p.page));
  if (p.pageSize) params.set("pageSize", String(p.pageSize));
  if (p.feature) params.set("feature", p.feature);
  if (p.type) params.set("type", p.type);
  if (p.from) params.set("from", p.from);
  if (p.to) params.set("to", p.to);
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function useAiTransactions(params: AiTransactionsParams = {}) {
  const restaurantId = useRestaurantId();
  return useQuery<AiTransactionsPage>({
    queryKey: ["ai-transactions", restaurantId, params],
    queryFn: () =>
      apiGet<AiTransactionsPage>(
        `/restaurants/${restaurantId}/ai/transactions${buildTxQuery(params)}`,
      ),
    enabled: !!restaurantId,
  });
}

// Fetch full filtered history (across all pages) for CSV export.
export async function fetchAllAiTransactions(
  restaurantId: number,
  filters: Omit<AiTransactionsParams, "page" | "pageSize">,
): Promise<AiTransactionRow[]> {
  const all: AiTransactionRow[] = [];
  let page = 1;
  const pageSize = 200;
  // Cap at 50 pages (10k rows) defensively.
  for (let i = 0; i < 50; i++) {
    const url = `/restaurants/${restaurantId}/ai/transactions${buildTxQuery({ ...filters, page, pageSize })}`;
    const res = await apiGet<AiTransactionsPage>(url);
    all.push(...res.data);
    if (page >= res.totalPages || res.data.length === 0) break;
    page += 1;
  }
  return all;
}
