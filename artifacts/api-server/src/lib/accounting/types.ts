import type { AccountingTarget, AccountingDataset, AccountingFormat } from "../db";

export class ConfigurationRequiredError extends Error {
  readonly target: AccountingTarget;
  readonly missing: string[];
  constructor(target: AccountingTarget, missing: string[]) {
    super(`Configuration required for ${target}: missing ${missing.join(", ")}`);
    this.name = "ConfigurationRequiredError";
    this.target = target;
    this.missing = missing;
  }
}

export class MissingMappingError extends Error {
  readonly target: AccountingTarget;
  readonly kind: "tax" | "ledger" | "account";
  readonly key: string;
  constructor(target: AccountingTarget, kind: "tax" | "ledger" | "account", key: string) {
    super(`Missing ${kind} mapping for "${key}" on ${target}`);
    this.name = "MissingMappingError";
    this.target = target;
    this.kind = kind;
    this.key = key;
  }
}

export interface TargetCatalogEntry {
  target: AccountingTarget;
  label: string;
  description: string;
  /** Format renderers supported per dataset. First entry is the default. */
  formats: Record<AccountingDataset, AccountingFormat[]>;
  /** Human-readable connection field schema (key/label/secret?). */
  connectionFields: Array<{ key: string; label: string; required: boolean; secret?: boolean; placeholder?: string }>;
  /** True when the target supports an HTTP push (vs. file download only). */
  supportsPush: boolean;
}

export const TARGET_CATALOG: TargetCatalogEntry[] = [
  {
    target: "tally",
    label: "Tally (TallyPrime / Tally.ERP 9)",
    description: "Generates a Tally XML voucher file you can import via Gateway → Import Data.",
    formats: { sales: ["xml"], expense: ["xml"], purchase: ["xml"] },
    connectionFields: [
      { key: "companyName", label: "Tally company name", required: false, placeholder: "Acme Restaurants Pvt Ltd" },
    ],
    supportsPush: false,
  },
  {
    target: "zoho_books",
    label: "Zoho Books",
    description: "Push journals/invoices via Zoho Books REST API or download a Zoho-flavoured CSV.",
    formats: { sales: ["csv", "json"], expense: ["csv", "json"], purchase: ["csv", "json"] },
    connectionFields: [
      { key: "organizationId", label: "Zoho organization ID", required: true },
      { key: "clientId", label: "Client ID", required: true },
      { key: "clientSecret", label: "Client secret", required: true, secret: true },
      { key: "refreshToken", label: "OAuth refresh token", required: true, secret: true },
      { key: "region", label: "Region (com, in, eu, ...)", required: false, placeholder: "in" },
    ],
    supportsPush: true,
  },
  {
    target: "quickbooks",
    label: "QuickBooks",
    description: "QuickBooks .IIF for Desktop or REST push for QBO.",
    formats: { sales: ["iif", "csv", "json"], expense: ["iif", "csv", "json"], purchase: ["iif", "csv", "json"] },
    connectionFields: [
      { key: "realmId", label: "QBO realm/company ID", required: true },
      { key: "clientId", label: "Client ID", required: true },
      { key: "clientSecret", label: "Client secret", required: true, secret: true },
      { key: "refreshToken", label: "OAuth refresh token", required: true, secret: true },
    ],
    supportsPush: true,
  },
  {
    target: "busy",
    label: "BUSY Accounting",
    description: "BUSY voucher XML import file.",
    formats: { sales: ["xml"], expense: ["xml"], purchase: ["xml"] },
    connectionFields: [
      { key: "companyName", label: "BUSY company name", required: false },
    ],
    supportsPush: false,
  },
  {
    target: "marg",
    label: "Marg ERP",
    description: "Marg-compatible CSV export.",
    formats: { sales: ["csv"], expense: ["csv"], purchase: ["csv"] },
    connectionFields: [
      { key: "companyCode", label: "Marg company code", required: false },
    ],
    supportsPush: false,
  },
  {
    target: "vyapar",
    label: "Vyapar",
    description: "Vyapar JSON / Excel-friendly CSV.",
    formats: { sales: ["json", "csv"], expense: ["json", "csv"], purchase: ["json", "csv"] },
    connectionFields: [
      { key: "businessName", label: "Vyapar business name", required: false },
    ],
    supportsPush: false,
  },
  {
    target: "gst",
    label: "GST returns (GSTR-1 / GSTR-3B)",
    description: "GSTR-1 friendly CSV grouped by GST rate.",
    formats: { sales: ["csv", "json"], expense: ["csv", "json"], purchase: ["csv", "json"] },
    connectionFields: [
      { key: "gstin", label: "Restaurant GSTIN", required: true, placeholder: "29ABCDE1234F1Z5" },
      { key: "returnPeriod", label: "Default return period (MMYYYY)", required: false, placeholder: "052026" },
    ],
    supportsPush: false,
  },
  {
    target: "excel",
    label: "Excel (.xlsx)",
    description: "Generic spreadsheet export usable by any accountant.",
    formats: { sales: ["xlsx"], expense: ["xlsx"], purchase: ["xlsx"] },
    connectionFields: [],
    supportsPush: false,
  },
  {
    target: "api",
    label: "Generic API",
    description: "POST the dataset as JSON to any HTTPS endpoint with a bearer token.",
    formats: { sales: ["json"], expense: ["json"], purchase: ["json"] },
    connectionFields: [
      { key: "endpointUrl", label: "Endpoint URL", required: true, placeholder: "https://erp.example.com/import" },
      { key: "bearerToken", label: "Bearer token", required: true, secret: true },
      { key: "extraHeaders", label: "Extra headers (key:value, comma separated)", required: false },
    ],
    supportsPush: true,
  },
];

export function getTargetCatalog(target: AccountingTarget): TargetCatalogEntry {
  const entry = TARGET_CATALOG.find((t) => t.target === target);
  if (!entry) throw new Error(`Unknown accounting target: ${target}`);
  return entry;
}

export function defaultFormat(target: AccountingTarget, dataset: AccountingDataset): AccountingFormat {
  return getTargetCatalog(target).formats[dataset][0]!;
}
