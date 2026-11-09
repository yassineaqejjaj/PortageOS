import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const as = async (browser: import("@playwright/test").Browser, email: string) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await login(page, email); return { ctx, page }; };
const uniq = () => Math.random().toString(36).slice(2, 8);

test("documents : dépôt par la personne concernée, faux fichier refusé, sensibles cachés aux opérations, lien temporaire par la RH", async ({ browser }) => {
  const idName = `cni-${uniq()}`, rcName = `rcpro-${uniq()}`;
  const c = await as(browser, "consultant@demo.test");
  await c.page.goto("/me/documents");
  await expect(c.page.getByText(/Analyse antivirus non connectée/)).toBeVisible();
  await c.page.getByLabel("Catégorie").selectOption("identity_document");
  await c.page.locator('input[type="file"]').setInputFiles({ name: "fraude.pdf", mimeType: "application/pdf", buffer: Buffer.from("ceci n'est pas un pdf") });
  await c.page.getByRole("button", { name: "Déposer" }).click();
  await expect(c.page.getByRole("alert").filter({ hasText: /Type de fichier refusé/ })).toBeVisible();
  await c.page.locator('input[type="file"]').setInputFiles({ name: `${idName}.png`, mimeType: "image/png", buffer: PNG });
  await c.page.getByRole("button", { name: "Déposer" }).click();
  const row = c.page.getByRole("row", { name: new RegExp(idName) });
  await expect(row).toContainText("Sensible"); await expect(row).toContainText("Non analysé");
  const [dl] = await Promise.all([c.page.waitForEvent("download"), row.getByRole("button", { name: "Télécharger" }).click()]);
  expect(dl.suggestedFilename()).toBe(`${idName}.png`);
  await c.ctx.close();

  // La RH voit la pièce sensible et dépose un document non sensible ; elle crée un lien temporaire (jamais pour un document sensible)
  const h = await as(browser, "hr@demo.test");
  await h.page.goto("/consultants"); await h.page.getByRole("link", { name: /Camille Moreau/ }).first().click();
  const hrow = h.page.getByRole("row", { name: new RegExp(idName) });
  await expect(hrow).toBeVisible(); await expect(hrow.getByRole("button", { name: "Lien temporaire" })).toHaveCount(0);
  await h.page.getByLabel("Catégorie").selectOption("rc_pro");
  await h.page.locator('input[type="file"]').setInputFiles({ name: `${rcName}.png`, mimeType: "image/png", buffer: PNG });
  await h.page.getByRole("button", { name: "Déposer" }).click();
  const rrow = h.page.getByRole("row", { name: new RegExp(rcName) }); await expect(rrow).toBeVisible();
  await rrow.getByRole("button", { name: "Lien temporaire" }).click();
  const link = (await h.page.locator(".mono").filter({ hasText: "/api/documents/shared/" }).innerText()).trim();
  const anon = await browser.newContext();
  const ok = await anon.request.get(link); expect(ok.status()).toBe(200); expect(ok.headers()["content-disposition"]).toMatch(/^attachment/); expect((await ok.body()).equals(PNG)).toBe(true);
  expect((await anon.request.get(link.slice(0, -4) + "xxxx")).status()).toBe(401);
  await anon.close(); await h.ctx.close();

  // Les opérations voient les documents non sensibles, pas la pièce d'identité
  const o = await as(browser, "ops@demo.test");
  await o.page.goto("/consultants"); await o.page.getByRole("link", { name: /Camille Moreau/ }).first().click();
  await expect(o.page.getByRole("row", { name: new RegExp(rcName) })).toBeVisible();
  await expect(o.page.getByRole("row", { name: new RegExp(idName) })).toHaveCount(0);
  await o.ctx.close();
});

test("justificatif de frais : fichier déposé avec la ligne, téléchargeable par le consultant et par les opérations", async ({ browser }) => {
  const title = `Frais docs ${uniq()}`; // date et montant aléatoires : le contrôle anti-doublon refuserait une répétition identique
  const day = String(1 + Math.floor(Math.random() * 27)).padStart(2, "0"), year = 3000 + Math.floor(Math.random() * 6999), euros = 10 + Math.floor(Math.random() * 80), cents = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  const k = await as(browser, "consultant@demo.test");
  await k.page.goto("/me/expenses");
  await k.page.getByLabel("Nouvelle note de frais").fill(title); await k.page.getByRole("button", { name: "Créer", exact: true }).click();
  const card = k.page.getByRole("region", { name: title }); await expect(card).toBeVisible();
  await card.getByLabel("Date").fill(`${year}-09-${day}`); await card.getByLabel("Nature").selectOption("meal");
  await card.getByLabel("Description").fill("Déjeuner"); await card.getByLabel("Montant TTC (€)").fill(`${euros}.${cents}`);
  await card.locator("#rf").setInputFiles({ name: "ticket.png", mimeType: "image/png", buffer: PNG });
  await card.getByRole("button", { name: "Ajouter la ligne" }).click();
  await expect(card.getByRole("button", { name: "Justificatif", exact: true })).toBeVisible();
  const [d1] = await Promise.all([k.page.waitForEvent("download"), card.getByRole("button", { name: "Justificatif", exact: true }).click()]);
  expect(d1.suggestedFilename()).toBe("ticket.png");
  await card.getByRole("button", { name: /Soumettre/ }).click(); await expect(card.getByText("À approuver")).toBeVisible();
  await k.ctx.close();
  const o = await as(browser, "ops@demo.test");
  await o.page.goto("/expenses");
  const oc = o.page.getByRole("region", { name: title });
  const [d2] = await Promise.all([o.page.waitForEvent("download"), oc.getByRole("button", { name: "Télécharger" }).click()]);
  expect(d2.suggestedFilename()).toBe("ticket.png");
  await o.ctx.close();
});
