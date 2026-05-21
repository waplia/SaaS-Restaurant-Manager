import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  staffTable,
  staffDocumentsTable,
  staffBankAccountsTable,
  staffAdvancesTable,
  auditLogsTable,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { ObjectStorageService } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const objectStorageService = new ObjectStorageService();

const router = Router();

// Privileged-only router scope: all HR/payroll data (PII, salary, documents,
// bank info) is restricted to owner/manager/super_admin. Non-privileged roles
// hitting any of these routes get 403.
router.use(
  "/restaurants/:restaurantId",
  requireRole("owner", "manager", "super_admin"),
  validateRestaurantAccess,
);

function maskAccountNumber(n: string | null | undefined): string | null {
  if (!n) return null;
  const s = String(n).replace(/\s+/g, "");
  if (s.length <= 4) return s;
  return `${"•".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

async function audit(restaurantId: number, userId: number | null, action: string, entity: string, entityId: number | null, details?: unknown, ip?: string) {
  try {
    await db.insert(auditLogsTable).values({
      restaurantId,
      userId,
      action,
      entity,
      entityId: entityId ?? undefined,
      details: details ? JSON.stringify(details) : undefined,
      ipAddress: ip,
    });
  } catch {
    // Audit failure should never break the request.
  }
}

async function loadStaffWithUser(restaurantId: number) {
  return db
    .select({
      id: staffTable.id,
      userId: usersTable.id,
      restaurantId: usersTable.restaurantId,
      employeeCode: staffTable.employeeCode,
      jobTitle: staffTable.jobTitle,
      department: staffTable.department,
      salary: staffTable.salary,
      salaryType: staffTable.salaryType,
      hiredAt: staffTable.hiredAt,
      dateOfBirth: staffTable.dateOfBirth,
      gender: staffTable.gender,
      address: staffTable.address,
      city: staffTable.city,
      state: staffTable.state,
      pincode: staffTable.pincode,
      emergencyContact: staffTable.emergencyContact,
      emergencyContactName: staffTable.emergencyContactName,
      emergencyContactRelation: staffTable.emergencyContactRelation,
      notes: staffTable.notes,
      isActive: staffTable.isActive,
      createdAt: staffTable.createdAt,
      updatedAt: staffTable.updatedAt,
      userName: usersTable.name,
      userEmail: usersTable.email,
      userPhone: usersTable.phone,
      userRole: usersTable.role,
      userAvatarUrl: usersTable.avatarUrl,
      userIsActive: usersTable.isActive,
      lastLoginAt: usersTable.lastLoginAt,
      outstandingAdvance: sql<string>`COALESCE((
        SELECT SUM(${staffAdvancesTable.amount} - ${staffAdvancesTable.settledAmount})
        FROM ${staffAdvancesTable}
        WHERE ${staffAdvancesTable.userId} = ${usersTable.id}
          AND ${staffAdvancesTable.restaurantId} = ${restaurantId}
      ), 0)`.as("outstanding_advance"),
    })
    .from(usersTable)
    .leftJoin(staffTable, and(eq(staffTable.userId, usersTable.id), eq(staffTable.restaurantId, restaurantId)))
    .where(eq(usersTable.restaurantId, restaurantId));
}

function flattenStaffRow(row: Awaited<ReturnType<typeof loadStaffWithUser>>[number]) {
  return {
    id: row.userId,
    staffId: row.id,
    name: row.userName,
    email: row.userEmail,
    phone: row.userPhone,
    role: row.userRole,
    avatarUrl: row.userAvatarUrl,
    isActive: row.userIsActive,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    employeeCode: row.employeeCode,
    jobTitle: row.jobTitle,
    department: row.department,
    salary: row.salary,
    salaryType: row.salaryType,
    hiredAt: row.hiredAt,
    dateOfBirth: row.dateOfBirth,
    gender: row.gender,
    address: row.address,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    emergencyContact: row.emergencyContact,
    emergencyContactName: row.emergencyContactName,
    emergencyContactRelation: row.emergencyContactRelation,
    notes: row.notes,
    outstandingAdvance: row.outstandingAdvance,
  };
}

router.get("/restaurants/:restaurantId/staff", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { role } = req.query;
  const rows = await loadStaffWithUser(restaurantId);
  let items = rows.map(flattenStaffRow);
  if (role) items = items.filter((r) => r.role === String(role));
  res.json(items);
});

router.get("/restaurants/:restaurantId/staff/:userId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const rows = await loadStaffWithUser(restaurantId);
  const row = rows.find((r) => r.userId === userId);
  if (!row) return void res.status(404).json({ error: "Not found" });
  res.json(flattenStaffRow(row));
});

const STAFF_FIELDS = [
  "employeeCode", "jobTitle", "department", "salary", "salaryType", "hiredAt",
  "dateOfBirth", "gender", "address", "city", "state", "pincode",
  "emergencyContact", "emergencyContactName", "emergencyContactRelation", "notes",
] as const;

type StaffPatch = Record<string, string | Date | null>;

function buildStaffPatch(body: Record<string, unknown>): StaffPatch {
  const out: StaffPatch = {};
  for (const f of STAFF_FIELDS) {
    if (f in body) {
      const v = body[f];
      if (f === "hiredAt" || f === "dateOfBirth") {
        out[f] = v ? new Date(String(v)) : null;
      } else {
        out[f] = (v === "" || v === undefined || v === null) ? null : String(v);
      }
    }
  }
  return out;
}

const ALLOWED_ROLES = ["owner", "manager", "waiter", "kitchen", "cashier", "delivery_executive", "hr_officer"];
const ALLOWED_SALARY_TYPES = ["fixed_monthly", "daily_wage", "hourly_wage", "commission", "custom"];

router.post("/restaurants/:restaurantId/staff", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body.role === "string" ? body.role : "waiter";
  const phone = typeof body.phone === "string" ? body.phone.trim() : null;

  if (!name) return void res.status(400).json({ error: "name is required" });
  if (!email) return void res.status(400).json({ error: "email is required" });
  if (!ALLOWED_ROLES.includes(role)) return void res.status(400).json({ error: "Invalid role" });
  if (role === "owner" && !req.user?.isSuperAdmin) return void res.status(403).json({ error: "Cannot assign owner role" });

  const [dup] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (dup) return void res.status(409).json({ error: "Email already in use" });

  // Generate a random password — the invited user is expected to reset via
  // the standard "forgot password" flow before logging in.
  const tempPassword = randomBytes(16).toString("hex");
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  // Inherit tenant from the inviter so the new staff is scoped to the same tenant.
  const [inviter] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.sub));
  const tenantId = inviter?.tenantId ?? null;

  const [user] = await db.insert(usersTable).values({
    name, email, passwordHash, role, phone, restaurantId, tenantId,
    isActive: true,
  }).returning();

  await db.insert(staffTable).values({ userId: user.id, restaurantId });
  await audit(restaurantId, req.user?.sub ?? null, "create", "staff", user.id, { email, role }, req.ip);

  const rows = await loadStaffWithUser(restaurantId);
  const row = rows.find((r) => r.userId === user.id);
  res.status(201).json(row ? flattenStaffRow(row) : { id: user.id, name, email, role });
});

router.delete("/restaurants/:restaurantId/staff/:userId", requireRole("owner", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.restaurantId !== restaurantId) return void res.status(404).json({ error: "Not found" });
  if (user.id === req.user?.sub) return void res.status(400).json({ error: "Cannot deactivate yourself" });
  // Soft-delete: deactivate the user account and bump the token version so
  // any active sessions are immediately invalidated. Hard delete is avoided
  // because users are referenced by orders/audit logs/etc.
  await db.update(usersTable)
    .set({ isActive: false, tokenVersion: sql`${usersTable.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  await audit(restaurantId, req.user?.sub ?? null, "delete", "staff", userId, { email: user.email }, req.ip);
  res.status(204).send();
});

