import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// Workflow 3 de bout en bout, quatre rôles : consultant → client → opérations → finance.
test("CRA déclaré → validé par le client → validé en interne → facture → encaissement → réconciliation", async ({ browser }) => {
  const year = 3000 + Math.floor(Math.random() * 6999), month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const period = `${year}-${month}`;
  const as = async (email: string) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await login(page, email); return { ctx, page }; };

  // 1. Consultant : saisit 2,5 jours et soumet
  const c = await as("consultant@demo.test");
  await c.page.goto("/me/timesheets");
  await expect(c.page.getByLabel("Mission")).not.toHaveValue("");
  await c.page.getByLabel("Mois").fill(period);
  await c.page.getByLabel("01", { exact: true }).selectOption("1");
  await c.page.getByLabel("02", { exact: true }).selectOption("1");
  await c.page.getByLabel("03", { exact: true }).selectOption("0.5");
  await expect(c.page.getByText("Total : 2,5 jour(s)")).toBeVisible();
  await c.page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await c.page.getByRole("button", { name: /Soumettre 2,5 jour/ }).click();
  await expect(c.page.getByText("À valider par le client").first()).toBeVisible();
  await c.ctx.close();

  // 2. Client : voit les jours, aucune donnée de rémunération, valide
  const cl = await as("client@demo.test");
  await cl.page.goto("/client/timesheets");
  const card = cl.page.getByRole("region", { name: `CRA ${period}` });
  await expect(card).toBeVisible();
  await expect(cl.page.locator("body")).not.toContainText(/650|TJM|€/);
  await card.getByRole("button", { name: /Valider 2,5 jour/ }).click();
  await expect(card).toHaveCount(0);
  await cl.ctx.close();

  // 3. Opérations : validation interne
  const o = await as("ops@demo.test");
  await o.page.goto("/timesheets");
  const row = o.page.getByRole("row", { name: new RegExp(period) });
  await row.getByRole("button", { name: /Valider 2,5 j/ }).click();
  await expect(row.getByText("Validé en interne")).toBeVisible();
  await expect(o.page.getByRole("link", { name: "Facturation" })).toHaveCount(1); // lecture seule
  await o.page.goto("/invoices");
  await expect(o.page.getByRole("button", { name: "Préparer la facture" })).toHaveCount(0);
  await o.ctx.close();

  // 4. Finance : facture 2,5 × 650 = 1 625,00 HT, 325,00 TVA, 1 950,00 TTC ; émission ; encaissement ; réconciliation
  const f = await as("finance@demo.test");
  await f.page.goto("/invoices");
  await f.page.getByRole("row", { name: new RegExp(period) }).getByRole("button", { name: "Préparer la facture" }).click();
  const draft = f.page.getByRole("row", { name: /Brouillon/ }).filter({ hasText: /1\s?950,00/ }).first();
  await expect(draft).toContainText(/1\s?625,00/);
  await expect(draft).toContainText(/325,00/);
  await draft.getByRole("button", { name: "Émettre" }).click();
  const issued = f.page.getByRole("row", { name: /Émise/ }).filter({ hasText: /1\s?950,00/ }).first();
  await expect(issued).toContainText(/FA-\d{4}-\d{6}/);
  await issued.getByRole("button", { name: "Saisir un encaissement" }).click();
  await issued.getByRole("button", { name: "Enregistrer" }).click();
  await expect(f.page.getByRole("row", { name: /Payée/ }).filter({ hasText: /1\s?950,00/ }).first()).toBeVisible();
  await f.page.goto("/ledger");
  await expect(f.page.getByText("Journal équilibré")).toBeVisible();
  await expect(f.page.getByText("Créances rapprochées")).toBeVisible();
  await f.ctx.close();
});
