import { Router } from "express";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  chartOfAccountsTable,
  accountingPeriodsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  vendorBillsTable,
  vendorBillLinesTable,
  vendorBillPaymentsTable,
  arInvoicesTable,
  bookLedgerRulesTable,
  COA_TEMPLATE_DEFS,
  COA_TEMPLATES,
  ACCOUNT_TYPES,
  JOURNAL_SOURCES,
  RULE_SOURCES,
  type AccountType,
  type CoaTemplate,
  type ChartOfAccount,
  type JournalSource,
  type VendorBillStatus,
} from "../lib/db";
import { requireRole } from "../middleware/authorize";
import { validateRestaurantAccess } from "../middleware/restaurantAccess";
import { requirePlanFeature } from "../middleware/planFeature";
import { recordAuditLog } from "../lib/audit";

const router = Router();
const FEATURE = "accounting_back_office";
const ROLES = ["owner", "manager", "accountant", "super_admin"] as const;

router.use(
  "/restaurants/:restaurantId/accounting-books",
  requireRole(...ROLES),
  validateRestaurantAccess,
  requirePlanFeature(FEATURE),
);

const D = (v: number | string): string => Number(v).toFixed(2);

// ─── Tenant-isolation helper for account IDs ──────────────────────────
async function assertAccountsBelong(
  restaurantId: number,
  accountIds: Array<number | null | undefined>,
): Promise<void> {
  const ids = Array.from(new Set(accountIds.filter((x): x is number => typeof x === "number" && x > 0)));
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(and(eq(chartOfAccountsTable.restaurantId, restaurantId), inArray(chartOfAccountsTable.id, ids)));
  if (rows.length !== ids.length) {
    throw Object.assign(new Error("invalid_accounts"), { code: "invalid_accounts" });
  }
}

// ─── Period lock helper ───────────────────────────────────────────────
async function assertPeriodOpen(restaurantId: number, entryDate: string): Promise<void> {
  const [closed] = await db
    .select({ id: accountingPeriodsTable.id })
    .from(accountingPeriodsTable)
    .where(
      and(
        eq(accountingPeriodsTable.restaurantId, restaurantId),
        eq(accountingPeriodsTable.status, "closed"),
        lte(accountingPeriodsTable.periodStart, entryDate),
        gte(accountingPeriodsTable.periodEnd, entryDate),
      ),
    )
    .limit(1);
  if (closed) throw new Error("period_closed");
}

// ─── Chart of Accounts ────────────────────────────────────────────────
router.get("/restaurants/:restaurantId/accounting-books/coa", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.restaurantId, restaurantId))
    .orderBy(chartOfAccountsTable.code);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/accounting-books/coa/seed", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = z.object({ template: z.enum(COA_TEMPLATES) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid_template" }); return; }
  const template = parsed.data.template;

  const existing = await db
    .select({ code: chartOfAccountsTable.code })
    .from(chartOfAccountsTable)
    .where(eq(chartOfAccountsTable.restaurantId, restaurantId));
  const have = new Set(existing.map((r) => r.code));

  const toInsert = COA_TEMPLATE_DEFS[template].accounts
    .filter((a) => !have.has(a.code))
    .map((a) => ({
      restaurantId,
      code: a.code,
      name: a.name,
      type: a.type,
      normalBalance: a.normalBalance,
      isSystem: a.isSystem ?? false,
    }));

  let inserted: ChartOfAccount[] = [];
  if (toInsert.length > 0) {
    inserted = await db.insert(chartOfAccountsTable).values(toInsert).returning();
  }
  await recordAuditLog({
    req,
    module: "accounting_books",
    action: "coa.seed",
    entity: "chart_of_accounts",
    restaurantId,
    newValue: { template, inserted: inserted.length, total: COA_TEMPLATE_DEFS[template].accounts.length },
  });
  res.json({ inserted: inserted.length, accounts: inserted });
});

router.post("/restaurants/:restaurantId/accounting-books/coa", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const schema = z.object({
    code: z.string().min(1).max(32),
    name: z.string().min(1).max(200),
    type: z.enum(ACCOUNT_TYPES),
    normalBalance: z.enum(["debit", "credit"]),
    parentId: z.number().int().nullable().optional(),
    description: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid", details: parsed.error.issues }); return; }
  try {
    const [row] = await db
      .insert(chartOfAccountsTable)
      .values({ ...parsed.data, restaurantId })
      .returning();
    await recordAuditLog({ req, module: "accounting_books", action: "coa.create", entity: "chart_of_accounts", entityId: row.id, restaurantId, newValue: row });
    res.status(201).json(row);
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "";
    if (msg.includes("coa_restaurant_code_uniq")) {
      res.status(409).json({ error: "code_exists" }); return;    }
    throw err;
  }
});

router.patch("/restaurants/:restaurantId/accounting-books/coa/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const schema = z.object({
    name: z.string().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
    description: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid" }); return; }
  const [row] = await db
    .update(chartOfAccountsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(chartOfAccountsTable.id, id), eq(chartOfAccountsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "not_found" }); return; }
  await recordAuditLog({ req, module: "accounting_books", action: "coa.update", entity: "chart_of_accounts", entityId: id, restaurantId, newValue: row });
  res.json(row);
});

router.get("/restaurants/:restaurantId/accounting-books/coa-templates", async (_req, res) => {
  res.json(
    Object.entries(COA_TEMPLATE_DEFS).map(([key, def]) => ({
      key,
      label: def.label,
      accountCount: def.accounts.length,
    })),
  );
});

// ─── Journal Entries ──────────────────────────────────────────────────
// Race-safe: compute next number from MAX(numeric suffix); the full
// (entry + lines) insert is wrapped in a transaction and retried at the
// outer level if a uniqueness violation occurs under concurrency.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

async function nextJournalNo(executor: DbOrTx, restaurantId: number): Promise<string> {
  const [row] = await executor
    .select({
      maxN: sql<number>`COALESCE(MAX(CAST(NULLIF(REGEXP_REPLACE(${journalEntriesTable.journalNo}, '\\D', '', 'g'), '') AS INTEGER)), 0)`,
    })
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.restaurantId, restaurantId));
  const n = Number(row?.maxN ?? 0) + 1;
  return `JE-${String(n).padStart(6, "0")}`;
}

