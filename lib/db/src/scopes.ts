/**
 * Catalog of API scopes that can be attached to API keys. Each scope grants
 * a specific permission on the public REST API surface (mounted at /api/v1).
 *
 * Keys with an empty `scopes` array fall back to legacy full-access mode for
 * backward compatibility with keys minted before scope support.
 */
export interface ApiScopeDef {
  key: string;
  label: string;
  description: string;
  category: "core" | "menu" | "orders" | "customers" | "webhooks" | "payments";
  write: boolean;
}

export const API_SCOPES: ApiScopeDef[] = [
  { key: "restaurant.read",  label: "Read restaurant",  description: "Read basic profile of the linked restaurant.",       category: "core",      write: false },
  { key: "orders.read",      label: "Read orders",      description: "List and fetch orders.",                              category: "orders",    write: false },
  { key: "orders.write",     label: "Manage orders",    description: "(Reserved) Create or update orders via API.",         category: "orders",    write: true  },
  { key: "menu.read",        label: "Read menu",        description: "Fetch menu items, categories and modifiers.",        category: "menu",      write: false },
  { key: "menu.write",       label: "Manage menu",      description: "(Reserved) Update menu items, prices and availability.", category: "menu",  write: true  },
  { key: "customers.read",   label: "Read customers",   description: "List and fetch customer profiles.",                   category: "customers", write: false },
  { key: "customers.write",  label: "Manage customers", description: "(Reserved) Create or update customer records.",       category: "customers", write: true  },
  { key: "payments.read",    label: "Read payments",    description: "(Reserved) Read payment records linked to orders.",   category: "payments",  write: false },
  { key: "webhooks.read",    label: "Read webhooks",    description: "(Reserved) Read webhook endpoint configuration.",     category: "webhooks",  write: false },
];

export const API_SCOPE_KEYS: readonly string[] = API_SCOPES.map(s => s.key);

export function isValidScope(scope: string): boolean {
  return API_SCOPE_KEYS.includes(scope);
}

export function filterValidScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return [];
  const out = new Set<string>();
  for (const s of scopes) {
    if (typeof s === "string" && isValidScope(s)) out.add(s);
  }
  return Array.from(out);
}

/**
 * Default scopes granted to keys created without explicit scopes — a safe
 * read-only baseline (legacy behaviour mirrored).
 */
export const DEFAULT_LIVE_SCOPES: readonly string[] = [
  "restaurant.read",
  "orders.read",
  "menu.read",
  "customers.read",
];
