import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const as = async (browser: import("@playwright/test").Browser, email: string) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await login(page, email); return { ctx, page }; };
const tomorrow = () => { const d = new Date(Date.now() + 86400_000); return d.toISOString().slice(0, 10); };

test("prospect : score explicable, interaction, tâche, simulation ; import CSV avec aperçu puis annulation", async ({ browser }) => {
  const run = Date.now().toString(36); const name = `Prospect CRM ${run}`;
  const c = await as(browser, "commerce@demo.test");
  await c.page.goto("/crm/prospects");
  await c.page.getByLabel("Nom", { exact: true }).fill(name); await c.page.getByLabel("Email").fill(`crm-${run}@example.test`);
  await c.page.getByRole("button", { name: "Ajouter le prospect" }).click();
  await c.page.getByRole("link", { name }).click();
  await expect(c.page.getByRole("heading", { name })).toBeVisible();
  await expect(c.page.getByText(/Email renseigné/)).toBeVisible(); // chaque point du score est justifié
  await expect(c.page.getByText(/pas une décision automatisée/)).toBeVisible();

  await c.page.getByLabel("Résumé", { exact: true }).fill("Premier échange téléphonique");
  await c.page.getByRole("button", { name: "Journaliser" }).click();
  await expect(c.page.getByText("Premier échange téléphonique")).toBeVisible();
  await c.page.getByLabel("Intitulé de la tâche").fill(`Relancer ${run}`); await c.page.getByLabel("Échéance").fill(tomorrow());
  await c.page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(c.page.getByText(`Relancer ${run}`)).toBeVisible();

  await c.page.getByLabel("TJM (€)").fill("650"); await c.page.getByLabel("Frais de gestion (%)").fill("10");
  await c.page.getByRole("button", { name: "Simuler" }).click();
  await expect(c.page.getByText(/hypothèse saisie/)).toBeVisible();
  await expect(c.page.getByText(/ni un calcul de rémunération/)).toBeVisible();

  await c.page.goto("/crm/imports");
  const csv = `Nom;Email\r\nImport A ${run};a-${run}@example.test\r\nImport B ${run};pas-un-email\r\n`;
  await c.page.getByLabel("Fichier CSV").setInputFiles({ name: "salon.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await c.page.getByRole("button", { name: "Lancer l'aperçu" }).click();
  await expect(c.page.getByText(/1 ligne\(s\) valide\(s\) sur 2/)).toBeVisible(); await expect(c.page.getByText("email invalide")).toBeVisible();
  await c.page.getByRole("button", { name: /Importer 1 prospect/ }).click();
  await expect(c.page.getByRole("row", { name: /salon\.csv.*Importé/ }).first()).toBeVisible();
  c.page.once("dialog", d => d.accept());
  await c.page.getByRole("row", { name: /salon\.csv.*Importé/ }).first().getByRole("button", { name: "Annuler l'import" }).click();
  await expect(c.page.getByRole("row", { name: /salon\.csv.*Annulé/ }).first()).toBeVisible();
  await c.ctx.close();

  const o = await as(browser, "ops@demo.test"); // hors périmètre commercial
  await o.page.goto("/crm/campaigns"); await expect(o.page.getByRole("alert").filter({ hasText: /Accès refusé/ })).toBeVisible();
  await o.ctx.close();
});

test("campagne, apporteur, parrainage → commission à la conversion → approbation à quatre yeux → paiement", async ({ browser }) => {
  const run = Date.now().toString(36); const co = `Société parrainée ${run}`; const ref = `Apporteur ${run}`;
  const c = await as(browser, "commerce@demo.test");
  await c.page.goto("/crm/campaigns");
  await c.page.getByLabel("Nom", { exact: true }).fill(`Campagne ${run}`); await c.page.getByLabel("Budget (€)").fill("500");
  await c.page.getByRole("button", { name: "Créer la campagne" }).click();
  await expect(c.page.getByRole("row", { name: new RegExp(`Campagne ${run}.*Brouillon`) })).toBeVisible();
  await c.page.getByRole("row", { name: new RegExp(`Campagne ${run}`) }).getByRole("button", { name: "Lancer" }).click();
  await expect(c.page.getByRole("row", { name: new RegExp(`Campagne ${run}.*Active`) })).toBeVisible();

  await c.page.goto("/crm/referrers");
  await c.page.getByLabel("Nom", { exact: true }).fill(ref); await c.page.getByLabel("Email").fill(`app-${run}@example.test`);
  await c.page.getByRole("button", { name: "Ajouter l'apporteur" }).click();
  await expect(c.page.getByRole("row", { name: new RegExp(ref) })).toBeVisible();

  await c.page.goto("/crm/prospects");
  await c.page.getByLabel("Type").selectOption("company"); await c.page.getByLabel("Nom", { exact: true }).fill(co); await c.page.getByLabel("Email").fill(`co-${run}@example.test`);
  await c.page.getByRole("button", { name: "Ajouter le prospect" }).click();
  await c.page.getByRole("link", { name: co }).click();
  await c.page.getByLabel("Apporteur").selectOption({ label: ref }); await c.page.getByLabel("Montant (€)").fill("200");
  await c.page.getByRole("button", { name: "Enregistrer le parrainage" }).click();
  await expect(c.page.getByText(/Forfait de .*200.* à la conversion \(règle figée\)/)).toBeVisible();
  await c.page.goto("/crm/prospects");
  const row = () => c.page.getByRole("row", { name: new RegExp(co) });
  await row().getByRole("button", { name: "Marquer contacté" }).click(); await row().getByRole("button", { name: "Qualifier" }).click(); await row().getByRole("button", { name: "Convertir" }).click();
  await expect(row().getByText("Converti")).toBeVisible();

  await c.page.goto("/crm/referrers");
  const com = c.page.getByRole("row", { name: new RegExp(`${ref}.*Conversion.*forfait`) });
  await expect(com).toBeVisible(); await expect(com.getByRole("button", { name: "Approuver" })).toHaveCount(0); // le commercial n'approuve pas
  await c.ctx.close();

  const a = await as(browser, "admin@demo.test");
  await a.page.goto("/crm/referrers");
  await a.page.getByRole("row", { name: new RegExp(`${ref}.*Conversion.*forfait`) }).getByRole("button", { name: "Approuver" }).click();
  await expect(a.page.getByRole("row", { name: new RegExp(`${ref}.*Conversion.*Approuvée`) })).toBeVisible();
  await a.ctx.close();

  const f = await as(browser, "finance@demo.test");
  await f.page.goto("/crm/referrers");
  await f.page.getByRole("row", { name: new RegExp(`${ref}.*Conversion.*Approuvée`) }).getByRole("button", { name: "Payer" }).click();
  await f.page.getByLabel("Référence du virement").fill(`VIR-${run}`); await f.page.getByRole("button", { name: "Confirmer le paiement" }).click();
  await expect(f.page.getByRole("row", { name: new RegExp(`${ref}.*Conversion.*Payée`) })).toBeVisible();
  await f.ctx.close();
});

test("accord-cadre : création, activation et alerte d'échéance", async ({ browser }) => {
  const run = Date.now().toString(36); const c = await as(browser, "commerce@demo.test");
  await c.page.goto("/crm/agreements");
  const soon = new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10);
  await c.page.getByLabel("Client").selectOption({ index: 1 });
  await c.page.getByLabel("Intitulé").fill(`Accord ${run}`); await c.page.getByLabel("Début").fill(new Date().toISOString().slice(0, 10)); await c.page.getByLabel("Fin").fill(soon);
  await c.page.getByLabel("Profil 1").fill("Senior"); await c.page.getByLabel("TJM plafond 1").fill("700");
  await c.page.getByRole("button", { name: "Créer l'accord" }).click();
  const row = c.page.getByRole("row", { name: new RegExp(`Accord ${run}`) }); await expect(row).toContainText("Brouillon");
  await row.getByRole("button", { name: "Activer" }).click();
  await expect(row).toContainText("Actif"); await expect(row).toContainText(/Échéance dans \d+ j/); await expect(row).toContainText(/Senior : 700,00/);
  await c.ctx.close();
});