router.patch("/restaurants/:restaurantId/staff/:userId", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.restaurantId !== restaurantId) {
    return void res.status(404).json({ error: "Not found" });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  // User-table fields (name/email/phone/role). Validate role against allow-list.
  const userPatch: Record<string, string | null> = {};
  if (typeof body.name === "string" && body.name.trim()) userPatch.name = body.name.trim();
  if (typeof body.email === "string" && body.email.trim()) userPatch.email = body.email.trim().toLowerCase();
  if ("phone" in body) {
    userPatch.phone = body.phone == null || body.phone === "" ? null : String(body.phone).trim();
  }
  if (typeof body.role === "string" && body.role) {
    if (!ALLOWED_ROLES.includes(body.role)) return void res.status(400).json({ error: "Invalid role" });
    // Prevent privilege escalation by non-super admins promoting to owner.
    if (body.role === "owner" && !req.user?.isSuperAdmin) return void res.status(403).json({ error: "Cannot assign owner role" });
    userPatch.role = body.role;
  }

  if (userPatch.email && userPatch.email !== user.email) {
    const [dup] = await db.select().from(usersTable).where(eq(usersTable.email, userPatch.email));
    if (dup && dup.id !== userId) return void res.status(409).json({ error: "Email already in use" });
  }

  if (Object.keys(userPatch).length > 0) {
    await db.update(usersTable).set({ ...userPatch, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  }

  if (typeof body.salaryType === "string" && body.salaryType && !ALLOWED_SALARY_TYPES.includes(body.salaryType)) {
    return void res.status(400).json({ error: "Invalid salaryType" });
  }

  const patch = buildStaffPatch(body);
  const [existing] = await db.select().from(staffTable).where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  if (existing) {
    if (Object.keys(patch).length > 0) {
      await db.update(staffTable).set({ ...patch, updatedAt: new Date() }).where(eq(staffTable.id, existing.id));
    }
  } else {
    await db.insert(staffTable).values({ userId, restaurantId, ...patch });
  }

  await audit(restaurantId, req.user?.sub ?? null, "update", "staff", userId, { user: userPatch, staff: patch }, req.ip);

  const rows = await loadStaffWithUser(restaurantId);
  const row = rows.find((r) => r.userId === userId);
  res.json(row ? flattenStaffRow(row) : null);
});

router.get("/restaurants/:restaurantId/staff/:userId/documents", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const [staff] = await db.select().from(staffTable).where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  if (!staff) return void res.json([]);
  const docs = await db.select().from(staffDocumentsTable).where(eq(staffDocumentsTable.staffId, staff.id)).orderBy(desc(staffDocumentsTable.createdAt));
  res.json(docs);
});

