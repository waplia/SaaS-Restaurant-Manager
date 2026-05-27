/**
 * Single source of truth for how an order number is displayed across the
 * desktop POS — printed bills, KOTs, on-screen rails, modal titles, toasts.
 *
 * The server stores two numbers per order:
 *   - `orderNumber`        — long canonical id, e.g.
 *                            "KL-R1-MGROAD-20260527-DN-000020"
 *   - `orderDisplayNumber` — short operator-friendly id, e.g. "DN-20"
 *
 * Operators should never see the long form. We prefer `orderDisplayNumber`
 * and, as a defense for legacy or offline rows that only carry the long
 * form, strip the zero-padding from the trailing numeric segment
 * (e.g. "DN-000020" → "DN-20") so a stale row still prints sensibly.
 */
export function shortOrderNumber(
  o: { orderDisplayNumber?: string | null; orderNumber?: string | null } | null | undefined,
): string {
  if (!o) return "";
  const raw =
    (typeof o.orderDisplayNumber === "string" && o.orderDisplayNumber.trim()) ||
    (typeof o.orderNumber === "string" && o.orderNumber.trim()) ||
    "";
  if (!raw) return "";
  // Strip zero-padding from the LAST `-NNNN` segment only — the embedded
  // YYYYMMDD date and any other numeric segments are preserved.
  return raw.replace(/-(0+)(\d+)$/g, "-$2");
}
