// Strip zero-padding from the trailing numeric segment of an order number so
// operators see "DN-13" instead of "DN-000013". Used everywhere we render an
// `orderDisplayNumber`, `orderInternalNumber`, or legacy `orderNumber`. The
// regex is end-anchored so embedded numeric segments (e.g. the YYYYMMDD date
// inside a long internal id) are preserved.
export function formatOrderNumber(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  return String(value).replace(/-(0+)(\d+)$/g, "-$2");
}