type JournalLineInput = Omit<typeof journalEntryLinesTable.$inferInsert, "journalEntryId">;

/** Atomically inserts a journal entry + its lines. If called without `tx`,
 * wraps a fresh transaction per attempt and retries up to 5x on journal_no
 * unique-violation (postgres aborts the tx on the violation, so each retry
 * must be a fresh tx). */
export async function postJournalWithLines(
  values: Omit<typeof journalEntriesTable.$inferInsert, "journalNo">,
  lines: JournalLineInput[],
  tx?: Tx,
): Promise<typeof journalEntriesTable.$inferSelect> {
  const insertOnce = async (executor: DbOrTx) => {
    const journalNo = await nextJournalNo(executor, values.restaurantId);
    const [entry] = await executor
      .insert(journalEntriesTable)
      .values({ ...values, journalNo })
      .returning();
    if (lines.length > 0) {
      await executor.insert(journalEntryLinesTable).values(
        lines.map((l, i) => ({ ...l, journalEntryId: entry.id, lineOrder: l.lineOrder ?? i })),
      );
    }
    return entry;
  };

  if (tx) return insertOnce(tx);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.transaction((t) => insertOnce(t));
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "";
      if (msg.includes("journal_entries_restaurant_no_uniq") && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error("journal_no_collision");
}

/** Idempotent, fail-soft auto-post used by module hooks (POS, payroll, etc.).
 *  - Looks up the active ledger rule for (source, matchKey)
 *  - Skips silently when rule is missing/inactive, accounts unset, or period closed
 *  - Skips if an entry with same (restaurantId, source, sourceRef) already exists
 *  - Never throws — callers must not let accounting block their flow */
export async function triggerAutoPost(opts: {
  restaurantId: number;
  source: (typeof RULE_SOURCES)[number];
  sourceRef: string;
  entryDate: string;
  amount: number;
  matchKey?: string;
  memo?: string;
  userId?: number | null;
}): Promise<void> {
  try {
    if (!opts.amount || opts.amount <= 0) return;
    // Idempotency guard
    const [existing] = await db
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(
        and(
          eq(journalEntriesTable.restaurantId, opts.restaurantId),
          eq(journalEntriesTable.source, opts.source),
          eq(journalEntriesTable.sourceRef, opts.sourceRef),
        ),
      )
      .limit(1);
    if (existing) return;

    // Find a rule: prefer exact matchKey, fall back to wildcard "*"
    const candidates = await db
      .select()
      .from(bookLedgerRulesTable)
      .where(
        and(
          eq(bookLedgerRulesTable.restaurantId, opts.restaurantId),
          eq(bookLedgerRulesTable.source, opts.source),
          eq(bookLedgerRulesTable.isActive, true),
        ),
      );
    const rule =
      candidates.find((r) => r.matchKey === (opts.matchKey ?? "")) ??
      candidates.find((r) => r.matchKey === "*") ??
      candidates[0];
    if (!rule || !rule.debitAccountId || !rule.creditAccountId) return;

    try {
      await assertPeriodOpen(opts.restaurantId, opts.entryDate);
    } catch {
      return;
    }

    await postJournalWithLines(
      {
        restaurantId: opts.restaurantId,
        entryDate: opts.entryDate,
        source: opts.source,
        sourceRef: opts.sourceRef,
        memo: opts.memo ?? `Auto-post: ${opts.source}`,
        status: "posted",
        totalDebit: D(opts.amount),
        totalCredit: D(opts.amount),
        postedAt: new Date(),
        postedBy: opts.userId ?? null,
        createdBy: opts.userId ?? null,
      },
      [
        { accountId: rule.debitAccountId, debit: D(opts.amount), credit: "0.00", lineOrder: 0, memo: opts.memo ?? null },
        { accountId: rule.creditAccountId, debit: "0.00", credit: D(opts.amount), lineOrder: 1, memo: opts.memo ?? null },
      ],
    );
  } catch (err) {
    // Fail-soft: never let auto-post break the source flow
    console.warn("[accounting] triggerAutoPost failed", { source: opts.source, sourceRef: opts.sourceRef, err: (err as Error)?.message });
  }
}

router.get("/restaurants/:restaurantId/accounting-books/journals", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { from, to, source, status } = req.query as Record<string, string | undefined>;
  const conds = [eq(journalEntriesTable.restaurantId, restaurantId)];
  if (from) conds.push(gte(journalEntriesTable.entryDate, from));
  if (to) conds.push(lte(journalEntriesTable.entryDate, to));
  if (source) conds.push(eq(journalEntriesTable.source, source as JournalSource));
  if (status) conds.push(eq(journalEntriesTable.status, status as "draft" | "posted" | "void"));
  const rows = await db
    .select()
    .from(journalEntriesTable)
    .where(and(...conds))
    .orderBy(desc(journalEntriesTable.entryDate), desc(journalEntriesTable.id))
    .limit(500);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/accounting-books/journals/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [entry] = await db
    .select()
    .from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.restaurantId, restaurantId)));
  if (!entry) { res.status(404).json({ error: "not_found" }); return; }
  const lines = await db
    .select()
    .from(journalEntryLinesTable)
    .where(eq(journalEntryLinesTable.journalEntryId, id))
    .orderBy(journalEntryLinesTable.lineOrder);
  res.json({ ...entry, lines });
});

const lineSchema = z.object({
  accountId: z.number().int(),
  debit: z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
  memo: z.string().nullable().optional(),
});

const journalSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(JOURNAL_SOURCES).default("manual"),
  sourceRef: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  status: z.enum(["draft", "posted"]).default("draft"),
  lines: z.array(lineSchema).min(2),
});

