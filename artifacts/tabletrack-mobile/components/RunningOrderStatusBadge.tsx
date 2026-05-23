import React from "react";
import { AppBadge, type AppBadgeTone } from "@/components/ui";

export type RunningOrderState =
  | "open"
  | "running"
  | "bill_requested"
  | "bill_generated"
  | "partial"
  | "paid"
  | "completed"
  | "cancelled";

interface Props {
  /** Order status from API (e.g. pending, in_progress, bill_generated, completed, cancelled). */
  status: string;
  /** Payment status from API (unpaid, partial, paid). */
  paymentStatus?: string;
  /** Whether this is a running order (multi-KOT, single bill). */
  isRunningOrder?: boolean;
}

function resolveState(p: Props): RunningOrderState {
  const s = (p.status ?? "").toLowerCase();
  const ps = (p.paymentStatus ?? "").toLowerCase();
  if (ps === "paid" || s === "completed") return "paid";
  if (ps === "partial") return "partial";
  if (s === "cancelled") return "cancelled";
  if (s === "bill_generated" || s === "bill_requested") return "bill_requested";
  if (p.isRunningOrder) return "running";
  return "open";
}

const META: Record<RunningOrderState, { label: string; tone: AppBadgeTone }> = {
  open: { label: "Open", tone: "info" },
  running: { label: "Running", tone: "warning" },
  bill_requested: { label: "Bill Requested", tone: "primary" },
  bill_generated: { label: "Bill Generated", tone: "primary" },
  partial: { label: "Partial", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export function RunningOrderStatusBadge(props: Props) {
  const state = resolveState(props);
  const m = META[state];
  return <AppBadge label={m.label} tone={m.tone} variant="soft" />;
}
