import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const as = async (browser: import("@playwright/test").Browser, email: string) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await login(page, email); return { ctx, page }; };

test("agents : clôture et facturation proposées, approuvées par des humains, exécutées avec leurs droits", async ({ browser }) => {
  const year = 3000 + Math.floor(Math.random() * 6999), month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0"), period = `${year}-${month}`;

  // Préparation : CRA soumis par le consultant puis approuvé par le client
  const k = await as(browser, "consultant@demo.test");
  await k.page.goto("/me/timesheets");
  await k.page.getByLabel("Mois").fill(period);
  await k.page.getByLabel("01", { exact: true }).selectOption("1"); await k.page.getByLabel("02", { exact: true }).selectOption("1");
  await k.page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await k.page.getByRole("button", { name: /Soumettre 2 jour/ }).click();
  await expect(k.page.getByText("À valider par le client").first()).toBeVisible();
  await k.page.goto("/me/assistant");
  await k.page.getByRole("button", { name: "Afficher ma synthèse" }).click();
  await expect(k.page.getByText(/Solde de congés payés/)).toBeVisible();
  await expect(k.page.getByText(/aucun \(playbook déterministe\)/)).toBeAttached();
  await k.ctx.close();
  const c = await as(browser, "client@demo.test");
  await c.page.goto("/client/timesheets");
  await c.page.getByRole("region", { name: `CRA ${period}` }).getByRole("button", { name: /Valider 2 jour/ }).click();
  await c.ctx.close();

  // Opérations : l'agent détecte et PROPOSE ; rien n'est exécuté tant qu'un humain n'approuve pas
  const o = await as(browser, "ops@demo.test");
  await o.page.goto("/agents");
  await expect(o.page.getByText(/planificateur LLM non connecté/)).toBeVisible();
  await expect(o.page.getByText("Indisponible")).toBeVisible(); // Payroll Agent
  await o.page.getByRole("button", { name: "Préparer la clôture" }).click();
  const prop = o.page.locator(".card").filter({ hasText: new RegExp(`Valider en interne le CRA ${period}`) }).last();
  await expect(prop.getByText("À approuver")).toBeVisible();
  await o.page.goto("/timesheets");
  await expect(o.page.getByRole("row", { name: new RegExp(period) }).getByText("Validé par le client")).toBeVisible(); // pas encore validé
  await o.page.goto("/agents");
  await o.page.getByRole("button", { name: "Ouvrir" }).first().click(); // dernière exécution
  const open = o.page.locator(".card").filter({ hasText: new RegExp(`Valider en interne le CRA ${period}`) }).last();
  await open.getByRole("button", { name: "Approuver" }).click();
  await expect(open.getByText("Exécutée")).toBeVisible();
  await o.page.goto("/timesheets");
  await expect(o.page.getByRole("row", { name: new RegExp(period) }).getByText("Validé en interne")).toBeVisible();
  await o.ctx.close();

  // Finance : l'agent prépare la facture ; approbation humaine ; montant calculé par le serveur
  const f = await as(browser, "finance@demo.test");
  await f.page.goto("/agents");
  await f.page.getByRole("button", { name: "Préparer les factures" }).click();
  const inv = f.page.locator(".card").filter({ hasText: /Créer une facture brouillon de 1560\.00 € TTC pour 2 jour/ }).first();
  await expect(inv).toBeVisible();
  await expect(f.page.getByRole("button", { name: "Préparer la clôture" })).toBeDisabled(); // pas de droit sur ce playbook
  await inv.getByRole("button", { name: "Approuver" }).first().click();
  await expect(inv.getByText("Exécutée")).toBeVisible();
  await f.page.goto("/invoices");
  await expect(f.page.getByRole("row", { name: /Brouillon/ }).filter({ hasText: /1\s?560,00/ }).first()).toBeVisible();
  await f.ctx.close();
});
