import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "./api";
import { useRestaurantId } from "./hooks";

export type Student = {
  id: number;
  tenantId: number;
  restaurantId: number;
  studentCode: string;
  qrToken: string;
  name: string;
  className: string | null;
  section: string | null;
  rollNumber: string | null;
  photoUrl: string | null;
  balance: number;
  lifetimeIn: number;
  lifetimeOut: number;
  dailyCap: number | null;
  lowBalanceThreshold: number | null;
  isActive: boolean;
  isFrozen: boolean;
  notes: string | null;
};

export type Guardian = {
  id: number;
  studentId: number;
  name: string;
  relation: string | null;
  phone: string | null;
  email: string | null;
  parentToken: string;
  notifyEmail: boolean;
  notifySms: boolean;
  notifyWhatsapp: boolean;
  isPrimary: boolean;
};

export type WalletTxn = {
  id: number;
  studentId: number;
  direction: "credit" | "debit";
  amount: number;
  type: string;
  channel: string | null;
  externalRef: string | null;
  openingBalance: number;
  closingBalance: number;
  notes: string | null;
  createdAt: string;
};

export type CanteenOrder = {
  id: number;
  orderNumber: string;
  studentId: number;
  total: number;
  paymentSource: string;
  status: string;
  counterName: string | null;
  createdAt: string;
};

export type CanteenOrderItem = {
  id: number;
  orderId: number;
  itemName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type CanteenMealPlan = {
  id: number;
  restaurantId: number;
  name: string;
  description: string | null;
  dailyAllowance: number;
  monthlyPrice: number;
  daysOfWeek: string;
  mealType: string;
  isActive: boolean;
};

export type MealPlanSub = {
  id: number;
  studentId: number;
  planId: number;
  status: string;
  startDate: string;
  endDate: string | null;
  studentName: string | null;
  planName: string | null;
  monthlyPrice: number | null;
};

export type Restriction = {
  id: number;
  scope: "item" | "category";
  menuItemId: number | null;
  categoryId: number | null;
  appliesToClass?: string | null;
  reason: string | null;
};

const base = (rid: number) => `/restaurants/${rid}/canteen`;

// Students ─────────────────────────────────────────────────────────────────
export function useStudents(q?: string) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["canteen", "students", rid, q ?? ""],
    queryFn: () => apiGet<Student[]>(`${base(rid)}/students${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });
}

export function useCreateStudent() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Student>) => apiPost<Student>(`${base(rid)}/students`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "students", rid] }),
  });
}

export function useUpdateStudent() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<Student> & { id: number }) =>
      apiPatch<Student>(`${base(rid)}/students/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "students", rid] }),
  });
}

export function useDeactivateStudent() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`${base(rid)}/students/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "students", rid] }),
  });
}

export function useRegenerateQr() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost<Student>(`${base(rid)}/students/${id}/regenerate-qr`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "students", rid] }),
  });
}

export function useStudentHistory(studentId: number | null) {
  const rid = useRestaurantId();
  return useQuery({
    enabled: studentId != null,
    queryKey: ["canteen", "history", rid, studentId],
    queryFn: () => apiGet<{ student: Student; txns: WalletTxn[]; orders: CanteenOrder[]; items: CanteenOrderItem[] }>(
      `${base(rid)}/students/${studentId}/history`),
  });
}

// Guardians ─────────────────────────────────────────────────────────────────
export function useGuardians(studentId: number | null) {
  const rid = useRestaurantId();
  return useQuery({
    enabled: studentId != null,
    queryKey: ["canteen", "guardians", rid, studentId],
    queryFn: () => apiGet<Guardian[]>(`${base(rid)}/students/${studentId}/guardians`),
  });
}

export function useAddGuardian() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, ...input }: Partial<Guardian> & { studentId: number }) =>
      apiPost<Guardian>(`${base(rid)}/students/${studentId}/guardians`, input),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["canteen", "guardians", rid, v.studentId] }),
  });
}

export function useDeleteGuardian() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gid: number) => apiDelete(`${base(rid)}/guardians/${gid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "guardians"] }),
  });
}