router.post("/restaurants/:restaurantId/staff/:userId/documents", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const { label, fileUrl, mimeType, sizeBytes } = req.body ?? {};
  if (!label || !fileUrl) return void res.status(400).json({ error: "label and fileUrl required" });
  if (typeof fileUrl !== "string" || !fileUrl.startsWith("/objects/")) {
    return void res.status(400).json({ error: "fileUrl must be a finalized /objects/ path" });
  }
  // Verify the uploaded object exists and is ACL-owned by this restaurant
  // (i.e. the client actually called /storage/uploads/finalize for it).
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(fileUrl);
    const acl = await getObjectAclPolicy(objectFile);
    if (!acl || acl.restaurantId !== String(restaurantId)) {
      return void res.status(403).json({ error: "Object not owned by this restaurant" });
    }
  } catch {
    return void res.status(400).json({ error: "Object not found — finalize upload first" });
  }

  let [staff] = await db.select().from(staffTable).where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  if (!staff) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user || user.restaurantId !== restaurantId) return void res.status(404).json({ error: "Staff not found" });
    [staff] = await db.insert(staffTable).values({ userId, restaurantId }).returning();
  }

  const [doc] = await db.insert(staffDocumentsTable).values({
    staffId: staff.id,
    restaurantId,
    label: String(label),
    fileUrl: String(fileUrl),
    mimeType: mimeType ? String(mimeType) : undefined,
    sizeBytes: sizeBytes ? Number(sizeBytes) : undefined,
    uploadedByUserId: req.user?.sub ?? undefined,
  }).returning();

  await audit(restaurantId, req.user?.sub ?? null, "create", "staff_document", doc.id, { staffId: staff.id, label }, req.ip);
  res.status(201).json(doc);
});

// Privileged role-gated download endpoint for HR documents. Streams the
// object only if the doc row + ACL both belong to this restaurant. This is
// stricter than the generic /storage/objects/* read which is restaurant-
// scoped but not role-scoped.
router.get("/restaurants/:restaurantId/staff/:userId/documents/:docId/download", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const docId = Number(req.params.docId);
  const [staff] = await db.select().from(staffTable).where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  if (!staff) return void res.status(404).json({ error: "Not found" });
  const [doc] = await db.select().from(staffDocumentsTable).where(and(eq(staffDocumentsTable.id, docId), eq(staffDocumentsTable.restaurantId, restaurantId), eq(staffDocumentsTable.staffId, staff.id)));
  if (!doc) return void res.status(404).json({ error: "Not found" });
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(doc.fileUrl);
    const acl = await getObjectAclPolicy(objectFile);
    if (!acl || acl.restaurantId !== String(restaurantId)) return void res.status(403).json({ error: "Forbidden" });
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    if (response.body) {
      const { Readable } = await import("node:stream");
      const nodeStream = Readable.fromWeb(response.body as never);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch {
    res.status(404).json({ error: "Object not found" });
  }
});

