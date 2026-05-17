import { createRequire } from "module";
import type { Archiver } from "archiver";
const archiver = createRequire(import.meta.url)("archiver") as (
  format: "zip",
  options?: { zlib?: { level?: number } },
) => Archiver;

/**
 * Minimal XLSX (Office Open XML SpreadsheetML) writer using `archiver`.
 * Produces a single-sheet workbook with inline string cells. This is intentionally
 * minimal — adequate for accounting exports — and avoids pulling in `exceljs`.
 */
export async function writeXlsx(
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive: Archiver = archiver("zip", { zlib: { level: 9 } });
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    archive.append(CONTENT_TYPES_XML, { name: "[Content_Types].xml" });
    archive.append(ROOT_RELS_XML, { name: "_rels/.rels" });
    archive.append(WORKBOOK_RELS_XML, { name: "xl/_rels/workbook.xml.rels" });
    archive.append(buildWorkbookXml(sheetName), { name: "xl/workbook.xml" });
    archive.append(buildSheetXml(headers, rows), { name: "xl/worksheets/sheet1.xml" });

    archive.finalize().catch(reject);
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function colRef(idx: number): string {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function buildSheetXml(headers: string[], rows: Array<Array<string | number>>): string {
  const allRows = [headers, ...rows];
  const xmlRows: string[] = [];
  for (let r = 0; r < allRows.length; r++) {
    const cells: string[] = [];
    const row = allRows[r]!;
    for (let c = 0; c < row.length; c++) {
      const value = row[c]!;
      const ref = `${colRef(c)}${r + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        cells.push(`<c r="${ref}"><v>${value}</v></c>`);
      } else {
        const s = escapeXml(String(value ?? ""));
        cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${s}</t></is></c>`);
      }
    }
    xmlRows.push(`<row r="${r + 1}">${cells.join("")}</row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows.join("")}</sheetData></worksheet>`;
}

function buildWorkbookXml(sheetName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
