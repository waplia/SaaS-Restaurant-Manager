export interface Assignment {
  id: number;
  orderId: number;
  riderId: number;
  status: "assigned" | "picked_up" | "delivered" | "cancelled";
  codAmount: string;
  codCollected: boolean;
  codHandedIn: boolean;
  assignedAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  proofPhotoUrl: string | null;
  unavailableReason: string | null;
  unavailableAt: string | null;
  notes: string | null;
  order: {
    id: number;
    orderNumber: string;
    customerName: string | null;
    customerPhone: string | null;
    totalAmount: string;
    paymentStatus: string;
    paymentMethod: string | null;
    notes: string | null;
    deliveryAddress: string | null;
    deliveryLat: string | number | null;
    deliveryLng: string | number | null;
    status: string;
  };
  rider?: { id: number; name: string; phone: string | null };
}

export const STATUS_LABEL: Record<string, string> = {
  assigned: "Assigned",
  picked_up: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Returned",
};

export function statusBg(s: string) {
  if (s === "assigned") return "#dbeafe";
  if (s === "picked_up") return "#ede9fe";
  if (s === "delivered") return "#dcfce7";
  return "#fee2e2";
}
export function statusFg(s: string) {
  if (s === "assigned") return "#1d4ed8";
  if (s === "picked_up") return "#6d28d9";
  if (s === "delivered") return "#15803d";
  return "#b91c1c";
}
export function statusDot(s: string) {
  if (s === "assigned") return "#3b82f6";
  if (s === "picked_up") return "#8b5cf6";
  if (s === "delivered") return "#16a34a";
  return "#dc2626";
}

export function isToday(d: string | null | undefined): boolean {
  if (!d) return false;
  const x = new Date(d);
  const now = new Date();
  return x.getFullYear() === now.getFullYear()
    && x.getMonth() === now.getMonth()
    && x.getDate() === now.getDate();
}

export function fmtTime(d: string | null | undefined): string {
  if (!d) return "—";
  const x = new Date(d);
  return x.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Estimated time to deliver from the moment a rider has the order.
// We don't (yet) compute live traffic ETAs — this is a fixed SLA window
// from pickup/assignment so riders can see whether they're running late.
export const DELIVERY_SLA_MINUTES = 30;

export function etaFor(a: { status: string; pickedUpAt: string | null; assignedAt: string }): Date | null {
  if (a.status === "delivered" || a.status === "cancelled") return null;
  const base = a.pickedUpAt ?? a.assignedAt;
  if (!base) return null;
  const t = new Date(base);
  t.setMinutes(t.getMinutes() + DELIVERY_SLA_MINUTES);
  return t;
}

export function etaLabel(a: { status: string; pickedUpAt: string | null; assignedAt: string }): { text: string; late: boolean } | null {
  const eta = etaFor(a);
  if (!eta) return null;
  const now = new Date();
  const diffMin = Math.round((eta.getTime() - now.getTime()) / 60000);
  const time = eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffMin < 0) return { text: `ETA ${time} · ${Math.abs(diffMin)}m late`, late: true };
  if (diffMin < 60) return { text: `ETA ${time} · in ${diffMin}m`, late: false };
  return { text: `ETA ${time}`, late: false };
}

export const UNAVAILABLE_REASONS = [
  "Customer not answering",
  "Address not found",
  "Customer refused delivery",
  "Wrong address",
  "Customer asked to reschedule",
  "Other",
];
