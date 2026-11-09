import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("identité du vendeur renseignée par l'administrateur ; PDF de facture téléchargeable ; lecture seule sans droit de facturation", async ({ browser }) => {
  const run = Date.now().toString(36); const a = await browser.newContext(); const p = await a.newPage(); await login(p, "admin@demo.test");
  await p.goto("/settings/company"); await p.waitForLoadState("networkidle");
  await p.getByLabel("Raison sociale").fill(`Société de portage DEMO ${run}`); await p.getByLabel("SIREN").fill("552100554"); await p.getByLabel("Adresse").fill("1 rue de la Paix"); await p.getByLabel("Code postal").fill("75002"); await p.getByLabel("Ville").fill("Paris");
  await p.getByRole("button", { name: "Enregistrer" }).click(); await expect(p.getByText("Identité enregistrée.")).toBeVisible(); await expect(p.getByText(/Mentions du vendeur complètes/)).toBeVisible();
  await p.goto("/invoices"); await p.waitForLoadState("networkidle");
  const link = p.locator("table.tbl a[href^='/invoices/']").first(); await expect(link).toBeVisible(); await link.click();
  await expect(p.getByRole("heading", { name: "Lignes" })).toBeVisible(); await expect(p.getByText(/Totaux \(somme des lignes\)/)).toBeVisible();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Télécharger le PDF" }).click()]); expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  const url = p.url(); await a.close();
  const o = await browser.newContext(); const q = await o.newPage(); await login(q, "ops@demo.test");
  await q.goto("/settings/company"); await expect(q.getByText(/Lecture seule/)).toBeVisible(); await expect(q.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);
  await q.goto(url); await expect(q.getByRole("heading", { name: "Lignes" })).toBeVisible(); await expect(q.getByRole("button", { name: "Ajouter la ligne" })).toHaveCount(0); await o.close();
});
