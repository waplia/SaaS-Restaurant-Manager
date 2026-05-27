import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Strip zero-padding from the trailing numeric segment of an order number,
// e.g. "DN-000013" → "DN-13" and "KL-…-DN-000123" → "KL-…-DN-123". The regex
// is end-anchored so embedded numeric segments (like dates in internal ids)
// are left alone.
export function formatOrderNumber(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  return String(value).replace(/-(0+)(\d+)$/g, "-$2");
}
