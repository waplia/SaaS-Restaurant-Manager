/**
 * Hydrate the local cache with reference data needed for offline ordering.
 *
 * Called on login, on outlet/branch change, and every 5 minutes while online
 * so a long-running shift survives a sudden network drop with fresh data.
 *
 * Each fetch is tolerant of failure — a single broken endpoint should never
 * leave the cache in an inconsistent state for the others.
 */

import type { ApiClient } from "../api/client";
import {
  upsertCategories, upsertMenuItems, upsertTables, upsertCustomers,
  kvSet, listMenuItems,
  upsertSettings, upsertTerminals, upsertKitchensFromItems,
  upsertDiscountRules,
} from "../db/queries";

const RESTAURANT_INFO_KEY = (rid: number) => `restaurant_info:${rid}`;
const TERMINALS_KEY = (rid: number) => `terminals:${rid}`;
const DISCOUNTS_KEY = (rid: number) => `discounts:${rid}`;
const MODIFIERS_KEY = (itemId: number) => `modifiers:${itemId}`;

export async function hydrateAll(client: ApiClient, restaurantId: number): Promise<void> {
  // Phase A: the entities the cashier needs to *start* an order. We await
  // these so the renderer's first read after login finds a populated cache.
  await Promise.all([
    safe("restaurant-info", async () => {
      const info = await client.getRestaurantInfo(restaurantId);
      kvSet(RESTAURANT_INFO_KEY(restaurantId), JSON.stringify(info));
      // Mirror into the first-class settings table so future queries can
      // join against it.
      upsertSettings(restaurantId, info);
    }),
    safe("categories", async () => {
      const r = await client.listCategories(restaurantId);
      upsertCategories(restaurantId, r);
    }),
    safe("items", async () => {
      const r = await client.listMenuItems(restaurantId, {});
      upsertMenuItems(restaurantId, r);
    }),
    safe("tables", async () => {
      const r = await client.listTables(restaurantId);
      upsertTables(restaurantId, r);
    }),
    safe("customers", async () => {
      // Recent customers (broad search seeds the cache).
      const r = await client.searchCustomers(restaurantId, "", 500);
      upsertCustomers(restaurantId, r);
    }),
    safe("discounts", async () => {
      const d = await client.loadDiscountsConfig(restaurantId);
      kvSet(DISCOUNTS_KEY(restaurantId), JSON.stringify(d));
      // Persist each rule as a row so offline screens can filter / order.
      const rules = (d as { rules?: Array<{ id?: number }> })?.rules ?? [];
      upsertDiscountRules(restaurantId, rules);
    }),
    safe("terminals", async () => {
      const t = await client.listTerminals(restaurantId);
      kvSet(TERMINALS_KEY(restaurantId), JSON.stringify(t));
      upsertTerminals(restaurantId, t as Array<{ id: number }>);
    }),
  ]);

  // Kitchens are derived from the menu items' kitchenId metadata since the
  // server doesn't expose a dedicated /kitchens endpoint. Populating the
  // first-class table here lets offline KOT dispatch validate routing
  // without re-scanning the items table.
  safe("kitchens", async () => {
    upsertKitchensFromItems(restaurantId, listMenuItems(restaurantId));
  }).catch(() => undefined);

  // Phase B: per-item modifier groups. These are fetched lazily per item
  // online, but for offline we need them eagerly. Capped concurrency keeps
  // the API server happy. Failures here are silent so a flaky network never
  // blocks login.
  const items = listMenuItems(restaurantId);
  await mapWithLimit(items, 4, async (it) => {
    try {
      const groups = await client.listItemModifierGroups(it.id);
      kvSet(MODIFIERS_KEY(it.id), JSON.stringify(groups));
    } catch { /* per-item modifier hydrate is best-effort */ }
  });

  kvSet(`hydrate:lastAt:${restaurantId}`, String(Date.now()));
}

async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); }
  catch (err) {
    console.warn(`[hydrate:${label}] failed:`, (err as Error).message);
  }
}

async function mapWithLimit<T>(items: T[], limit: number, fn: (it: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}