router.post("/restaurants/:restaurantId/accounting-books/journals", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = journalSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid", details: parsed.error.issues }); return; }
  const { entryDate, source, sourceRef, memo, status, lines } = parsed.data;

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    res.status(400).json({ error: "unbalanced", totalDebit, totalCredit }); return;  }
  if (totalDebit <= 0) { res.status(400).json({ error: "zero_amount" }); return; }

  // Validate accounts belong to restaurant
  const accIds = Array.from(new Set(lines.map((l) => l.accountId)));
  const accs = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(and(eq(chartOfAccountsTable.restaurantId, restaurantId), inArray(chartOfAccountsTable.id, accIds)));
  if (accs.length !== accIds.length) { res.status(400).json({ error: "invalid_accounts" }); return; }

  if (status === "posted") {
    try {
      await assertPeriodOpen(restaurantId, entryDate);
    } catch {
      res.status(409).json({ error: "period_closed" }); return;    }
  }

  const userId = req.user?.sub ?? req.user?.id ?? null;

  const entry = await postJournalWithLines(
    {
      restaurantId,
      entryDate,
      source,
      sourceRef: sourceRef ?? null,
      memo: memo ?? null,
      status,
      totalDebit: D(totalDebit),
      totalCredit: D(totalCredit),
      postedAt: status === "posted" ? new Date() : null,
      postedBy: status === "posted" ? userId : null,
      createdBy: userId,
    },
    lines.map((l, i) => ({
      accountId: l.accountId,
      debit: D(l.debit || 0),
      credit: D(l.credit || 0),
      memo: l.memo ?? null,
      lineOrder: i,
    })),
  );

  await recordAuditLog({
    req,
    module: "accounting_books",
    action: status === "posted" ? "journal.post" : "journal.create_draft",
    entity: "journal_entries",
    entityId: entry.id,
    restaurantId,
    newValue: { journalNo: entry.journalNo, entryDate, source, totalDebit, totalCredit, lines: lines.length },
  });

  res.status(201).json(entry);
});

router.post("/restaurants/:restaurantId/accounting-books/journals/:id/post", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [entry] = await db
    .select()
    .from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.restaurantId, restaurantId)));
  if (!entry) { res.status(404).json({ error: "not_found" }); return; }
  if (entry.status !== "draft") { res.status(400).json({ error: "not_draft" }); return; }
  if (Math.abs(Number(entry.totalDebit) - Number(entry.totalCredit)) > 0.01) {
    res.status(400).json({ error: "unbalanced" }); return;  }
  try {
    await assertPeriodOpen(restaurantId, entry.entryDate);
  } catch {
    res.status(409).json({ error: "period_closed" }); return;  }
  const userId = req.user?.sub ?? req.user?.id ?? null;
  const [updated] = await db
    .update(journalEntriesTable)
    .set({ status: "posted", postedAt: new Date(), postedBy: userId, updatedAt: new Date() })
    .where(eq(journalEntriesTable.id, id))
    .returning();
  await recordAuditLog({ req, module: "accounting_books", action: "journal.post", entity: "journal_entries", entityId: id, restaurantId, newValue: updated });
  res.json(updated);
});

router.post("/restaurants/:restaurantId/accounting-books/journals/:id/void", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [entry] = await db
    .select()
    .from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.restaurantId, restaurantId)));
  if (!entry) { res.status(404).json({ error: "not_found" }); return; }
  try {
    await assertPeriodOpen(restaurantId, entry.entryDate);
  } catch {
    res.status(409).json({ error: "period_closed" }); return;  }
  const [updated] = await db
    .update(journalEntriesTable)
    .set({ status: "void", updatedAt: new Date() })
    .where(eq(journalEntriesTable.id, id))
    .returning();
  await recordAuditLog({ req, module: "accounting_books", action: "journal.void", entity: "journal_entries", entityId: id, restaurantId, oldValue: entry, newValue: updated });
  res.json(updated);
});

// ─── Auto-post from source (POS / payroll / inventory / refunds) ─────
router.post("/restaurants/:restaurantId/accounting-books/auto-post", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const schema = z.object({
    source: z.enum(RULE_SOURCES),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    matchKey: z.string().default("*"),
    amount: z.number().positive(),
    sourceRef: z.string().nullable().optional(),
    memo: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid" }); return; }
  const { source, entryDate, matchKey, amount, sourceRef, memo } = parsed.data;

  // Find rule (specific match first, then wildcard)
  const rules = await db
    .select()
    .from(bookLedgerRulesTable)
    .where(
      and(
        eq(bookLedgerRulesTable.restaurantId, restaurantId),
        eq(bookLedgerRulesTable.source, source),
        eq(bookLedgerRulesTable.isActive, true),
      ),
    );
  const rule = rules.find((r) => r.matchKey === matchKey) ?? rules.find((r) => r.matchKey === "*");
  if (!rule || !rule.debitAccountId || !rule.creditAccountId) {
    res.status(400).json({ error: "no_rule", message: "Configure a ledger mapping rule for this source." }); return;  }

  try {
    await assertPeriodOpen(restaurantId, entryDate);
  } catch {
    res.status(409).json({ error: "period_closed" }); return;  }

  const userId = req.user?.sub ?? req.user?.id ?? null;
  const entry = await postJournalWithLines(
    {
      restaurantId,
      entryDate,
      source,
      sourceRef: sourceRef ?? null,
      memo: memo ?? `Auto-post: ${source}`,
      status: "posted",
      totalDebit: D(amount),
      totalCredit: D(amount),
      postedAt: new Date(),
      postedBy: userId,
      createdBy: userId,
    },
    [
      { accountId: rule.debitAccountId, debit: D(amount), credit: "0.00", lineOrder: 0, memo: memo ?? null },
      { accountId: rule.creditAccountId, debit: "0.00", credit: D(amount), lineOrder: 1, memo: memo ?? null },
    ],
  );
  await recordAuditLog({
    req,
    module: "accounting_books",
    action: "journal.auto_post",
    entity: "journal_entries",
    entityId: entry.id,
    restaurantId,
    newValue: { source, matchKey, amount, ruleId: rule.id },
  });
  res.status(201).json(entry);
});

// ─── Ledger Mapping Rules ────────────────────────────────────────────
router.get("/restaurants/:restaurantId/accounting-books/rules", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(bookLedgerRulesTable)
    .where(eq(bookLedgerRulesTable.restaurantId, restaurantId))
    .orderBy(bookLedgerRulesTable.source, bookLedgerRulesTable.matchKey);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/accounting-books/rules", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const schema = z.object({
    source: z.enum(RULE_SOURCES),
    matchKey: z.string().default("*"),
    debitAccountId: z.number().int().nullable(),
    creditAccountId: z.number().int().nullable(),
    notes: z.string().nullable().optional(),
    isActive: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid" }); return; }

  try {
    await assertAccountsBelong(restaurantId, [parsed.data.debitAccountId, parsed.data.creditAccountId]);
  } catch {
    res.status(400).json({ error: "invalid_accounts" }); return;  }

  const [row] = await db
    .insert(bookLedgerRulesTable)
    .values({ ...parsed.data, restaurantId })
    .onConflictDoUpdate({
      target: [bookLedgerRulesTable.restaurantId, bookLedgerRulesTable.source, bookLedgerRulesTable.matchKey],
      set: {
        debitAccountId: parsed.data.debitAccountId,
        creditAccountId: parsed.data.creditAccountId,
        notes: parsed.data.notes ?? null,
        isActive: parsed.data.isActive,
        updatedAt: new Date(),
      },
    })
    .returning();
  await recordAuditLog({ req, module: "accounting_books", action: "rule.upsert", entity: "book_ledger_rules", entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

router.delete("/restaurants/:restaurantId/accounting-books/rules/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db
    .delete(bookLedgerRulesTable)
    .where(and(eq(bookLedgerRulesTable.id, id), eq(bookLedgerRulesTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "not_found" }); return; }
  await recordAuditLog({ req, module: "accounting_books", action: "rule.delete", entity: "book_ledger_rules", entityId: id, restaurantId, oldValue: row });
  res.json({ ok: true });
});

// ─── Vendor Bills (AP) ───────────────────────────────────────────────
const vendorBillSchema = z.object({
  billNo: z.string().min(1).max(64),
  vendorName: z.string().min(1).max(200),
  vendorEmail: z.string().email().nullable().optional(),
  vendorGstin: z.string().nullable().optional(),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  apAccountId: z.number().int().nullable().optional(),
  expenseAccountId: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().positive().default(1),
        unitPrice: z.number().nonnegative(),
        taxRate: z.number().min(0).max(100).default(0),
        accountId: z.number().int().nullable().optional(),
      }),
    )
    .min(1),
});