// Wallet ────────────────────────────────────────────────────────────────────
export function useRecharge() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, ...input }: { studentId: number; amountPaise: number; channel?: string; notes?: string }) =>
      apiPost(`${base(rid)}/students/${studentId}/wallet/recharge`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canteen", "students", rid] });
      qc.invalidateQueries({ queryKey: ["canteen", "history"] });
    },
  });
}

export function useAdjustWallet() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, deltaPaise, reason }: { studentId: number; deltaPaise: number; reason: string }) =>
      apiPost(`${base(rid)}/students/${studentId}/wallet/adjust`, { deltaPaise, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen"] }),
  });
}

// Restrictions ─────────────────────────────────────────────────────────────
export function useGlobalRestrictions() {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["canteen", "restrictions", rid],
    queryFn: () => apiGet<Restriction[]>(`${base(rid)}/restrictions`),
  });
}

export function useAddGlobalRestriction() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Restriction>) => apiPost(`${base(rid)}/restrictions`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "restrictions", rid] }),
  });
}

export function useDeleteGlobalRestriction() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`${base(rid)}/restrictions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "restrictions", rid] }),
  });
}

// Meal plans ───────────────────────────────────────────────────────────────
export function useMealPlans() {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["canteen", "meal-plans", rid],
    queryFn: () => apiGet<CanteenMealPlan[]>(`${base(rid)}/meal-plans`),
  });
}

export function useSaveMealPlan() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<CanteenMealPlan> & { id?: number }) =>
      id ? apiPatch(`${base(rid)}/meal-plans/${id}`, input) : apiPost(`${base(rid)}/meal-plans`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "meal-plans", rid] }),
  });
}

export function useDeleteMealPlan() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`${base(rid)}/meal-plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "meal-plans", rid] }),
  });
}

export function useMealPlanSubs(studentId?: number) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["canteen", "meal-plan-subs", rid, studentId ?? "all"],
    queryFn: () => apiGet<MealPlanSub[]>(
      `${base(rid)}/meal-plan-subs${studentId ? `?studentId=${studentId}` : ""}`),
  });
}

export function useSubscribeMealPlan() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { studentId: number; planId: number; startDate: string; endDate?: string }) =>
      apiPost(`${base(rid)}/meal-plan-subs`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "meal-plan-subs", rid] }),
  });
}

export function useCancelMealPlanSub() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(`${base(rid)}/meal-plan-subs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen", "meal-plan-subs", rid] }),
  });
}

// POS ──────────────────────────────────────────────────────────────────────
export type PosLookup = {
  student: Student;
  todaysSpend: number;
  dailyCap: number;
  remainingDaily: number | null;
  blockedItemIds: number[];
  blockedCategoryIds: number[];
};

export function usePosLookup(qr: string | null) {
  const rid = useRestaurantId();
  return useQuery({
    enabled: !!qr,
    queryKey: ["canteen", "pos-lookup", rid, qr],
    queryFn: () => apiGet<PosLookup>(`${base(rid)}/pos/lookup?qr=${encodeURIComponent(qr ?? "")}`),
    retry: false,
  });
}

export function usePlacePosOrder() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      studentId: number;
      paymentSource?: "wallet" | "cash";
      counterName?: string;
      notes?: string;
      items: Array<{ menuItemId: number; quantity: number }>;
    }) => apiPost<{ order: CanteenOrder; balance: number }>(`${base(rid)}/pos/orders`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canteen"] }),
  });
}

// Reports ──────────────────────────────────────────────────────────────────
export type MonthlyReport = {
  month: string;
  orders: Array<CanteenOrder & { studentName: string | null; studentCode: string | null; className: string | null }>;
  txns: WalletTxn[];
  totalSales: number;
  totalRecharges: number;
  orderCount: number;
};

export function useMonthlyReport(month: string) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["canteen", "report", rid, month],
    queryFn: () => apiGet<MonthlyReport>(`${base(rid)}/reports/monthly?month=${month}`),
  });
}

export function monthlyReportCsvUrl(rid: number, month: string) {
  return `/api${base(rid)}/reports/monthly.csv?month=${month}`;
}

// Helpers ──────────────────────────────────────────────────────────────────
export const rupees = (paise: number | null | undefined): string =>
  paise == null ? "—" : `₹${(paise / 100).toFixed(2)}`;
