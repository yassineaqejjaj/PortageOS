import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const Y = 3000 + Math.floor(Math.random() * 6999); // période unique par exécution : pas de chevauchement de paramètres
const SOURCE = "Source de test E2E (valeur fictive, non réglementaire)";
const as = async (browser: import("@playwright/test").Browser, email: string) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await login(page, email); return { ctx, page }; };

test("paramètres à quatre yeux → note de frais (barème appliqué) → approbation → remboursement", async ({ browser }) => {
  // 1. Conformité saisit deux brouillons ; elle ne peut pas les approuver elle-même
  const c = await as(browser, "compliance@demo.test");
  await c.page.goto("/rules");
  for (const [key, value, unit] of [["expense.mileage_rate_eur_per_km", "0.50", "EUR/km"], ["management_fee_rate_percent", "10", "%"]]) {
    await c.page.getByLabel("Clé").fill(key); await c.page.getByLabel("Valeur").fill(value); await c.page.getByLabel("Unité").fill(unit);
    await c.page.getByLabel("Valable à partir du").fill(`${Y}-01-01`); await c.page.getByLabel(/Jusqu’au/).fill(`${Y}-12-31`);
    await c.page.getByLabel("Source officielle").fill(SOURCE);
    await c.page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
    await expect(c.page.getByRole("row", { name: new RegExp(`${key}.*01/01/${Y}`) })).toBeVisible();
  }
  await expect(c.page.getByRole("button", { name: "Approuver" })).toHaveCount(0);
  await expect(c.page.getByText("Auteur : approbation par un tiers requise").first()).toBeVisible();
  await c.ctx.close();

  // 2. L'administrateur approuve
  const a = await as(browser, "admin@demo.test");
  await a.page.goto("/rules");
  for (const key of ["expense.mileage_rate_eur_per_km", "management_fee_rate_percent"]) {
    const row = a.page.getByRole("row", { name: new RegExp(`${key}.*01/01/${Y}`) });
    await row.getByRole("button", { name: "Approuver" }).click();
    await expect(row.getByText("Approuvé")).toBeVisible();
  }
  await a.ctx.close();

  // 3. Consultant : note de frais avec kilométrage (montant calculé) et repas justifié
  const k = await as(browser, "consultant@demo.test");
  await k.page.goto("/me/expenses");
  const title = `Déplacements ${Y}`;
  await k.page.getByLabel("Nouvelle note de frais").fill(title); await k.page.getByRole("button", { name: "Créer", exact: true }).click();
  const card = k.page.getByRole("region", { name: title });
  await expect(card).toBeVisible();
  await card.getByLabel("Date").fill(`${Y}-05-10`); await card.getByLabel("Nature").selectOption("mileage");
  await card.getByLabel("Description").fill("Trajet client"); await card.getByLabel("Kilomètres").fill("100");
  await card.getByRole("button", { name: "Ajouter la ligne" }).click();
  await expect(card.getByText(/50,00\s?€/).first()).toBeVisible(); // 100 km × 0,50 € calculé côté serveur
  await card.getByLabel("Date").fill(`${Y}-05-11`); await card.getByLabel("Nature").selectOption("meal");
  await card.getByLabel("Description").fill("Déjeuner client"); await card.getByLabel("Montant TTC (€)").fill("18.00"); await card.getByLabel("Référence du justificatif").fill("TICKET-E2E");
  await card.getByRole("button", { name: "Ajouter la ligne" }).click();
  await card.getByRole("button", { name: /Soumettre 68,00/ }).click();
  await expect(card.getByText("À approuver")).toBeVisible();
  await k.ctx.close();

  // 4. Opérations approuve, finance rembourse (l'opération ne peut pas rembourser)
  const o = await as(browser, "ops@demo.test");
  await o.page.goto("/expenses");
  const oc = o.page.getByRole("region", { name: title });
  await oc.getByRole("button", { name: /Approuver 68,00/ }).click();
  await expect(oc.getByText("Approuvée")).toBeVisible();
  await expect(oc.getByRole("button", { name: "Marquer remboursée" })).toHaveCount(0);
  await o.ctx.close();
  const f = await as(browser, "finance@demo.test");
  await f.page.goto("/expenses");
  const fc = f.page.getByRole("region", { name: title });
  await fc.getByRole("button", { name: "Marquer remboursée" }).click();
  await expect(fc.getByText("Remboursée")).toBeVisible();
  await f.page.goto("/ledger");
  await expect(f.page.getByText("Journal équilibré")).toBeVisible();
  await f.ctx.close();
});

test("contrat : modèle publié, génération avec variables, signature déclarée (non qualifiée)", async ({ browser }) => {
  const h = await as(browser, "hr@demo.test");
  await h.page.goto("/contracts");
  await expect(h.page.getByText("pas connectée")).toBeVisible();
  const name = `CDI E2E ${Y}`;
  await h.page.getByLabel("Nom (même nom = nouvelle version)").fill(name);
  await h.page.getByLabel(/Texte avec variables/).fill("Contrat conclu avec {{nom}} pour une prise d'effet le {{date}}.");
  await h.page.getByRole("button", { name: "Créer le modèle" }).click();
  const tplRow = h.page.locator("div.row", { hasText: name });
  await tplRow.getByRole("button", { name: "Publier" }).click();
  await expect(tplRow.getByText("Publié")).toBeVisible();
  await h.page.getByLabel("Modèle publié").selectOption({ label: `${name} v1` });
  await h.page.getByLabel("Consultant", { exact: true }).selectOption({ index: 1 });
  await h.page.getByLabel("nom", { exact: true }).fill("Camille Fictive"); await h.page.getByLabel("date", { exact: true }).fill("2026-12-01");
  await h.page.getByRole("button", { name: "Générer le contrat" }).click();
  const row = h.page.getByRole("row", { name: new RegExp(name) });
  await row.getByRole("button", { name: "Marquer envoyé" }).click();
  await row.getByRole("button", { name: "Déclarer la signature" }).click();
  await row.getByPlaceholder(/Exemplaires signés/).fill("Exemplaires signés reçus le 01/12");
  await row.getByRole("button", { name: "Confirmer" }).click();
  await expect(row.getByText("Signé (déclaré)")).toBeVisible();
  await h.ctx.close();
});

test("compte d'activité consultant : estimation étiquetée, jamais présenté comme un salaire", async ({ browser }) => {
  const k = await as(browser, "consultant@demo.test");
  await k.page.goto("/me/account");
  await expect(k.page.getByText("ni un bulletin de paie")).toBeVisible();
  await expect(k.page.getByText("Solde avant charges sociales et salaire (estimation)")).toBeVisible();
  await k.ctx.close();
});
