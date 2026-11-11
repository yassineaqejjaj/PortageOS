import PDFDocument from "pdfkit";
import type { SalarySimulation } from "@portage/domain";

export interface SalaryPdfMeta { brand: string; date: string; contact: { name: string; phone?: string | null; email?: string | null }; reference?: string }

const eur = (v: string) => { const n = Number(v); const [i, d] = Math.abs(n).toFixed(2).split("."); return `${n < 0 ? "-" : ""}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${d} €`; };
const pct = (v: string) => `${v.replace(".", ",")}%`;
const frDate = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Simulation de salaire au format de la feuille de référence : une page par scénario (brut annuel).
 * Document ESTIMATIF non contractuel ; ne contient jamais l'indicateur interne d'enveloppe ni la grille de PAS.
 */
export function renderSalaryPdf(meta: SalaryPdfMeta, scenarios: SalarySimulation[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, compress: process.env.PDF_UNCOMPRESSED !== "1", info: { Title: `Simulation de salaire ${frDate(meta.date)}`, Producer: "PORTAGE OS" } });
    const chunks: Buffer[] = []; doc.on("data", c => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const L = 56, W = 595 - 112, GREY = "#D1D5DB";
    const row = (x: number, y: number, w: number, label: string, value: string, o: { bold?: boolean; fill?: string; color?: string; h?: number } = {}) => {
      const h = o.h ?? 13.5;
      if (o.fill) doc.rect(x, y, w, h).fill(o.fill);
      doc.rect(x, y, w, h).lineWidth(0.4).strokeColor(GREY).stroke();
      doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(o.color ?? "#111827").text(label, x + 3, y + 3.5, { width: w * 0.9, lineBreak: false });
      doc.text(value, x + w * 0.5, y + 3.5, { width: w * 0.5 - 4, align: "right", lineBreak: false });
      return y + h;
    };
    scenarios.forEach((s, idx) => {
      if (idx) doc.addPage();
      doc.fillColor("#111827").font("Helvetica").fontSize(11).text(meta.brand, L, 56, { lineBreak: false });
      doc.fontSize(11).text("Simulation de salaire", 330, 56, { width: 210, align: "center", lineBreak: false });
      doc.fontSize(7).text(frDate(meta.date), 330, 70, { width: 210, align: "center", lineBreak: false });
      // Contact
      doc.font("Helvetica-Bold").fontSize(8.5).text("Contact:", L, 138, { lineBreak: false });
      doc.font("Helvetica").text([meta.contact.name, meta.contact.phone, meta.contact.email].filter(Boolean).join("\n"), L, 150, { width: 230 });
      // Variables
      const vx = 330, vw = 210; let y = 138;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827").text("Variables:", vx, y, { lineBreak: false }); y += 12;
      y = row(vx, y, vw, "TJM", eur(s.variables.tjm), { h: 11.5 });
      y = row(vx, y, vw, "Nombre de jours travaillés par mois", s.variables.daysPerMonth, { h: 11.5 });
      y = row(vx, y, vw, "Frais forfaitaires journalier", eur(s.variables.dailyExpenses), { h: 11.5 });
      y = row(vx, y, vw, "Mutuelle", eur(s.variables.mutualMonthly), { h: 11.5 });
      // Rémunération
      y = 262; doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827").text("Rémunération:", L, y, { lineBreak: false }); y += 12;
      y = row(L, y, W, "Frais professionnels", eur(s.professionalExpenses));
      y = row(L, y, W, "Salaire brut annuel", eur(s.grossAnnual));
      y = row(L, y, W, "Salaire brut mensuel", eur(s.grossMonthly));
      y = row(L, y, W, "Salaire NET avant PAS", eur(s.netBeforePas));
      y = row(L, y, W, "Taux impôt à la source", pct(s.pasRatePercent));
      y = row(L, y, W, "Salaire NET après PAS", eur(s.netAfterPas));
      y = row(L, y, W, "Montant NET que vous percevez tous les mois après impôts", eur(s.netPaidMonthly), { fill: "#34A853", color: "#FFFFFF" });
      doc.font("Helvetica").fontSize(8.5).fillColor("#111827").text("(salaire net après impôts + Frais + Mutuelle)", L, y + 2, { lineBreak: false });
      doc.text(`ET ${s.paidLeaveDays} jours de congés payés`, L, y + 13, { lineBreak: false });
      // Jours de congés non pris
      y += 36;
      doc.text("Salaire", 400, y, { width: 70, align: "right", lineBreak: false }); doc.text("Frais", 470, y, { width: 70, align: "right", lineBreak: false }); y += 11;
      doc.text(`Si vous ne prenez pas les ${s.paidLeaveDays} jours, vous aurez droit au montant suivant par jour non pris:`, L, y, { lineBreak: false });
      doc.text(eur(s.salaryPerLeaveDay), 400, y, { width: 70, align: "right", lineBreak: false }); doc.text(eur(s.expensesPerLeaveDay), 470, y, { width: 70, align: "right", lineBreak: false }); y += 11;
      doc.text("Soit un total par jour de", L, y, { lineBreak: false }); doc.text(eur(s.totalPerLeaveDay), 400, y, { width: 70, align: "right", lineBreak: false }); y += 11;
      doc.text(`Soit un montant supplémentaire pour ${s.paidLeaveDays} jours non pris:`, L, y, { lineBreak: false }); doc.text(eur(s.extraForUntakenLeave), 400, y, { width: 70, align: "right", lineBreak: false });
      // Vague de pied de page
      const wy = 640;
      const g = doc.linearGradient(L, wy, L + W, wy); g.stop(0, "#5BEBD2").stop(1, "#0A9D98");
      doc.path(`M ${L} ${wy + 8} C ${L + 170} ${wy + 24}, ${L + 330} ${wy - 6}, ${L + W} ${wy - 4} L ${L + W} ${wy + 40} L ${L} ${wy + 40} Z`).fill(g);
      doc.path(`M ${L} ${wy + 8} C ${L + 200} ${wy + 20}, ${L + 380} ${wy - 22}, ${L + W} ${wy - 16} L ${L + W} ${wy - 4} C ${L + 330} ${wy - 6}, ${L + 170} ${wy + 24}, ${L} ${wy + 8} Z`).fill("#2F6F9F");
      doc.font("Helvetica-BoldOblique").fontSize(6.5).fillColor("#EF4444").text(`Simulation non contractuelle et exclusive au destinataire. Ne pas diffuser. Tous droits réservés à ${meta.brand}`, L, wy + 48, { width: W, align: "center", lineBreak: false });
    });
    doc.end();
  });
}