router.get("/restaurants/:restaurantId/accounting-books/vendor-bills", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const { status } = req.query as { status?: VendorBillStatus };
  const conds = [eq(vendorBillsTable.restaurantId, restaurantId)];
  if (status) conds.push(eq(vendorBillsTable.status, status));
  const rows = await db
    .select()
    .from(vendorBillsTable)
    .where(and(...conds))
    .orderBy(desc(vendorBillsTable.billDate), desc(vendorBillsTable.id))
    .limit(500);
  res.json(rows);
});

router.get("/restaurants/:restaurantId/accounting-books/vendor-bills/:id", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [bill] = await db
    .select()
    .from(vendorBillsTable)
    .where(and(eq(vendorBillsTable.id, id), eq(vendorBillsTable.restaurantId, restaurantId)));
  if (!bill) { res.status(404).json({ error: "not_found" }); return; }
  const lines = await db.select().from(vendorBillLinesTable).where(eq(vendorBillLinesTable.vendorBillId, id)).orderBy(vendorBillLinesTable.lineOrder);
  const payments = await db.select().from(vendorBillPaymentsTable).where(eq(vendorBillPaymentsTable.vendorBillId, id));
  res.json({ ...bill, lines, payments });
});

router.post("/restaurants/:restaurantId/accounting-books/vendor-bills", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = vendorBillSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid", details: parsed.error.issues }); return; }
  const { lines, ...header } = parsed.data;

  let subtotal = 0;
  let taxAmount = 0;
  const computed = lines.map((l, i) => {
    const line = l.quantity * l.unitPrice;
    const tax = (line * l.taxRate) / 100;
    subtotal += line;
    taxAmount += tax;
    return {
      description: l.description,
      quantity: D(l.quantity),
      unitPrice: D(l.unitPrice),
      taxRate: D(l.taxRate),
      lineTotal: D(line + tax),
      accountId: l.accountId ?? null,
      lineOrder: i,
    };
  });
  const totalAmount = subtotal + taxAmount;

  try {
    await assertAccountsBelong(restaurantId, [
      header.apAccountId ?? null,
      header.expenseAccountId ?? null,
      ...computed.map((c) => c.accountId),
    ]);
  } catch {
    res.status(400).json({ error: "invalid_accounts" }); return;  }

  const userId = req.user?.sub ?? req.user?.id ?? null;
  try {
    const [bill] = await db
      .insert(vendorBillsTable)
      .values({
        restaurantId,
        ...header,
        vendorEmail: header.vendorEmail ?? null,
        vendorGstin: header.vendorGstin ?? null,
        apAccountId: header.apAccountId ?? null,
        expenseAccountId: header.expenseAccountId ?? null,
        notes: header.notes ?? null,
        subtotal: D(subtotal),
        taxAmount: D(taxAmount),
        totalAmount: D(totalAmount),
        status: "draft",
        createdBy: userId,
      })
      .returning();
    await db.insert(vendorBillLinesTable).values(computed.map((c) => ({ ...c, vendorBillId: bill.id })));
    await recordAuditLog({ req, module: "accounting_books", action: "vendor_bill.create", entity: "vendor_bills", entityId: bill.id, restaurantId, newValue: bill });
    res.status(201).json(bill);
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "";
    if (msg.includes("vendor_bills_restaurant_no_uniq")) { res.status(409).json({ error: "bill_no_exists" }); return; }
    throw err;
  }
});

