import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("pilotage : indicateurs définis et sourcés, graphique accessible, export CSV", async ({ page }) => {
  await login(page, "direction@demo.test");
  await page.goto("/pilotage");
  await expect(page.getByRole("heading", { name: "Pilotage" })).toBeVisible();
  for (const label of ["CA HT facturé", "Encaissé HT", "Frais de gestion", "Créances ouvertes TTC", "DSO", "Consultants actifs", "Conversion des prospects", "Délai d’approbation client"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Chiffre d'affaires HT facturé et encaissé par mois/ })).toBeVisible();
  await expect(page.getByText("Données du graphique")).toBeVisible(); // alternative tabulaire
  await page.getByText("Définition").first().click();
  await expect(page.getByText(/Somme des montants HT des factures émises/)).toBeVisible();
  await expect(page.getByText(/MRR SaaS/)).toBeVisible(); // indicateur non applicable déclaré
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter en CSV" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^pilotage-\d{4}-\d{2}-\d{4}-\d{2}\.csv$/);
  const text = (await (await import("node:fs/promises")).readFile(await dl.path(), "utf8"));
  expect(text.split("\r\n")[0]).toBe("mois;ca_ht_eur;ca_ttc_eur;encaisse_ht_eur;frais_gestion_eur");
});

test("pilotage : refusé aux rôles sans droit, absent de leur navigation", async ({ page }) => {
  await login(page, "ops@demo.test");
  await expect(page.getByRole("link", { name: "Pilotage" })).toHaveCount(0);
  await page.goto("/pilotage");
  await expect(page.getByRole("alert").filter({ hasText: "Accès refusé" })).toBeVisible();
});
