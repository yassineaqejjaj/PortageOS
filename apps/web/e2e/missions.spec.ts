import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("mission : avenant de tarif et budget journalisés; contact client modifiable", async ({ page: p0, browser }) => {
  const Y = 3000 + Math.floor(Math.random() * 6999), run = Date.now().toString(36), title = `Avenant E2E ${run}`;
  let page = p0; await login(page, "ops@demo.test");
  await page.goto("/missions");
  await page.getByLabel("Consultant (actif)").selectOption({ label: "Camille Moreau (fictive)" });
  await page.getByLabel("Client", { exact: true }).selectOption({ label: "Banque Méridienne (fictive)" });
  await page.getByLabel("Intitulé").fill(title);
  await page.getByLabel("TJM HT (€)").fill("500"); await page.getByLabel("Taux de TVA (%)").fill("20");
  await page.getByLabel("Début", { exact: true }).fill(`${Y}-01-01`); await page.getByLabel("Fin (facultatif)").fill(`${Y}-06-30`);
  await page.getByRole("button", { name: "Créer la mission" }).click();
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/Tarif journalier actuel/)).toContainText("500");

  await page.getByLabel("Nouveau TJM HT (€)").fill("560"); await page.getByLabel("À compter du mois").fill(`${Y}-03`); await page.getByLabel("Motif (obligatoire)").fill("Revalorisation annuelle");
  await page.getByRole("button", { name: "Enregistrer l’avenant" }).click();
  await expect(page.getByRole("row", { name: /Tarif.*à compter de/ })).toContainText("Revalorisation annuelle");
  await expect(page.getByText(/Tarif journalier actuel/)).toBeVisible();

  await page.getByLabel("Type d’avenant").selectOption("budget");
  await page.getByLabel("Budget HT (€)").fill("10000"); await page.getByLabel("Motif (obligatoire)").fill("Budget du bon de commande");
  await page.getByRole("button", { name: "Enregistrer l’avenant" }).click();
  await expect(page.getByText(/Budget .*10.*000.* HT · consommé/)).toBeVisible();

  await page.getByLabel("Type d’avenant").selectOption("extend");
  await page.getByLabel("Nouvelle date de fin").fill(`${Y}-06-30`); await page.getByLabel("Motif (obligatoire)").fill("Prolongation test");
  await page.getByRole("button", { name: "Enregistrer l’avenant" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Avenant refusé" })).toContainText("postérieure"); // même fin : refusé

  const ctx = await browser.newContext(); page = await ctx.newPage(); await login(page, "admin@demo.test");
  await page.goto("/companies");
  await page.getByRole("link", { name: /Banque Méridienne/ }).first().click();
  await page.getByLabel("Nom du contact").fill(`Contact ${run}`); await page.getByLabel("Email", { exact: true }).fill(`c-${run}@demo.test`);
  await page.getByRole("button", { name: "Ajouter le contact" }).click();
  await page.getByRole("button", { name: `Modifier Contact ${run}` }).click();
  await page.getByLabel("Nom du contact").fill(`Contact modifié ${run}`);
  await page.getByRole("button", { name: "Enregistrer le contact" }).click();
  await expect(page.getByRole("cell", { name: `Contact modifié ${run}`, exact: true })).toBeVisible();
});
