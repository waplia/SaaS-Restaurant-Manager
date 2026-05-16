import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete, apiPut } from "./api";
import { useRestaurantId } from "./hooks";

export type CorporateCompany = {
  id: number;
  restaurantId: number;
  name: string;
  gstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  billingEmail: string | null;
  paymentTerms: string;
  creditLimit: string;
  approvalThreshold: string;
  monthlyBudget: string | null;
  billingCycleDay: number;
  autoSuspendOnOverdue: boolean;
  status: string;
  notes: string | null;
};

export type CorporateCompanyDetail = CorporateCompany & {
  outstandingBalance: string;
  monthSpend: string;
  monthOrderCount: number;
};

export type CorporateDepartment = {
  id: number;
  companyId: number;
  name: string;
  costCenter: string | null;
  monthlyLimit: string | null;
  isActive: boolean;
};

export type CorporateEmployee = {
  id: number;
  companyId: number;
  departmentId: number | null;
  departmentName: string | null;
  customerId: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  employeeCode: string | null;
  role: string;
  perMealLimit: string | null;
  monthlyLimit: string | null;
  isActive: boolean;
};

export type CorporateBulkOrder = {
  id: number;
  companyId: number;
  companyName: string | null;
  type: string;
  title: string;
  scheduledAt: string;
  headcount: number | null;
  status: string;
  quotedAmount: string | null;
  confirmedAmount: string | null;
  deliveryAddress: string | null;
  cutoffAt: string | null;
  shareToken: string | null;
};

export type CorporateScheduledOrder = {
  id: number;
  companyId: number;
  companyName: string | null;
  employeeId: number | null;
  employeeName: string | null;
  title: string;
  recurrence: string;
  weekday: number | null;
  scheduledTime: string;
  startDate: string;
  endDate: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  status: string;
  items: Array<{ menuItemId: number; name: string; quantity: number; unitPrice: string; notes?: string }>;
  deliveryAddress: string | null;
};

export type CorporateApproval = {
  id: number;
  companyId: number;
  companyName: string | null;
  orderId: number | null;
  bulkOrderId: number | null;
  requestedByEmployeeId: number | null;
  requestedByName: string | null;
  amount: string;
  status: string;
  decidedAt: string | null;
  comment: string | null;
  createdAt: string;
};

export type CorporateInvoice = {
  id: number;
  invoiceNumber: string;
  companyId: number;
  companyName: string | null;
  periodStart: string;
  periodEnd: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  status: string;
  dueDate: string;
  issuedAt: string | null;
  paymentTerms: string;
};

export type CorporateInvoiceDetail = CorporateInvoice & {
  lines: Array<{ id: number; description: string; orderedAt: string | null; amount: string; departmentId: number | null }>;
  payments: Array<{ id: number; amount: string; method: string; reference: string | null; paidAt: string }>;
  departmentBreakdown?: Array<{ departmentId: number | null; departmentName: string; orderCount: number; subtotal: string }> | null;
  notes?: string | null;
};

export type CorporateDashboard = {
  activeCompanies: number;
  activeEmployees: number;
  monthRevenue: string;
  monthOrders: number;
  outstandingTotal: string;
  outstandingInvoices: number;
  pendingApprovals: number;
  topCompanies: Array<{ companyId: number; companyName: string; revenue: string; orders: number }>;
};

const base = (rid: number, p: string) => `/restaurants/${rid}/corporate${p}`;

export function useCorporateDashboard() {
  const rid = useRestaurantId();
  return useQuery({ queryKey: ["corp-dashboard", rid], queryFn: () => apiGet<CorporateDashboard>(base(rid, "/dashboard")) });
}

export function useCorporateCompanies() {
  const rid = useRestaurantId();
  return useQuery({ queryKey: ["corp-companies", rid], queryFn: () => apiGet<CorporateCompany[]>(base(rid, "/companies")) });
}

export function useCorporateCompany(id: number | null) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["corp-company", rid, id],
    queryFn: () => apiGet<CorporateCompanyDetail>(base(rid, `/companies/${id}`)),
    enabled: id != null,
  });
}

export function useCreateCompany() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CorporateCompany>) => apiPost<CorporateCompany>(base(rid, "/companies"), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-companies", rid] }),
  });
}

export function useUpdateCompany(id: number) {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CorporateCompany>) => apiPatch<CorporateCompany>(base(rid, `/companies/${id}`), input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["corp-companies", rid] });
      qc.invalidateQueries({ queryKey: ["corp-company", rid, id] });
    },
  });
}