async function transitionBill(req: import("express").Request, res: import("express").Response, action: "submit" | "approve" | "schedule" | "void") {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [bill] = await db
    .select()
    .from(vendorBillsTable)
    .where(and(eq(vendorBillsTable.id, id), eq(vendorBillsTable.restaurantId, restaurantId)));
  if (!bill) { res.status(404).json({ error: "not_found" }); return; }

  const userId = req.user?.sub ?? req.user?.id ?? null;
  let next: VendorBillStatus = bill.status;
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (action === "submit") {
    if (bill.status !== "draft") { res.status(400).json({ error: "invalid_transition" }); return; }
    next = "pending_approval";
  } else if (action === "approve") {
    if (bill.status !== "pending_approval" && bill.status !== "draft") { res.status(400).json({ error: "invalid_transition" }); return; }
    next = "approved";
    patch.approvedBy = userId;
    patch.approvedAt = new Date();

    // Post journal: Dr Expense, Cr AP
    if (bill.apAccountId && bill.expenseAccountId) {
      try {
        await assertPeriodOpen(restaurantId, bill.billDate);
      } catch {
        res.status(409).json({ error: "period_closed" }); return;      }
      const entry = await postJournalWithLines(
        {
          restaurantId,
          entryDate: bill.billDate,
          source: "vendor_bill",
          sourceRef: String(bill.id),
          memo: `Bill ${bill.billNo} — ${bill.vendorName}`,
          status: "posted",
          totalDebit: bill.totalAmount,
          totalCredit: bill.totalAmount,
          postedAt: new Date(),
          postedBy: userId,
          createdBy: userId,
        },
        [
          { accountId: bill.expenseAccountId, debit: bill.totalAmount, credit: "0.00", lineOrder: 0 },
          { accountId: bill.apAccountId, debit: "0.00", credit: bill.totalAmount, lineOrder: 1 },
        ],
      );
      patch.journalEntryId = entry.id;
    }
  } else if (action === "schedule") {
    if (bill.status !== "approved") { res.status(400).json({ error: "invalid_transition" }); return; }
    const schema = z.object({ scheduledPayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid" }); return; }
    next = "scheduled";
    patch.scheduledPayDate = parsed.data.scheduledPayDate;
  } else if (action === "void") {
    if (bill.status === "paid") { res.status(400).json({ error: "invalid_transition" }); return; }
    next = "void";
  }

  patch.status = next;
  const [updated] = await db.update(vendorBillsTable).set(patch).where(eq(vendorBillsTable.id, id)).returning();
  await recordAuditLog({ req, module: "accounting_books", action: `vendor_bill.${action}`, entity: "vendor_bills", entityId: id, restaurantId, oldValue: bill, newValue: updated });
  res.json(updated);
}

router.post("/restaurants/:restaurantId/accounting-books/vendor-bills/:id/submit", (req, res) => transitionBill(req, res, "submit"));
router.post("/restaurants/:restaurantId/accounting-books/vendor-bills/:id/approve", (req, res) => transitionBill(req, res, "approve"));
router.post("/restaurants/:restaurantId/accounting-books/vendor-bills/:id/schedule", (req, res) => transitionBill(req, res, "schedule"));
router.post("/restaurants/:restaurantId/accounting-books/vendor-bills/:id/void", (req, res) => transitionBill(req, res, "void"));

router.post("/restaurants/:restaurantId/accounting-books/vendor-bills/:id/pay", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const schema = z.object({
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount: z.number().positive(),
    paymentMethod: z.string().default("bank_transfer"),
    reference: z.string().nullable().optional(),
    bankAccountId: z.number().int().nullable().optional(),
    idempotencyKey: z.string().max(128).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid" }); return; }
  const { paymentDate, amount, paymentMethod, reference, bankAccountId, idempotencyKey } = parsed.data;

  // Idempotency: if a payment with the same reference already exists for this bill,
  // return it instead of double-posting. `reference` is treated as the idempotency
  // token; clients can pass `idempotencyKey` which overrides any user-typed reference.
  const idemKey = idempotencyKey ?? reference ?? null;
  if (idemKey) {
    const [existing] = await db
      .select()
      .from(vendorBillPaymentsTable)
      .where(
        and(
          eq(vendorBillPaymentsTable.restaurantId, restaurantId),
          eq(vendorBillPaymentsTable.vendorBillId, id),
          eq(vendorBillPaymentsTable.reference, idemKey),
        ),
      )
      .limit(1);
    if (existing) { res.status(200).json({ ...existing, idempotent: true }); return; }
  }

  try {
    await assertAccountsBelong(restaurantId, [bankAccountId ?? null]);
  } catch {
    res.status(400).json({ error: "invalid_accounts" }); return;  }

  try {
    await assertPeriodOpen(restaurantId, paymentDate);
  } catch {
    res.status(409).json({ error: "period_closed" }); return;  }

  const userId = req.user?.sub ?? req.user?.id ?? null;

  // Atomic: lock bill row, recompute outstanding, post journal, insert payment,
  // and update bill balance/status — all or nothing.
  try {
    const result = await db.transaction(async (tx) => {
      const [bill] = await tx
        .select()
        .from(vendorBillsTable)
        .where(and(eq(vendorBillsTable.id, id), eq(vendorBillsTable.restaurantId, restaurantId)))
        .for("update");
      if (!bill) throw Object.assign(new Error("not_found"), { httpStatus: 404 });
      if (!["approved", "scheduled"].includes(bill.status)) {
        throw Object.assign(new Error("not_payable"), { httpStatus: 400 });
      }
      const outstanding = Number(bill.totalAmount) - Number(bill.amountPaid);
      if (amount > outstanding + 0.01) {
        throw Object.assign(new Error("overpayment"), { httpStatus: 400, outstanding });
      }

      let journalEntryId: number | null = null;
      if (bill.apAccountId && bankAccountId) {
        const entry = await postJournalWithLines(
          {
            restaurantId,
            entryDate: paymentDate,
            source: "vendor_bill_payment",
            sourceRef: `bill:${bill.id}:${idemKey ?? Date.now()}`,
            memo: `Payment for ${bill.billNo}`,
            status: "posted",
            totalDebit: D(amount),
            totalCredit: D(amount),
            postedAt: new Date(),
            postedBy: userId,
            createdBy: userId,
          },
          [
            { accountId: bill.apAccountId, debit: D(amount), credit: "0.00", lineOrder: 0 },
            { accountId: bankAccountId, debit: "0.00", credit: D(amount), lineOrder: 1 },
          ],
          tx,
        );
        journalEntryId = entry.id;
      }

      const [payment] = await tx
        .insert(vendorBillPaymentsTable)
        .values({
          restaurantId,
          vendorBillId: id,
          paymentDate,
          amount: D(amount),
          paymentMethod,
          reference: idemKey,
          bankAccountId: bankAccountId ?? null,
          journalEntryId,
          createdBy: userId,
        })
        .returning();

      const newPaid = Number(bill.amountPaid) + amount;
      const newStatus: VendorBillStatus = newPaid >= Number(bill.totalAmount) - 0.01 ? "paid" : bill.status;
      await tx
        .update(vendorBillsTable)
        .set({ amountPaid: D(newPaid), status: newStatus, updatedAt: new Date() })
        .where(eq(vendorBillsTable.id, id));
      return payment;
    });

    await recordAuditLog({ req, module: "accounting_books", action: "vendor_bill.pay", entity: "vendor_bill_payments", entityId: result.id, restaurantId, newValue: result });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { httpStatus?: number; message?: string; outstanding?: number };
    if (e.httpStatus) { res.status(e.httpStatus).json({ error: e.message, ...(e.outstanding !== undefined ? { outstanding: e.outstanding } : {}) }); return; }
    throw err;
  }
});

// ─── AR Invoices ─────────────────────────────────────────────────────
const arInvoiceSchema = z.object({
  invoiceNo: z.string().min(1).max(64),
  customerName: z.string().min(1).max(200),
  customerEmail: z.string().email().nullable().optional(),
  customerGstin: z.string().nullable().optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  subtotal: z.number().nonnegative(),
  taxAmount: z.number().nonnegative().default(0),
  arAccountId: z.number().int().nullable().optional(),
  incomeAccountId: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.get("/restaurants/:restaurantId/accounting-books/ar-invoices", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(arInvoicesTable)
    .where(eq(arInvoicesTable.restaurantId, restaurantId))
    .orderBy(desc(arInvoicesTable.invoiceDate))
    .limit(500);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/accounting-books/ar-invoices", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const parsed = arInvoiceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid", details: parsed.error.issues }); return; }
  try {
    await assertAccountsBelong(restaurantId, [parsed.data.arAccountId ?? null, parsed.data.incomeAccountId ?? null]);
  } catch {
    res.status(400).json({ error: "invalid_accounts" }); return;  }
  const userId = req.user?.sub ?? req.user?.id ?? null;
  const total = parsed.data.subtotal + (parsed.data.taxAmount ?? 0);
  try {
    const [inv] = await db
      .insert(arInvoicesTable)
      .values({
        restaurantId,
        invoiceNo: parsed.data.invoiceNo,
        customerName: parsed.data.customerName,
        customerEmail: parsed.data.customerEmail ?? null,
        customerGstin: parsed.data.customerGstin ?? null,
        invoiceDate: parsed.data.invoiceDate,
        dueDate: parsed.data.dueDate,
        subtotal: D(parsed.data.subtotal),
        taxAmount: D(parsed.data.taxAmount ?? 0),
        totalAmount: D(total),
        status: "open",
        arAccountId: parsed.data.arAccountId ?? null,
        incomeAccountId: parsed.data.incomeAccountId ?? null,
        notes: parsed.data.notes ?? null,
        createdBy: userId,
      })
      .returning();

    if (inv.arAccountId && inv.incomeAccountId) {
      try {
        await assertPeriodOpen(restaurantId, inv.invoiceDate);
        const entry = await postJournalWithLines(
          {
            restaurantId,
            entryDate: inv.invoiceDate,
            source: "ar_invoice",
            sourceRef: String(inv.id),
            memo: `Invoice ${inv.invoiceNo} — ${inv.customerName}`,
            status: "posted",
            totalDebit: inv.totalAmount,
            totalCredit: inv.totalAmount,
            postedAt: new Date(),
            postedBy: userId,
            createdBy: userId,
          },
          [
            { accountId: inv.arAccountId, debit: inv.totalAmount, credit: "0.00", lineOrder: 0 },
            { accountId: inv.incomeAccountId, debit: "0.00", credit: inv.totalAmount, lineOrder: 1 },
          ],
        );
        await db.update(arInvoicesTable).set({ journalEntryId: entry.id }).where(eq(arInvoicesTable.id, inv.id));
      } catch {
        // period closed — record invoice without posting; user can post manually
      }
    }
    await recordAuditLog({ req, module: "accounting_books", action: "ar_invoice.create", entity: "ar_invoices", entityId: inv.id, restaurantId, newValue: inv });
    res.status(201).json(inv);
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "";
    if (msg.includes("ar_invoices_restaurant_no_uniq")) { res.status(409).json({ error: "invoice_no_exists" }); return; }
    throw err;
  }
});

router.post("/restaurants/:restaurantId/accounting-books/ar-invoices/:id/receive", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const schema = z.object({
    amount: z.number().positive(),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    bankAccountId: z.number().int().nullable().optional(),
    idempotencyKey: z.string().max(128).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid" }); return; }

  // AR receipts must always create an audit journal; require a bank/cash
  // account so a real money flow is recorded and the journal serves as
  // the per-receipt idempotency record.
  if (!parsed.data.bankAccountId) {
    res.status(400).json({ error: "bank_account_required" });
    return;
  }

  try {
    await assertAccountsBelong(restaurantId, [parsed.data.bankAccountId]);
  } catch {
    res.status(400).json({ error: "invalid_accounts" }); return;  }

  // Idempotency: derive a deterministic journal sourceRef from the key (or
  // amount+date when no key is supplied). If a posted journal with that
  // sourceRef already exists, treat the receipt as already applied.
  const idemKey = parsed.data.idempotencyKey ?? `${parsed.data.paymentDate}:${parsed.data.amount.toFixed(2)}`;
  const journalSourceRef = `ar:${id}:${idemKey}`;
  const [existingJe] = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(
      and(
        eq(journalEntriesTable.restaurantId, restaurantId),
        eq(journalEntriesTable.source, "ar_receipt"),
        eq(journalEntriesTable.sourceRef, journalSourceRef),
      ),
    )
    .limit(1);
  if (existingJe) {
    const [current] = await db.select().from(arInvoicesTable).where(eq(arInvoicesTable.id, id));
    res.json({ ...current, idempotent: true }); return;  }

  if (parsed.data.bankAccountId) {
    try {
      await assertPeriodOpen(restaurantId, parsed.data.paymentDate);
    } catch {
      res.status(409).json({ error: "period_closed" }); return;    }
  }

  const userId = req.user?.sub ?? req.user?.id ?? null;

  try {
    const updated = await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(arInvoicesTable)
        .where(and(eq(arInvoicesTable.id, id), eq(arInvoicesTable.restaurantId, restaurantId)))
        .for("update");
      if (!inv) throw Object.assign(new Error("not_found"), { httpStatus: 404 });
      const outstanding = Number(inv.totalAmount) - Number(inv.amountReceived);
      if (parsed.data.amount > outstanding + 0.01) {
        throw Object.assign(new Error("overpayment"), { httpStatus: 400, outstanding });
      }

      if (inv.arAccountId && parsed.data.bankAccountId) {
        await postJournalWithLines(
          {
            restaurantId,
            entryDate: parsed.data.paymentDate,
            source: "ar_receipt",
            sourceRef: journalSourceRef,
            memo: `Receipt for ${inv.invoiceNo}`,
            status: "posted",
            totalDebit: D(parsed.data.amount),
            totalCredit: D(parsed.data.amount),
            postedAt: new Date(),
            postedBy: userId,
            createdBy: userId,
          },
          [
            { accountId: parsed.data.bankAccountId, debit: D(parsed.data.amount), credit: "0.00", lineOrder: 0 },
            { accountId: inv.arAccountId, debit: "0.00", credit: D(parsed.data.amount), lineOrder: 1 },
          ],
          tx,
        );
      }
      const newAmt = Number(inv.amountReceived) + parsed.data.amount;
      const newStatus = newAmt >= Number(inv.totalAmount) - 0.01 ? "paid" : "partial";
      const [row] = await tx
        .update(arInvoicesTable)
        .set({ amountReceived: D(newAmt), status: newStatus, updatedAt: new Date() })
        .where(eq(arInvoicesTable.id, id))
        .returning();
      return row;
    });
    await recordAuditLog({ req, module: "accounting_books", action: "ar_invoice.receive", entity: "ar_invoices", entityId: id, restaurantId, newValue: { amount: parsed.data.amount, status: updated.status } });
    res.json(updated);
  } catch (err: unknown) {
    const e = err as { httpStatus?: number; message?: string; outstanding?: number };
    if (e.httpStatus) { res.status(e.httpStatus).json({ error: e.message, ...(e.outstanding !== undefined ? { outstanding: e.outstanding } : {}) }); return; }
    throw err;
  }
});

