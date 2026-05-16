import PDFDocument from "pdfkit";
import { ObjectStorageService } from "./objectStorage";
import { setObjectAclPolicy } from "./objectAcl";

export interface MysteryAuditPdfData {
  templateName: string;
  restaurantName: string;
  auditorName: string;
  visitDate: Date | null;
  submittedAt: Date | null;
  totalScore: number;
  totalMaxScore: number;
  weightedPercent: number;
  generalNotes?: string | null;
  categoryScores: Array<{ name: string; weight: number; score: number; maxScore: number; percent: number }>;
  responses: Array<{
    categoryName: string;
    itemLabel: string;
    score: number;
    maxScore: number;
    notes?: string | null;
    photoCount: number;
  }>;
  correctiveActions: Array<{
    description: string;
    priority: string;
    status: string;
    dueDate: Date | null;
  }>;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toISOString().slice(0, 10); } catch { return "—"; }
}

export function buildMysteryAuditPdfBuffer(data: MysteryAuditPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(20).fillColor("#111").text("Mystery Audit Report", { align: "left" });
      doc.moveDown(0.3);
      doc.fontSize(12).fillColor("#444").text(data.templateName);
      doc.moveDown(0.8);

      doc.fontSize(10).fillColor("#000");
      const meta: Array<[string, string]> = [
        ["Outlet", data.restaurantName],
        ["Auditor", data.auditorName],
        ["Visit date", fmtDate(data.visitDate)],
        ["Submitted at", fmtDate(data.submittedAt)],
      ];
      meta.forEach(([k, v]) => doc.text(`${k}: `, { continued: true }).fillColor("#555").text(v).fillColor("#000"));

      doc.moveDown(0.6);
      doc.fontSize(14).fillColor("#111").text("Overall Score");
      doc.fontSize(11).fillColor("#000")
        .text(`${data.weightedPercent.toFixed(1)}%  (${data.totalScore.toFixed(1)} / ${data.totalMaxScore.toFixed(1)})`);

      doc.moveDown(0.6);
      doc.fontSize(13).fillColor("#111").text("By Category");
      doc.moveDown(0.2);
      doc.fontSize(10);
      data.categoryScores.forEach((c) => {
        doc.fillColor("#000").text(
          `• ${c.name} — ${c.percent.toFixed(1)}%  (${c.score.toFixed(1)} / ${c.maxScore.toFixed(1)}, weight ${c.weight}x)`,
        );
      });

      if (data.generalNotes && data.generalNotes.trim()) {
        doc.moveDown(0.6);
        doc.fontSize(13).fillColor("#111").text("Auditor Notes");
        doc.fontSize(10).fillColor("#000").text(data.generalNotes);
      }

      doc.moveDown(0.8);
      doc.fontSize(13).fillColor("#111").text("Item Responses");
      doc.moveDown(0.2);
      doc.fontSize(10);

      let lastCat = "";
      data.responses.forEach((r) => {
        if (r.categoryName !== lastCat) {
          doc.moveDown(0.3);
          doc.fillColor("#333").fontSize(11).text(r.categoryName);
          doc.fontSize(10).fillColor("#000");
          lastCat = r.categoryName;
        }
        doc.text(`  ${r.itemLabel} — ${r.score} / ${r.maxScore}${r.photoCount ? `  (${r.photoCount} photo${r.photoCount === 1 ? "" : "s"})` : ""}`);
        if (r.notes && r.notes.trim()) {
          doc.fillColor("#666").text(`    Notes: ${r.notes}`).fillColor("#000");
        }
      });

      if (data.correctiveActions.length > 0) {
        doc.moveDown(0.8);
        doc.fontSize(13).fillColor("#111").text("Corrective Actions");
        doc.moveDown(0.2);
        doc.fontSize(10);
        data.correctiveActions.forEach((a, i) => {
          doc.fillColor("#000").text(`${i + 1}. [${a.priority.toUpperCase()}] ${a.description}`);
          doc.fillColor("#666").text(`   Status: ${a.status} · Due: ${fmtDate(a.dueDate)}`).fillColor("#000");
        });
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export async function uploadMysteryAuditPdf(
  pdf: Buffer,
  restaurantId: number,
  uploaderId?: number | null,
): Promise<string> {
  const svc = new ObjectStorageService();
  const uploadURL = await svc.getObjectEntityUploadURL();
  const objectPath = svc.normalizeObjectEntityPath(uploadURL);
  const put = await fetch(uploadURL, {
    method: "PUT",
    body: pdf,
    headers: { "Content-Type": "application/pdf" },
  });
  if (!put.ok) throw new Error(`PDF upload failed: ${put.status}`);
  const file = await svc.getObjectEntityFile(objectPath);
  await setObjectAclPolicy(file, {
    restaurantId: String(restaurantId),
    uploaderId: uploaderId ? String(uploaderId) : undefined,
    visibility: "private",
  });
  return objectPath;
}
