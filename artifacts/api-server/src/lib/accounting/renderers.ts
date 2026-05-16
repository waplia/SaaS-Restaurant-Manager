import type { AccountingDataset, AccountingFormat, AccountingTarget } from "../db";
import type { DatasetRow } from "./datasets";
import { writeXlsx } from "./xlsx";

export interface MappingLookup {
  tax(sourceCode: string): string | null;
  ledger(sourceLedger: string): string | null;
  account(partyType: string, partyKey: string): string | null;
}

export interface RenderArgs {
  target: AccountingTarget;
  dataset: AccountingDataset;
  format: AccountingFormat;
  rows: DatasetRow[];
  mappings: MappingLookup;
  /** Optional connection config used by some renderers (e.g. company name). */
  config?: Record<string, unknown>;
}

export interface RenderedFile {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

const CSV_HEADERS = ["Date", "Voucher No", "Party", "Ledger", "Tax Code", "Amount", "Tax Amount", "Total", "Description"];

function fmtDateDmy(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function escapeCsv(value: string | number): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildCsv(headers: string[], rows: Array<Array<string | number>>): string {
  return [headers.map(escapeCsv).join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\r\n") + "\r\n";
}

function applyMappings(rows: DatasetRow[], mappings: MappingLookup, target: AccountingTarget) {
  // Returns rows with resolved ledger / tax codes + a list of unresolved keys.
  const resolved: Array<DatasetRow & { resolvedLedger: string; resolvedTax: string }> = [];
  for (const r of rows) {
    const ledger = mappings.ledger(r.ledger) ?? r.ledger;
    const tax = r.taxCode ? mappings.tax(r.taxCode) ?? r.taxCode : "";
    resolved.push({ ...r, resolvedLedger: ledger, resolvedTax: tax });
  }
  void target;
  return resolved;
}

export async function render(args: RenderArgs): Promise<RenderedFile> {
  const { target, dataset, format, rows, mappings, config } = args;
  const mapped = applyMappings(rows, mappings, target);

  if (format === "json") {
    const buffer = Buffer.from(
      JSON.stringify({
        target,
        dataset,
        config: { companyName: (config?.companyName as string) ?? null },
        rows: mapped.map((r) => ({
          date: r.date,
          reference: r.reference,
          party: r.party,
          ledger: r.resolvedLedger,
          taxCode: r.resolvedTax,
          amount: r.amount,
          taxAmount: r.taxAmount,
          total: r.total,
          description: r.description,
          meta: r.meta,
        })),
      }, null, 2),
      "utf8",
    );
    return { buffer, contentType: "application/json", fileName: `${target}-${dataset}.json` };
  }

  if (format === "csv") {
    let body: string;
    if (target === "gst") {
      // Group by tax code & rate for a GSTR-1-friendly summary.
      const byCode = new Map<string, { taxable: number; tax: number; count: number }>();
      for (const r of mapped) {
        const key = r.resolvedTax || "EXEMPT";
        const cur = byCode.get(key) ?? { taxable: 0, tax: 0, count: 0 };
        cur.taxable += r.amount;
        cur.tax += r.taxAmount;
        cur.count += 1;
        byCode.set(key, cur);
      }
      const headers = ["GST Rate / Code", "Invoices", "Taxable Value", "Tax Amount", "Total"];
      const out = Array.from(byCode.entries()).map(([code, v]) => [
        code,
        v.count,
        Number(v.taxable.toFixed(2)),
        Number(v.tax.toFixed(2)),
        Number((v.taxable + v.tax).toFixed(2)),
      ]);
      body = buildCsv(headers, out);
    } else if (target === "marg") {
      const headers = ["VchDate", "VchNo", "Party", "Account", "GSTCode", "Amount", "TaxAmt", "Total", "Narration"];
      body = buildCsv(headers, mapped.map((r) => [
        fmtDateDmy(r.date), r.reference, r.party, r.resolvedLedger, r.resolvedTax,
        r.amount, r.taxAmount, r.total, r.description,
      ]));
    } else {
      body = buildCsv(CSV_HEADERS, mapped.map((r) => [
        r.date, r.reference, r.party, r.resolvedLedger, r.resolvedTax,
        r.amount, r.taxAmount, r.total, r.description,
      ]));
    }
    return { buffer: Buffer.from(body, "utf8"), contentType: "text/csv; charset=utf-8", fileName: `${target}-${dataset}.csv` };
  }

  if (format === "xlsx") {
    const buffer = await writeXlsx(
      `${dataset}`.toUpperCase(),
      CSV_HEADERS,
      mapped.map((r) => [r.date, r.reference, r.party, r.resolvedLedger, r.resolvedTax, r.amount, r.taxAmount, r.total, r.description]),
    );
    return {
      buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: `${target}-${dataset}.xlsx`,
    };
  }

  if (format === "iif") {
    // QuickBooks IIF: tab-separated, header rows define schema then transactions.
    const lines: string[] = [];
    lines.push("!TRNS\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO");
    lines.push("!SPL\tDATE\tACCNT\tAMOUNT\tMEMO");
    lines.push("!ENDTRNS");
    for (const r of mapped) {
      const sign = dataset === "sales" ? 1 : -1;
      lines.push(["TRNS", fmtDateDmy(r.date), r.resolvedLedger, r.party, (sign * r.total).toFixed(2), r.reference, r.description].join("\t"));
      lines.push(["SPL", fmtDateDmy(r.date), r.resolvedLedger, (-sign * r.total).toFixed(2), r.description].join("\t"));
      lines.push("ENDTRNS");
    }
    return {
      buffer: Buffer.from(lines.join("\r\n") + "\r\n", "utf8"),
      contentType: "application/vnd.intu.iif",
      fileName: `${target}-${dataset}.iif`,
    };
  }

  if (format === "xml") {
    if (target === "tally") {
      return { ...renderTallyXml(dataset, mapped, (config?.companyName as string) ?? "Restaurant"), fileName: `tally-${dataset}.xml` };
    }
    if (target === "busy") {
      return { ...renderBusyXml(dataset, mapped, (config?.companyName as string) ?? "Restaurant"), fileName: `busy-${dataset}.xml` };
    }
  }

  throw new Error(`Unsupported renderer: target=${target} format=${format}`);
}

function renderTallyXml(
  dataset: AccountingDataset,
  rows: Array<DatasetRow & { resolvedLedger: string; resolvedTax: string }>,
  company: string,
): Omit<RenderedFile, "fileName"> {
  const voucherType = dataset === "sales" ? "Sales" : dataset === "purchase" ? "Purchase" : "Payment";
  const vouchers = rows.map((r) => {
    const sign = dataset === "sales" ? -1 : 1;
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${voucherType}" ACTION="Create">
<DATE>${r.date.replace(/-/g, "")}</DATE>
<VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>
<VOUCHERNUMBER>${escapeXml(r.reference)}</VOUCHERNUMBER>
<PARTYLEDGERNAME>${escapeXml(r.party || r.resolvedLedger)}</PARTYLEDGERNAME>
<NARRATION>${escapeXml(r.description)}</NARRATION>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>${escapeXml(r.resolvedLedger)}</LEDGERNAME>
<ISDEEMEDPOSITIVE>${sign < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
<AMOUNT>${(sign * r.total).toFixed(2)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>
${r.taxAmount > 0 ? `<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>${escapeXml(r.resolvedTax || "GST Output")}</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<AMOUNT>${r.taxAmount.toFixed(2)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>` : ""}
</VOUCHER>
</TALLYMESSAGE>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY></STATICVARIABLES>
</REQUESTDESC><REQUESTDATA>
${vouchers}
</REQUESTDATA></IMPORTDATA></BODY>
</ENVELOPE>`;
  return { buffer: Buffer.from(xml, "utf8"), contentType: "application/xml" };
}

function renderBusyXml(
  dataset: AccountingDataset,
  rows: Array<DatasetRow & { resolvedLedger: string; resolvedTax: string }>,
  company: string,
): Omit<RenderedFile, "fileName"> {
  const vouchers = rows.map((r) => `<VOUCHER>
<VCHTYPE>${dataset === "sales" ? "Sale" : dataset === "purchase" ? "Purchase" : "Payment"}</VCHTYPE>
<DATE>${r.date}</DATE>
<NUMBER>${escapeXml(r.reference)}</NUMBER>
<PARTY>${escapeXml(r.party)}</PARTY>
<ACCOUNT>${escapeXml(r.resolvedLedger)}</ACCOUNT>
<AMOUNT>${r.amount.toFixed(2)}</AMOUNT>
<TAXAMOUNT>${r.taxAmount.toFixed(2)}</TAXAMOUNT>
<TOTAL>${r.total.toFixed(2)}</TOTAL>
<NARRATION>${escapeXml(r.description)}</NARRATION>
</VOUCHER>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<BUSYIMPORT COMPANY="${escapeXml(company)}">
${vouchers}
</BUSYIMPORT>`;
  return { buffer: Buffer.from(xml, "utf8"), contentType: "application/xml" };
}
