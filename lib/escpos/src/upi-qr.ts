export interface UpiQrInput {
  /** Payee VPA, e.g. `restaurant@hdfcbank` */
  vpa: string;
  /** Payee name as it should appear in the bank/UPI app. */
  name: string;
  /** Amount in major units (e.g. rupees). Pass `null` for "tip"-only UPI links. */
  amount: number | null;
  /** Currency, default INR. */
  currency?: string;
  /** Free-form reference id surfaced to the customer (e.g. invoice number). */
  ref?: string | null;
  /** Optional note printed under the QR. */
  note?: string | null;
}

/**
 * Builds a `upi://pay?...` payload per NPCI Bharat QR spec used by GPay,
 * PhonePe, Paytm, BHIM and bank apps. Caller is responsible for printing.
 */
export function buildUpiPayUrl(input: UpiQrInput): string {
  if (!input.vpa) throw new Error("UPI VPA is required");
  const params = new URLSearchParams();
  params.set("pa", input.vpa);
  params.set("pn", input.name || "Merchant");
  if (input.amount != null && Number.isFinite(input.amount) && input.amount > 0) {
    params.set("am", input.amount.toFixed(2));
  }
  params.set("cu", input.currency || "INR");
  if (input.ref) {
    params.set("tn", String(input.note ?? `Bill ${input.ref}`).slice(0, 80));
    params.set("tr", String(input.ref).slice(0, 35));
  } else if (input.note) {
    params.set("tn", String(input.note).slice(0, 80));
  }
  return "upi://pay?" + params.toString();
}
