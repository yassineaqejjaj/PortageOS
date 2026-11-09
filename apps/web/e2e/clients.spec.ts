import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("fiche client : conditions, contact référent, site, bon de commande ; lecture seule pour l'exploitation", async ({ browser }) => {
  const run = Date.now().toString(36); const name = `Client fiche ${run}`;
  const a = await browser.newContext(); const p = await a.newPage(); await login(p, "admin@demo.test");
  await p.goto("/companies"); await p.getByLabel("Nom", { exact: true }).fill(name); await p.getByRole("button", { name: /Ajouter|Créer/ }).first().click();
  await p.getByRole("link", { name }).click(); await expect(p.getByRole("heading", { name })).toBeVisible();

  await p.getByLabel("Délai de paiement (jours)").fill("45"); await p.getByRole("button", { name: "Enregistrer" }).click();
  await expect(p.getByText(/Actuel : 45/)).toBeVisible();
  await p.getByLabel("Nom du contact").fill("Alice Facturation"); await p.getByLabel("Email", { exact: true }).fill(`alice-${run}@example.test`); await p.getByLabel("Référent pour ce rôle").check();
  await p.getByRole("button", { name: "Ajouter le contact" }).click();
  await expect(p.getByRole("row", { name: /Alice Facturation.*Facturation.*Référent/ })).toBeVisible();
  await p.getByLabel("Libellé du site").fill("Siège"); await p.getByLabel("Adresse", { exact: true }).fill("1 rue de Test"); await p.getByLabel("Code postal").fill("75001"); await p.getByLabel("Ville").fill("Paris");
  await p.getByRole("button", { name: "Ajouter le site" }).click(); await expect(p.getByText(/1 rue de Test, 75001 Paris/)).toBeVisible();
  await p.getByLabel("Référence", { exact: true }).fill(`BC-${run}`); await p.getByLabel("Montant HT (€)").fill("10000");
  await p.getByLabel("Début").fill("2026-01-01"); await p.getByLabel("Fin").fill("2026-12-31"); await p.getByRole("button", { name: "Ajouter le bon de commande" }).click();
  const row = p.getByRole("row", { name: new RegExp(`BC-${run}`) }); await expect(row).toContainText("Ouvert"); await expect(row).toContainText(/10\s?000,00/);
  await row.getByRole("button", { name: "Clore" }).click(); await expect(row).toContainText("Clos");
  const url = p.url(); await a.close();

  const o = await browser.newContext(); const q = await o.newPage(); await login(q, "ops@demo.test");
  await q.goto(url); await expect(q.getByRole("heading", { name })).toBeVisible();
  await expect(q.getByRole("button", { name: "Ajouter le contact" })).toHaveCount(0); await expect(q.getByRole("button", { name: "Retirer Alice Facturation" })).toHaveCount(0);
  await o.close();
});
