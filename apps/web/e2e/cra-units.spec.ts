import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const as = async (browser: import("@playwright/test").Browser, email: string) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await login(page, email); return { ctx, page }; };

test("CRA en heures : mission horaire, saisie, import CSV tout-ou-rien, relance et export", async ({ browser }) => {
  const Y = 3000 + Math.floor(Math.random() * 6999), run = Date.now().toString(36);
  const title = `Heures E2E ${run}`;

  const o = await as(browser, "ops@demo.test");
  await o.page.goto("/missions");
  await o.page.getByLabel("Consultant (actif)").selectOption({ label: "Camille Moreau (fictive)" });
  await o.page.getByLabel("Client", { exact: true }).selectOption({ label: "Banque Méridienne (fictive)" });
  await o.page.getByLabel("Intitulé").fill(title);
  await o.page.getByLabel("Unité de saisie du CRA").selectOption("hour");
  await o.page.getByLabel("Tarif horaire HT (€)").fill("80"); await o.page.getByLabel("Taux de TVA (%)").fill("20");
  await o.page.getByLabel("Début", { exact: true }).fill(`${Y}-01-01`);
  await o.page.getByRole("button", { name: "Créer la mission" }).click();
  await expect(o.page.getByRole("row", { name: new RegExp(title) }).getByRole("cell", { name: "Heures", exact: true })).toBeVisible();
  await o.ctx.close();

  const c = await as(browser, "consultant@demo.test");
  await c.page.goto("/me/timesheets");
  await expect(c.page.getByLabel("Mission", { exact: true })).toBeVisible();
  const val = await c.page.getByLabel("Mission", { exact: true }).locator("option", { hasText: title }).getAttribute("value");
  await c.page.getByLabel("Mission", { exact: true }).selectOption(val!);
  await c.page.getByLabel("Mois", { exact: true }).fill(`${Y}-03`);
  await expect(c.page.getByText(/Unité de cette mission : heures/)).toBeVisible();
  await c.page.getByLabel("02", { exact: true }).fill("7.5");
  await expect(c.page.getByText(/Total : 7,5 heure\(s\)/)).toBeVisible();
  await c.page.getByRole("button", { name: "Importer un CSV" }).click();
  await c.page.getByLabel(/Une ligne par jour/).fill(`date;quantite\n${Y}-03-03;8\n${Y}-03-04;25\n${Y}-04-01;1`);
  await c.page.getByRole("button", { name: "Remplacer le brouillon par ce fichier" }).click();
  await expect(c.page.getByRole("alert").filter({ hasText: "aucune ligne enregistrée" })).toContainText("quantité");
  await c.page.getByLabel(/Une ligne par jour/).fill(`date;quantite\n${Y}-03-03;8\n${Y}-03-04;7,25`);
  await c.page.getByRole("button", { name: "Remplacer le brouillon par ce fichier" }).click();
  await expect(c.page.getByText(/Total : 15,25 heure\(s\)/)).toBeVisible();
  await c.ctx.close();

  const o2 = await as(browser, "ops@demo.test");
  await o2.page.goto("/timesheets");
  await o2.page.getByLabel("Mois", { exact: true }).fill(`${Y}-03`);
  await o2.page.getByRole("button", { name: "Relancer les CRA manquants" }).click();
  await expect(o2.page.getByRole("status")).toContainText("relance(s) envoyée(s)");
  const [dl] = await Promise.all([o2.page.waitForEvent("download"), o2.page.getByRole("button", { name: "Exporter en CSV" }).click()]);
  expect(dl.suggestedFilename()).toBe(`cra-${Y}-03.csv`);
  await o2.ctx.close();
});
