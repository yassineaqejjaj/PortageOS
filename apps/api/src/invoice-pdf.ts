import PDFDocument from "pdfkit";

export interface PdfSeller { legalName?: string | null; legalForm?: string | null; siren?: string | null; vatNumber?: string | null; address?: string | null; postalCode?: string | null; city?: string | null; iban?: string | null }
export interface PdfInvoice {
  number: string | null; status: string; issueDate: string | null; dueDate: string | null; paymentTermsDays: number | null; series: string;
  buyer: { name: string; siren: string | null; address: string | null };
  lines: { description: string; unit: string; quantity: string; unitPrice: string; vatRate: string; net: string }[];
  net: string; vat: string; gross: string; paid: string;
}
const eur = (v: string | number) => { const n = Number(v); const [i, d] = Math.abs(n).toFixed(2).split("."); return `${n < 0 ? "-" : ""}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${d} EUR`; };
const fr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
export const sellerComplete = (s: PdfSeller) => !!(s.legalName && s.siren && s.address && s.postalCode && s.city);

/** Facture PDF « document de travail » : n'a AUCUNE valeur de facture électronique (aucune plateforme agréée n'est connectée) ; les mentions manquantes du vendeur sont signalées, jamais inventées. */
export function renderInvoicePdf(seller: PdfSeller, inv: PdfInvoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, compress: process.env.PDF_UNCOMPRESSED !== "1", info: { Title: inv.number ? `Facture ${inv.number}` : "Facture (brouillon)", Producer: "PORTAGE OS" } });
    const chunks: Buffer[] = []; doc.on("data", c => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const complete = sellerComplete(seller); const W = doc.page.width - 96;
    if (inv.status === "draft") doc.save().rotate(-30, { origin: [300, 420] }).fontSize(90).fillColor("#E5E7EB").text("BROUILLON", 70, 380, { lineBreak: false }).restore();
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(18).text(inv.status === "draft" ? "Facture (brouillon)" : `Facture ${inv.number ?? ""}`, 48, 48);
    doc.font("Helvetica").fontSize(9).fillColor("#374151").text(`Date d'émission : ${fr(inv.issueDate)}`, 48, 74).text(`Échéance : ${inv.dueDate ? fr(inv.dueDate) : inv.paymentTermsDays == null ? "non précisée (aucun délai convenu)" : "—"}`);
    // vendeur / acheteur
    const y0 = 110; doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827").text("Vendeur", 48, y0).text("Client", 320, y0);
    doc.font("Helvetica").fontSize(9).fillColor("#374151");
    doc.text([seller.legalName ?? "(raison sociale non renseignée)", seller.legalForm, seller.address, [seller.postalCode, seller.city].filter(Boolean).join(" "), seller.siren ? `SIREN ${seller.siren}` : "SIREN non renseigné", seller.vatNumber ? `TVA ${seller.vatNumber}` : null].filter(Boolean).join("\n"), 48, y0 + 14, { width: 250 });
    doc.text([inv.buyer.name, inv.buyer.address, inv.buyer.siren ? `SIREN ${inv.buyer.siren}` : null].filter(Boolean).join("\n"), 320, y0 + 14, { width: 227 });
    // lignes
    let y = 230; const cols = [48, 270, 320, 380, 440, 495]; // description, unité, qté, PU, TVA, HT
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827");
    ["Désignation", "Unité", "Qté", "PU HT", "TVA", "Total HT"].forEach((h, i) => doc.text(h, cols[i]!, y, { width: i === 0 ? 215 : 52, align: i >= 2 ? "right" : "left" }));
    doc.moveTo(48, y + 13).lineTo(48 + W, y + 13).strokeColor("#9CA3AF").stroke(); y += 20;
    doc.font("Helvetica").fontSize(8.5).fillColor("#374151");
    for (const l of inv.lines) {
      const h = doc.heightOfString(l.description, { width: 215 }); if (y + h > 700) { doc.addPage(); y = 60; }
      doc.text(l.description, cols[0]!, y, { width: 215 }); doc.text(l.unit, cols[1]!, y, { width: 48 });
      doc.text(String(Number(l.quantity)).replace(".", ","), cols[2]!, y, { width: 52, align: "right" }); doc.text(eur(l.unitPrice), cols[3]!, y, { width: 58, align: "right" });
      doc.text(`${String(Number(l.vatRate)).replace(".", ",")} %`, cols[4]!, y, { width: 48, align: "right" }); doc.text(eur(l.net), cols[5]!, y, { width: 52, align: "right" });
      y += Math.max(h, 12) + 6;
    }
    doc.moveTo(48, y).lineTo(48 + W, y).strokeColor("#D1D5DB").stroke(); y += 10;
    const tot = (k: string, v: string, bold = false) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10 : 9).fillColor("#111827").text(k, 340, y, { width: 100 }).text(v, 440, y, { width: 107, align: "right" }); y += bold ? 18 : 14; };
    tot("Total HT", eur(inv.net)); tot("TVA", eur(inv.vat)); tot("Total TTC", eur(inv.gross), true);
    if (Number(inv.paid) > 0) { tot("Déjà réglé", eur(inv.paid)); tot("Reste à payer", eur(Number(inv.gross) - Number(inv.paid)), true); }
    if (seller.iban) { y += 6; doc.font("Helvetica").fontSize(9).fillColor("#374151").text(`Règlement par virement — IBAN ${seller.iban}`, 48, y, { width: W }); }
    // avertissements
    const notes = [!complete && "Mentions du vendeur incomplètes (raison sociale, SIREN, adresse) : document de travail, à compléter dans les paramètres de la société avant tout envoi.",
      "Document généré par PORTAGE OS. Il n'a pas été transmis par une plateforme de facturation électronique agréée (non connectée) et ne constitue pas, en l'état, une facture électronique conforme."].filter(Boolean) as string[];
    doc.font("Helvetica").fontSize(7.5).fillColor("#6B7280").text(notes.join("\n"), 48, 770, { width: W });
    doc.end();
  });
}
