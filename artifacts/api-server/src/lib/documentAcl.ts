import { and, eq, inArray } from "drizzle-orm";
import { db, documentPermissionsTable, documentCategoryDefaultsTable, type DocumentPermission } from "./db";

const FULL_ROLES = new Set(["owner"]);
const READ_ONLY_ROLES = new Set(["super_admin"]);
const READ_ONLY: DocumentPermission[] = ["view", "download"];
// Sane defaults applied when no row exists in document_category_defaults.
// Manager: full read/download on everything; edit/delete only on operational
// docs (invoice, vendor, staff, payroll, other). Accountant: read+download on
// finance docs (gst, tax, bank, payroll, invoice, insurance). Everyone else
// sees nothing unless explicitly granted.
const BUILTIN_ROLE_DEFAULTS: Record<string, Record<string, DocumentPermission[]>> = {
  manager: {
    fssai: ["view", "download"], gst: ["view", "download"], rent: ["view", "download"],
    staff: ["view", "download", "edit"], vendor: ["view", "download", "edit"],
    franchise: ["view", "download"], fire: ["view", "download"],
    bank: ["view", "download"], insurance: ["view", "download"], payroll: ["view", "download", "edit"],
    tax: ["view", "download"], invoice: ["view", "download", "edit"],
    compliance: ["view", "download"], other: ["view", "download", "edit"],
  },
  accountant: {
    gst: ["view", "download"], tax: ["view", "download"], bank: ["view", "download"],
    payroll: ["view", "download"], invoice: ["view", "download"], insurance: ["view", "download"],
  },
};

export type AclContext = {
  restaurantId: number;
  userId: number;
  role: string;
};

export type DocumentLike = {
  id: number;
  restaurantId: number;
  category: string;
  uploadedBy: number | null;
};

function builtinDefault(role: string, category: string): DocumentPermission[] {
  return BUILTIN_ROLE_DEFAULTS[role]?.[category] ?? [];
}

/**
 * Resolve the set of permissions a user has on a document. Evaluation order:
 *   1. cross-tenant → empty
 *   2. super_admin / owner / uploader → full set
 *   3. per-document grants (role+user) UNIONed with category defaults for role
 */
export async function resolvePermissions(
  ctx: AclContext,
  doc: DocumentLike,
): Promise<Set<DocumentPermission>> {
  if (doc.restaurantId !== ctx.restaurantId) return new Set();
  if (FULL_ROLES.has(ctx.role)) return new Set(["view", "download", "edit", "delete"]);
  if (READ_ONLY_ROLES.has(ctx.role)) return new Set(READ_ONLY);
  if (doc.uploadedBy === ctx.userId) return new Set(["view", "download", "edit", "delete"]);

  const out = new Set<DocumentPermission>();

  // Per-document explicit grants.
  const grants = await db
    .select()
    .from(documentPermissionsTable)
    .where(and(
      eq(documentPermissionsTable.restaurantId, ctx.restaurantId),
      eq(documentPermissionsTable.documentId, doc.id),
    ));
  for (const g of grants) {
    if (g.principalType === "role" && g.principalRef === ctx.role) out.add(g.permission as DocumentPermission);
    else if (g.principalType === "user" && g.principalRef === String(ctx.userId)) out.add(g.permission as DocumentPermission);
  }

  // Category defaults — DB row first, fall back to builtin defaults.
  const defaults = await db
    .select()
    .from(documentCategoryDefaultsTable)
    .where(and(
      eq(documentCategoryDefaultsTable.restaurantId, ctx.restaurantId),
      eq(documentCategoryDefaultsTable.category, doc.category),
      eq(documentCategoryDefaultsTable.role, ctx.role),
    ))
    .limit(1);
  const fromDefaults = defaults[0]
    ? (defaults[0].permissions as DocumentPermission[])
    : builtinDefault(ctx.role, doc.category);
  for (const p of fromDefaults) out.add(p);

  return out;
}

export async function canAccess(
  ctx: AclContext,
  doc: DocumentLike,
  required: DocumentPermission,
): Promise<boolean> {
  const perms = await resolvePermissions(ctx, doc);
  return perms.has(required);
}

/**
 * Bulk-resolve permissions for many docs in one query — used by the list endpoint
 * so the UI can decorate rows with allowed actions.
 */
export async function bulkResolvePermissions(
  ctx: AclContext,
  docs: DocumentLike[],
): Promise<Map<number, Set<DocumentPermission>>> {
  const result = new Map<number, Set<DocumentPermission>>();
  if (docs.length === 0) return result;
  // Cross-tenant guard — drop any doc that doesn't belong to this restaurant.
  const sameTenant = docs.filter(d => d.restaurantId === ctx.restaurantId);
  if (FULL_ROLES.has(ctx.role)) {
    for (const d of sameTenant) result.set(d.id, new Set(["view", "download", "edit", "delete"]));
    return result;
  }
  if (READ_ONLY_ROLES.has(ctx.role)) {
    for (const d of sameTenant) result.set(d.id, new Set(READ_ONLY));
    return result;
  }

  const docIds = sameTenant.map(d => d.id);
  if (docIds.length === 0) return result;
  const grants = await db
    .select()
    .from(documentPermissionsTable)
    .where(and(
      eq(documentPermissionsTable.restaurantId, ctx.restaurantId),
      inArray(documentPermissionsTable.documentId, docIds),
    ));
  const grantsByDoc = new Map<number, typeof grants>();
  for (const g of grants) {
    const arr = grantsByDoc.get(g.documentId) ?? [];
    arr.push(g);
    grantsByDoc.set(g.documentId, arr);
  }

  const categories = Array.from(new Set(docs.map(d => d.category)));
  const defaults = categories.length > 0
    ? await db.select().from(documentCategoryDefaultsTable).where(and(
        eq(documentCategoryDefaultsTable.restaurantId, ctx.restaurantId),
        inArray(documentCategoryDefaultsTable.category, categories),
        eq(documentCategoryDefaultsTable.role, ctx.role),
      ))
    : [];
  const defaultsByCat = new Map<string, DocumentPermission[]>();
  for (const d of defaults) defaultsByCat.set(d.category, d.permissions as DocumentPermission[]);

  for (const d of sameTenant) {
    if (d.uploadedBy === ctx.userId) {
      result.set(d.id, new Set(["view", "download", "edit", "delete"]));
      continue;
    }
    const perms = new Set<DocumentPermission>();
    for (const g of grantsByDoc.get(d.id) ?? []) {
      if (g.principalType === "role" && g.principalRef === ctx.role) perms.add(g.permission as DocumentPermission);
      else if (g.principalType === "user" && g.principalRef === String(ctx.userId)) perms.add(g.permission as DocumentPermission);
    }
    const fromDefaults = defaultsByCat.get(d.category) ?? builtinDefault(ctx.role, d.category);
    for (const p of fromDefaults) perms.add(p);
    result.set(d.id, perms);
  }
  return result;
}