// ─── Accounting Periods (close / reopen) ─────────────────────────────
router.get("/restaurants/:restaurantId/accounting-books/periods", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const rows = await db
    .select()
    .from(accountingPeriodsTable)
    .where(eq(accountingPeriodsTable.restaurantId, restaurantId))
    .orderBy(desc(accountingPeriodsTable.periodStart))
    .limit(60);
  res.json(rows);
});

router.post("/restaurants/:restaurantId/accounting-books/periods/close", async (req, res) => {
  if (req.user?.role && !["owner", "accountant", "super_admin"].includes(req.user.role) && !req.user.isSuperAdmin) {
    res.status(403).json({ error: "forbidden_role" }); return;  }
  const restaurantId = Number(req.params.restaurantId);
  const schema = z.object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid" }); return; }
  if (parsed.data.periodEnd < parsed.data.periodStart) { res.status(400).json({ error: "invalid_range" }); return; }

  const userId = req.user?.sub ?? req.user?.id ?? null;
  const [row] = await db
    .insert(accountingPeriodsTable)
    .values({
      restaurantId,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      status: "closed",
      closedAt: new Date(),
      closedBy: userId,
      notes: parsed.data.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [accountingPeriodsTable.restaurantId, accountingPeriodsTable.periodStart],
      set: { status: "closed", closedAt: new Date(), closedBy: userId, notes: parsed.data.notes ?? null, periodEnd: parsed.data.periodEnd },
    })
    .returning();
  await recordAuditLog({ req, module: "accounting_books", action: "period.close", entity: "accounting_periods", entityId: row.id, restaurantId, newValue: row });
  res.status(201).json(row);
});

