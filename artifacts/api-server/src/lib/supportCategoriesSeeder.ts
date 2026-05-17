/**
 * Idempotent seeder that ensures a baseline set of support ticket categories
 * exists. Without these, the "New Ticket" form on the support page shows an
 * empty category dropdown on a fresh install. Runs on startup and is also
 * called from the main seed routine.
 *
 * Insertion uses ON CONFLICT DO NOTHING on the unique `slug` so re-running
 * (or running on an install that already has matching rows) is safe.
 */
import { db, supportTicketCategoriesTable, type TicketPriority } from "./db";
import { logger } from "./logger";
import { sql } from "drizzle-orm";

interface SeedCategory {
  name: string;
  slug: string;
  description: string;
  defaultPriority: TicketPriority;
  firstResponseHours: number;
  resolutionHours: number;
  sortOrder: number;
}

const DEFAULT_CATEGORIES: SeedCategory[] = [
  {
    name: "Billing",
    slug: "billing",
    description: "Invoices, payments, plan changes and subscription questions.",
    defaultPriority: "normal",
    firstResponseHours: 12,
    resolutionHours: 48,
    sortOrder: 10,
  },
  {
    name: "Technical",
    slug: "technical",
    description: "Bugs, errors, performance issues and other technical problems.",
    defaultPriority: "high",
    firstResponseHours: 8,
    resolutionHours: 24,
    sortOrder: 20,
  },
  {
    name: "Feature Request",
    slug: "feature-request",
    description: "Suggestions and requests for new features or improvements.",
    defaultPriority: "low",
    firstResponseHours: 48,
    resolutionHours: 168,
    sortOrder: 30,
  },
  {
    name: "Account",
    slug: "account",
    description: "Login, access, users, permissions and profile questions.",
    defaultPriority: "normal",
    firstResponseHours: 12,
    resolutionHours: 48,
    sortOrder: 40,
  },
  {
    name: "Other",
    slug: "other",
    description: "Anything that doesn't fit the other categories.",
    defaultPriority: "normal",
    firstResponseHours: 24,
    resolutionHours: 72,
    sortOrder: 50,
  },
];

export async function seedDefaultSupportCategories(): Promise<void> {
  try {
    // Only seed when the table is empty so we don't reactivate categories an
    // admin has explicitly deactivated, or step on customised entries.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportTicketCategoriesTable);
    if (Number(count) > 0) return;

    for (const cat of DEFAULT_CATEGORIES) {
      await db
        .insert(supportTicketCategoriesTable)
        .values({
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          defaultPriority: cat.defaultPriority,
          firstResponseHours: cat.firstResponseHours,
          resolutionHours: cat.resolutionHours,
          isActive: true,
          sortOrder: cat.sortOrder,
        })
        .onConflictDoNothing({ target: supportTicketCategoriesTable.slug });
    }
    logger.info("Default support ticket categories ensured");
  } catch (err) {
    logger.error({ err }, "Failed to seed default support ticket categories");
  }
}
