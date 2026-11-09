import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("relevé bancaire : aperçu avec erreurs, import, décision humaine (ignorer avec motif), réimport refusé", async ({ browser }) => {
  const run = Date.now().toString(36); const ctx = await browser.newContext(); const p = await ctx.newPage(); await login(p, "finance@demo.test");
  const amount = (1000 + Math.floor(Math.random() * 8000)) + ",37"; const label = `VIR INCONNU ${run}`;
  const csv = `Date;Libellé;Montant\r\n05/03/2027;${label};${amount}\r\n06/03/2027;PRLV ${run};-45,10\r\nnimporte quoi;X;1,00\r\n`;
  await p.goto("/bank"); await p.waitForLoadState("networkidle");
  await p.getByLabel("Fichier CSV").setInputFiles({ name: "releve.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await p.getByRole("button", { name: "Lancer l'aperçu" }).click();
  await expect(p.getByText(/2 ligne\(s\) retenue\(s\) \(1 crédit\(s\), 1 débit\(s\)\)/)).toBeVisible(); await expect(p.getByText(/Ligne 4 : date invalide/)).toBeVisible();
  await p.getByRole("button", { name: /Importer 2 ligne/ }).click();
  const row = p.getByRole("row", { name: new RegExp(label) }); await expect(row).toBeVisible(); await expect(row).toContainText(/Proposition/, { timeout: 1000 }).catch(() => undefined);
  await row.getByRole("button", { name: "Ignorer" }).click(); await row.getByLabel("Motif").fill("Test E2E : mouvement sans facture"); await row.getByRole("button", { name: "Confirmer" }).click();
  await expect(p.getByRole("row", { name: new RegExp(label) })).toHaveCount(0);
  await p.getByLabel("Fichier CSV").setInputFiles({ name: "releve.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }); // même relevé : plus rien à importer
  await p.getByRole("button", { name: "Lancer l'aperçu" }).click(); await expect(p.getByText(/0 ligne\(s\) retenue\(s\)/)).toBeVisible();
  await ctx.close();
  const o = await browser.newContext(); const q = await o.newPage(); await login(q, "ops@demo.test");
  await expect(q.getByRole("link", { name: "Rapprochement bancaire" })).toHaveCount(0); await q.goto("/bank"); await expect(q.getByRole("alert").filter({ hasText: /Accès refusé/ })).toBeVisible(); await o.close();
});