export function useDeactivateCompany() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete(base(rid, `/companies/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-companies", rid] }),
  });
}

export function useDepartments(companyId: number | null) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["corp-departments", rid, companyId],
    queryFn: () => apiGet<CorporateDepartment[]>(base(rid, `/companies/${companyId}/departments`)),
    enabled: companyId != null,
  });
}

export function useCreateDepartment(companyId: number) {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CorporateDepartment>) =>
      apiPost<CorporateDepartment>(base(rid, `/companies/${companyId}/departments`), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-departments", rid, companyId] }),
  });
}

export function useEmployees(companyId: number | null) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["corp-employees", rid, companyId],
    queryFn: () => apiGet<CorporateEmployee[]>(base(rid, `/companies/${companyId}/employees`)),
    enabled: companyId != null,
  });
}

export function useCreateEmployee(companyId: number) {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CorporateEmployee>) =>
      apiPost<CorporateEmployee>(base(rid, `/companies/${companyId}/employees`), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-employees", rid, companyId] }),
  });
}

export function useUpdateEmployee(companyId: number) {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<CorporateEmployee> & { id: number }) =>
      apiPatch<CorporateEmployee>(base(rid, `/employees/${id}`), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-employees", rid, companyId] }),
  });
}

export function useBulkImportEmployees(companyId: number) {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: Array<Record<string, unknown>>) =>
      apiPost<{ created: number }>(base(rid, `/companies/${companyId}/employees/bulk`), { rows }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-employees", rid, companyId] }),
  });
}

export function useApprovals(filters: { status?: string; companyId?: number } = {}) {
  const rid = useRestaurantId();
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.companyId) qs.set("companyId", String(filters.companyId));
  const search = qs.toString();
  return useQuery({
    queryKey: ["corp-approvals", rid, filters],
    queryFn: () => apiGet<CorporateApproval[]>(base(rid, `/approvals${search ? `?${search}` : ""}`)),
  });
}

export function useDecideApproval() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, comment }: { id: number; decision: "approved" | "rejected"; comment?: string }) =>
      apiPost(base(rid, `/approvals/${id}/decide`), { decision, comment }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-approvals", rid] }),
  });
}

export function useBulkOrders(filters: { companyId?: number; status?: string } = {}) {
  const rid = useRestaurantId();
  const qs = new URLSearchParams();
  if (filters.companyId) qs.set("companyId", String(filters.companyId));
  if (filters.status) qs.set("status", filters.status);
  const search = qs.toString();
  return useQuery({
    queryKey: ["corp-bulk", rid, filters],
    queryFn: () => apiGet<CorporateBulkOrder[]>(base(rid, `/bulk-orders${search ? `?${search}` : ""}`)),
  });
}

export function useCreateBulkOrder() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => apiPost<CorporateBulkOrder>(base(rid, "/bulk-orders"), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-bulk", rid] }),
  });
}

export function useConfirmBulkOrder() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiPost(base(rid, `/bulk-orders/${id}/confirm`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-bulk", rid] }),
  });
}

export function useScheduledOrders(companyId?: number) {
  const rid = useRestaurantId();
  const qs = companyId ? `?companyId=${companyId}` : "";
  return useQuery({
    queryKey: ["corp-scheduled", rid, companyId ?? null],
    queryFn: () => apiGet<CorporateScheduledOrder[]>(base(rid, `/scheduled-orders${qs}`)),
  });
}

export function useCreateScheduledOrder() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      apiPost<CorporateScheduledOrder>(base(rid, "/scheduled-orders"), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-scheduled", rid] }),
  });
}

export function useUpdateScheduledOrder() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Record<string, unknown>) =>
      apiPatch<CorporateScheduledOrder>(base(rid, `/scheduled-orders/${id}`), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-scheduled", rid] }),
  });
}

export function useRunDueScheduled() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ ok: boolean; materialised: number }>(base(rid, "/scheduled-orders/run-due")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-scheduled", rid] }),
  });
}

export function useInvoices(filters: { companyId?: number; status?: string } = {}) {
  const rid = useRestaurantId();
  const qs = new URLSearchParams();
  if (filters.companyId) qs.set("companyId", String(filters.companyId));
  if (filters.status) qs.set("status", filters.status);
  const search = qs.toString();
  return useQuery({
    queryKey: ["corp-invoices", rid, filters],
    queryFn: () => apiGet<CorporateInvoice[]>(base(rid, `/invoices${search ? `?${search}` : ""}`)),
  });
}

export function useInvoice(id: number | null) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ["corp-invoice", rid, id],
    queryFn: () => apiGet<CorporateInvoiceDetail>(base(rid, `/invoices/${id}`)),
    enabled: id != null,
  });
}

export function useGenerateInvoice() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, periodStart, periodEnd }: { companyId: number; periodStart?: string; periodEnd?: string }) =>
      apiPost<CorporateInvoice>(base(rid, `/companies/${companyId}/generate-invoice`), { periodStart, periodEnd }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corp-invoices", rid] }),
  });
}

export function useRecordPayment() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, ...body }: { invoiceId: number; amount: string; method?: string; reference?: string; notes?: string }) =>
      apiPost(base(rid, `/invoices/${invoiceId}/payments`), body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["corp-invoices", rid] });
      qc.invalidateQueries({ queryKey: ["corp-invoice", rid] });
    },
  });
}

export function useSendInvoiceReminder() {
  const rid = useRestaurantId();
  return useMutation({
    mutationFn: (invoiceId: number) => apiPost(base(rid, `/invoices/${invoiceId}/send-reminder`)),
  });
}

export function useTagOrderCorporate() {
  const rid = useRestaurantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { orderId: number; companyId: number; departmentId?: number; employeeId?: number }) =>
      apiPost(base(rid, "/tag-order"), input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["corp-dashboard", rid] });
      qc.invalidateQueries({ queryKey: ["corp-approvals", rid] });
    },
  });
}
