// Strip zero-padding from the trailing numeric segment of an order number so
// guests, cashiers, kitchen staff, and operators see "DN-13" instead of
// "DN-000013" in every channel — push notifications, in-app notifications,
// SMS, WhatsApp, email, webhooks, audit logs, and bill print payloads.
//
// The regex is end-anchored so embedded numeric segments (e.g. the YYYYMMDD
// inside a long internal id `KL-R12-MAIN-20260527-DN-000123`) are preserved
// and only the *last* `-000NNN` group is shortened to `-NNN`.
//
// Mirrors the helpers in:
//   - artifacts/tabletrack-mobile/lib/orderNumber.ts
//   - artifacts/restaurant-platform/src/lib/utils.ts
//   - artifacts/customer-wallet/src/lib/utils.ts
//
// `formatOrderNumber` is a no-op when the input has no leading-zero block, so
// it's safe to wrap any orderNumber/orderDisplayNumber site unconditionally.
export function formatOrderNumber(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  return String(value).replace(/-(0+)(\d+)$/g, "-$2");
}

// Convenience for the common case of "prefer the short, per-day display
// number, fall back to the legacy global orderNumber". Use this when you
// have an order row loaded — staff care about the short DN-13 / TA-04
// number, not the long internal audit id.
export function displayOrderNumber(
  order: { orderDisplayNumber?: string | null; orderNumber?: string | null } | null | undefined,
): string {
  if (!order) return "";
  return formatOrderNumber(order.orderDisplayNumber ?? order.orderNumber ?? "");
}
