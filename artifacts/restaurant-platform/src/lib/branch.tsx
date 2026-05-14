import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import { useAuth } from "./auth";

export interface BranchOption {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  logoUrl: string | null;
  isActive: boolean;
}

interface BranchContextValue {
  tenantId: number | null;
  branches: BranchOption[];
  isLoading: boolean;
  selectedBranchId: number | null; // null = "All branches"
  setSelectedBranchId: (id: number | null) => void;
  isAllBranches: boolean;
  hasMultipleBranches: boolean;
  /**
   * True when the current user is allowed to view tenant-wide consolidated
   * data (owners, managers, super-admins). When false, branch-aware hooks
   * must fall back to the per-restaurant endpoints regardless of the
   * selected branch — the tenant endpoints will return 403 for these
   * roles.
   */
  canConsolidate: boolean;
}

const CONSOLIDATING_ROLES = new Set(["owner", "manager", "super_admin"]);

const Ctx = createContext<BranchContextValue | null>(null);

const STORAGE_KEY = "tt_selected_branch_v1";

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const tenantId = user?.tenantId ?? null;
  const canConsolidate = !!user && (user.isSuperAdmin || (typeof user.role === "string" && CONSOLIDATING_ROLES.has(user.role)));

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["branches", tenantId],
    queryFn: () => apiGet<BranchOption[]>(`/tenants/${tenantId}/branches`),
    enabled: isAuthenticated && tenantId != null && canConsolidate,
    staleTime: 60000,
  });

  const [selectedBranchId, setSelectedBranchIdState] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { tenantId: number | null; branchId: number | null };
      // Only honour persisted selection when it was stored for the same
      // tenant the user is currently authenticated against; otherwise a
      // tenant switch could carry forward a forbidden branchId.
      if (v.tenantId !== tenantId) return null;
      return v.branchId;
    } catch { return null; }
  });

  // Users who cannot consolidate (waiter/kitchen/etc.) must never drive a
  // branch selection — their JWT is pinned to a single restaurant and any
  // persisted `selectedBranchId` would be ignored by the access checks
  // anyway. Clear it so the rest of the app behaves consistently.
  useEffect(() => {
    if (!canConsolidate && selectedBranchId != null) {
      setSelectedBranchIdState(null);
    }
  }, [canConsolidate, selectedBranchId]);

  // If the stored selection doesn't belong to the current user's accessible
  // branches (e.g. forged via localStorage, or removed from the tenant),
  // reset it to "all".
  useEffect(() => {
    if (isLoading || branches.length === 0) return;
    if (selectedBranchId != null && !branches.some(b => b.id === selectedBranchId)) {
      setSelectedBranchIdState(null);
    }
  }, [branches, isLoading, selectedBranchId]);

  const setSelectedBranchId = useCallback((id: number | null) => {
    setSelectedBranchIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tenantId, branchId: id }));
    } catch { /* ignore */ }
  }, [tenantId]);

  const value = useMemo<BranchContextValue>(() => ({
    tenantId,
    branches,
    isLoading,
    selectedBranchId,
    setSelectedBranchId,
    // Only owners/managers/super-admins can view "all branches" consolidated
    // data — other roles (waiter, kitchen, ...) are always pinned to their
    // own restaurant so the tenant endpoints (which require those roles)
    // are never called for them.
    isAllBranches: canConsolidate && selectedBranchId == null,
    hasMultipleBranches: canConsolidate && branches.length > 1,
    canConsolidate,
  }), [tenantId, branches, isLoading, selectedBranchId, setSelectedBranchId, canConsolidate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBranchContext(): BranchContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Allow consumption outside the provider (e.g. login screens) with a
    // safe no-op default rather than crashing.
    return {
      tenantId: null,
      branches: [],
      isLoading: false,
      selectedBranchId: null,
      setSelectedBranchId: () => undefined,
      isAllBranches: false,
      hasMultipleBranches: false,
      canConsolidate: false,
    };
  }
  return ctx;
}