router.post("/restaurants/:restaurantId/accounting-books/periods/:id/reopen", async (req, res) => {
  if (req.user?.role && !["owner", "super_admin"].includes(req.user.role) && !req.user.isSuperAdmin) {
    res.status(403).json({ error: "forbidden_role" }); return;  }
  const restaurantId = Number(req.params.restaurantId);
  const id = Number(req.params.id);
  const [row] = await db
    .update(accountingPeriodsTable)
    .set({ status: "open", closedAt: null, closedBy: null })
    .where(and(eq(accountingPeriodsTable.id, id), eq(accountingPeriodsTable.restaurantId, restaurantId)))
    .returning();
  if (!row) { res.status(404).json({ error: "not_found" }); return; }
  await recordAuditLog({ req, module: "accounting_books", action: "period.reopen", entity: "accounting_periods", entityId: id, restaurantId, newValue: row });
  res.json(row);
});

// ─── Statements: Trial Balance, Balance Sheet, Cash Flow ─────────────
async function trialBalance(restaurantId: number, dateFrom: string, dateTo: string) {
  const rows = await db
    .select({
      accountId: chartOfAccountsTable.id,
      code: chartOfAccountsTable.code,
      name: chartOfAccountsTable.name,
      type: chartOfAccountsTable.type,
      normalBalance: chartOfAccountsTable.normalBalance,
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntriesTable.id} IS NOT NULL THEN ${journalEntryLinesTable.debit} ELSE 0 END), 0)::text`,
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntriesTable.id} IS NOT NULL THEN ${journalEntryLinesTable.credit} ELSE 0 END), 0)::text`,
    })
    .from(chartOfAccountsTable)
    .leftJoin(journalEntryLinesTable, eq(journalEntryLinesTable.accountId, chartOfAccountsTable.id))
    .leftJoin(
      journalEntriesTable,
      and(
        eq(journalEntriesTable.id, journalEntryLinesTable.journalEntryId),
        eq(journalEntriesTable.restaurantId, restaurantId),
        eq(journalEntriesTable.status, "posted"),
        gte(journalEntriesTable.entryDate, dateFrom),
        lte(journalEntriesTable.entryDate, dateTo),
      ),
    )
    .where(eq(chartOfAccountsTable.restaurantId, restaurantId))
    .groupBy(chartOfAccountsTable.id)
    .orderBy(chartOfAccountsTable.code);
  return rows.map((r) => {
    const debit = Number(r.debit);
    const credit = Number(r.credit);
    const balance = r.normalBalance === "debit" ? debit - credit : credit - debit;
    return { ...r, debit, credit, balance };
  });
}