router.delete("/restaurants/:restaurantId/staff/:userId/documents/:docId", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const docId = Number(req.params.docId);
  const [staff] = await db.select().from(staffTable).where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  if (!staff) return void res.status(404).json({ error: "Not found" });
  const [doc] = await db.select().from(staffDocumentsTable).where(and(eq(staffDocumentsTable.id, docId), eq(staffDocumentsTable.restaurantId, restaurantId), eq(staffDocumentsTable.staffId, staff.id)));
  if (!doc) return void res.status(404).json({ error: "Not found" });
  await db.delete(staffDocumentsTable).where(eq(staffDocumentsTable.id, docId));
  await audit(restaurantId, req.user?.sub ?? null, "delete", "staff_document", docId, { label: doc.label }, req.ip);
  res.status(204).send();
});

router.get("/restaurants/:restaurantId/staff/:userId/bank", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const [staff] = await db.select().from(staffTable).where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  if (!staff) return void res.json(null);
  const [bank] = await db.select().from(staffBankAccountsTable).where(eq(staffBankAccountsTable.staffId, staff.id));
  if (!bank) return void res.json(null);
  const reveal = req.query.reveal === "1";
  res.json({
    ...bank,
    accountNumber: reveal ? bank.accountNumber : maskAccountNumber(bank.accountNumber),
    accountNumberMasked: maskAccountNumber(bank.accountNumber),
  });
});

router.put("/restaurants/:restaurantId/staff/:userId/bank", requireRole("owner", "manager", "super_admin"), async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const userId = Number(req.params.userId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { accountName, ifsc, bankName, upiId } = body;
  const accountNumberRaw = body.accountNumber;

  let [staff] = await db.select().from(staffTable).where(and(eq(staffTable.userId, userId), eq(staffTable.restaurantId, restaurantId)));
  if (!staff) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user || user.restaurantId !== restaurantId) return void res.status(404).json({ error: "Staff not found" });
    [staff] = await db.insert(staffTable).values({ userId, restaurantId }).returning();
  }

  const [existing] = await db.select().from(staffBankAccountsTable).where(eq(staffBankAccountsTable.staffId, staff.id));

  // Preserve existing account number unless the client explicitly sent a
  // non-empty new value. Reject masked placeholders so we never persist
  // bullets back into the column. Empty/omitted -> keep existing.
  let nextAccountNumber: string | null;
  if (accountNumberRaw === undefined || accountNumberRaw === null || accountNumberRaw === "") {
    nextAccountNumber = existing?.accountNumber ?? null;
  } else {
    const s = String(accountNumberRaw);
    if (/[•*]/.test(s)) {
      nextAccountNumber = existing?.accountNumber ?? null;
    } else {
      nextAccountNumber = s;
    }
  }

  const payload = {
    accountName: (accountName as string | null | undefined) ?? null,
    accountNumber: nextAccountNumber,
    ifsc: (ifsc as string | null | undefined) ?? null,
    bankName: (bankName as string | null | undefined) ?? null,
    upiId: (upiId as string | null | undefined) ?? null,
    updatedAt: new Date(),
  };

  let saved;
  if (existing) {
    [saved] = await db.update(staffBankAccountsTable).set(payload).where(eq(staffBankAccountsTable.id, existing.id)).returning();
  } else {
    [saved] = await db.insert(staffBankAccountsTable).values({ staffId: staff.id, restaurantId, ...payload }).returning();
  }

  await audit(restaurantId, req.user?.sub ?? null, existing ? "update" : "create", "staff_bank_account", saved.id, { staffId: staff.id }, req.ip);
  res.json({
    ...saved,
    accountNumber: maskAccountNumber(saved.accountNumber),
    accountNumberMasked: maskAccountNumber(saved.accountNumber),
  });
});

export default router;
