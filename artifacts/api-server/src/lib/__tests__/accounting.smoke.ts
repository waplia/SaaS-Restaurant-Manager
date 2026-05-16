// Smoke test for accounting integrations & exports.
// Usage: pnpm --filter @workspace/api-server tsx src/lib/__tests__/accounting.smoke.ts <restaurantId>
//
// Verifies the renderers, dataset builders, and configuration-required handling
// without hitting any third-party APIs.
import { buildDataset } from "../accounting/datasets";
import { render } from "../accounting/renderers";
import { ConfigurationRequiredError, getTargetCatalog, TARGET_CATALOG } from "../accounting/types";
import { pushToTarget } from "../accounting/pushAdapters";
import type { AccountingTarget, AccountingDataset } from "../db";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("[FAIL]", msg);
    process.exitCode = 1;
  } else {
    console.log("[ OK ]", msg);
  }
}

const stubMappings = {
  tax: () => null,
  ledger: () => null,
  account: () => null,
};

async function main() {
  const restaurantId = Number(process.argv[2] ?? "1");
  if (!Number.isFinite(restaurantId)) {
    console.error("Usage: tsx accounting.smoke.ts <restaurantId>");
    process.exit(1);
  }

  // 1) Catalog covers all 9 targets.
  assert(TARGET_CATALOG.length === 9, `Catalog has 9 targets (got ${TARGET_CATALOG.length})`);
  for (const t of ["tally","zoho_books","quickbooks","busy","marg","vyapar","gst","excel","api"] as AccountingTarget[]) {
    assert(!!getTargetCatalog(t), `Catalog has ${t}`);
  }

  // 2) Build all 3 datasets — empty ranges should still return arrays.
  const today = new Date().toISOString().slice(0, 10);
  for (const ds of ["sales","expense","purchase"] as AccountingDataset[]) {
    const rows = await buildDataset({ restaurantId, dataset: ds, dateFrom: "2020-01-01", dateTo: today });
    assert(Array.isArray(rows), `buildDataset(${ds}) returns array (n=${rows.length})`);
  }

  // 3) Render each target with a synthetic row to ensure no renderer throws.
  const synthetic = [{
    date: "2026-05-10",
    reference: "TEST-1",
    party: "Test Customer",
    ledger: "sales:dine_in",
    taxCode: "gst:5",
    amount: 1000,
    taxAmount: 50,
    total: 1050,
    description: "Test row with <special> chars",
    sourceId: 1,
    meta: { items: [{ name: "Idli", quantity: 2 }] },
  }];
  for (const t of TARGET_CATALOG) {
    for (const ds of ["sales","expense","purchase"] as AccountingDataset[]) {
      const fmt = t.formats[ds][0]!;
      const out = await render({ target: t.target, dataset: ds, format: fmt, rows: synthetic, mappings: stubMappings, config: { companyName: "Smoke Co" } });
      assert(out.buffer.length > 0, `render(${t.target}/${ds}/${fmt}) produced ${out.buffer.length}B (${out.fileName})`);
    }
  }

  // 4) Push adapter throws ConfigurationRequiredError when creds are missing.
  for (const t of ["zoho_books","quickbooks","api"] as AccountingTarget[]) {
    let threw = false;
    try {
      await pushToTarget({ target: t, config: {}, payload: "{}", fileName: "x.json" });
    } catch (err) {
      threw = err instanceof ConfigurationRequiredError;
    }
    assert(threw, `pushToTarget(${t}) without creds throws ConfigurationRequiredError`);
  }

  console.log(process.exitCode ? "smoke FAILED" : "smoke OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