router.get("/restaurants/:restaurantId/accounting-books/statements/trial-balance", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const from = String(req.query.from ?? "1900-01-01");
  const to = String(req.query.to ?? new Date().toISOString().slice(0, 10));
  const tb = await trialBalance(restaurantId, from, to);
  res.json({ from, to, rows: tb });
});

router.get("/restaurants/:restaurantId/accounting-books/statements/balance-sheet", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const asOf = String(req.query.asOf ?? new Date().toISOString().slice(0, 10));
  const tb = await trialBalance(restaurantId, "1900-01-01", asOf);
  const groups: Record<AccountType, typeof tb> = { asset: [], liability: [], equity: [], income: [], expense: [] };
  for (const r of tb) groups[r.type as AccountType].push(r);
  const sumOf = (rows: typeof tb) => rows.reduce((s, r) => s + r.balance, 0);
  const totalAssets = sumOf(groups.asset);
  const totalLiab = sumOf(groups.liability);
  const totalEquity = sumOf(groups.equity);
  const netIncome = sumOf(groups.income) - sumOf(groups.expense);
  res.json({
    asOf,
    assets: { rows: groups.asset, total: totalAssets },
    liabilities: { rows: groups.liability, total: totalLiab },
    equity: { rows: groups.equity, total: totalEquity, netIncome },
    balanced: Math.abs(totalAssets - (totalLiab + totalEquity + netIncome)) < 0.01,
  });
});

router.get("/restaurants/:restaurantId/accounting-books/statements/cash-flow", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const from = String(req.query.from ?? new Date(new Date().setDate(1)).toISOString().slice(0, 10));
  const to = String(req.query.to ?? new Date().toISOString().slice(0, 10));

  // Placeholder method: sum all postings that hit cash/bank accounts (type=asset & code starts with 10)
  const cashAccts = await db
    .select({ id: chartOfAccountsTable.id, code: chartOfAccountsTable.code, name: chartOfAccountsTable.name })
    .from(chartOfAccountsTable)
    .where(and(eq(chartOfAccountsTable.restaurantId, restaurantId), eq(chartOfAccountsTable.type, "asset")));
  const cashIds = cashAccts.filter((a) => /^10/.test(a.code)).map((a) => a.id);
  if (cashIds.length === 0) {
    res.json({ from, to, note: "No cash/bank accounts (code starting with 10). Add at least one.", rows: [], net: 0 }); return;  }
  const rows = await db
    .select({
      accountId: journalEntryLinesTable.accountId,
      debit: sql<string>`COALESCE(SUM(${journalEntryLinesTable.debit}), 0)::text`,
      credit: sql<string>`COALESCE(SUM(${journalEntryLinesTable.credit}), 0)::text`,
    })
    .from(journalEntryLinesTable)
    .innerJoin(
      journalEntriesTable,
      and(
        eq(journalEntriesTable.id, journalEntryLinesTable.journalEntryId),
        eq(journalEntriesTable.restaurantId, restaurantId),
        eq(journalEntriesTable.status, "posted"),
        gte(journalEntriesTable.entryDate, from),
        lte(journalEntriesTable.entryDate, to),
      ),
    )
    .where(inArray(journalEntryLinesTable.accountId, cashIds))
    .groupBy(journalEntryLinesTable.accountId);

  const enriched = rows.map((r) => {
    const acct = cashAccts.find((a) => a.id === r.accountId)!;
    const inflow = Number(r.debit);
    const outflow = Number(r.credit);
    return { ...acct, inflow, outflow, net: inflow - outflow };
  });
  const net = enriched.reduce((s, r) => s + r.net, 0);
  res.json({ from, to, rows: enriched, net });
});

// ─── Bank Reconciliation (placeholder) ────────────────────────────────
// Lightweight reconciliation view: for a chosen bank/cash account and
// date range, returns posted ledger lines plus a running balance and
// outstanding total. A full statement-import workflow is out of scope
// for this iteration; this gives accountants a per-account reconciliation
// surface to verify against external bank statements manually.
router.get("/restaurants/:restaurantId/accounting-books/bank-rec/:accountId", async (req, res) => {
  const restaurantId = Number(req.params.restaurantId);
  const accountId = Number(req.params.accountId);
  const from = String(req.query.from ?? "1900-01-01");
  const to = String(req.query.to ?? new Date().toISOString().slice(0, 10));

  try {
    await assertAccountsBelong(restaurantId, [accountId]);
  } catch {
    res.status(400).json({ error: "invalid_account" }); return;  }

  const [acct] = await db
    .select()
    .from(chartOfAccountsTable)
    .where(and(eq(chartOfAccountsTable.id, accountId), eq(chartOfAccountsTable.restaurantId, restaurantId)));
  if (!acct) { res.status(404).json({ error: "account_not_found" }); return; }

  const lines = await db
    .select({
      lineId: journalEntryLinesTable.id,
      journalId: journalEntriesTable.id,
      journalNo: journalEntriesTable.journalNo,
      entryDate: journalEntriesTable.entryDate,
      source: journalEntriesTable.source,
      sourceRef: journalEntriesTable.sourceRef,
      memo: journalEntryLinesTable.memo,
      debit: journalEntryLinesTable.debit,
      credit: journalEntryLinesTable.credit,
    })
    .from(journalEntryLinesTable)
    .innerJoin(
      journalEntriesTable,
      and(
        eq(journalEntriesTable.id, journalEntryLinesTable.journalEntryId),
        eq(journalEntriesTable.restaurantId, restaurantId),
        eq(journalEntriesTable.status, "posted"),
        gte(journalEntriesTable.entryDate, from),
        lte(journalEntriesTable.entryDate, to),
      ),
    )
    .where(eq(journalEntryLinesTable.accountId, accountId))
    .orderBy(journalEntriesTable.entryDate, journalEntriesTable.id);

  let running = 0;
  const ledger = lines.map((l) => {
    const debit = Number(l.debit);
    const credit = Number(l.credit);
    running += acct.normalBalance === "debit" ? debit - credit : credit - debit;
    return { ...l, debit, credit, runningBalance: running };
  });

  res.json({
    account: { id: acct.id, code: acct.code, name: acct.name, normalBalance: acct.normalBalance },
    from,
    to,
    rows: ledger,
    closingBalance: running,
    note: "Reconcile these postings against your external bank statement. Statement-file import is on the roadmap.",
  });
});

export default router;
