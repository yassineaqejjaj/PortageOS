import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const as = async (browser: import("@playwright/test").Browser, email: string) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await login(page, email); return { ctx, page }; };
const num = (t: string) => Number(t.replace(/[^\d,.-]/g, "").replace(",", "."));

test("absence : ajustement RH → demande du consultant → approbation → solde décompté", async ({ browser }) => {
  const Y = 3000 + Math.floor(Math.random() * 6999);
  const d = new Date(Date.UTC(Y, 2, 1)); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); // premier lundi de mars
  const mon = d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); const tue = d.toISOString().slice(0, 10);

  const h = await as(browser, "hr@demo.test");
  await h.page.goto("/leaves");
  await h.page.getByLabel("Consultant", { exact: true }).selectOption({ label: "Camille Moreau (fictive)" });
  await h.page.getByLabel(/Jours \(\+ ou −\)/).fill("5"); await h.page.getByLabel("Motif", { exact: true }).fill("Solde initial E2E");
  await h.page.getByRole("button", { name: "Enregistrer l’ajustement" }).click();
  await expect(h.page.getByText(/Solde actuel/)).toBeVisible();
  await h.ctx.close();

  const c = await as(browser, "consultant@demo.test");
  await c.page.goto("/me/leaves");
  await expect(c.page.locator(".kpi .v")).toContainText("j");
  const before = num(await c.page.locator(".kpi .v").innerText());
  await c.page.getByLabel("Du").fill(mon); await c.page.getByLabel("Au").fill(tue);
  await c.page.getByRole("button", { name: "Soumettre la demande" }).click();
  const row = c.page.getByRole("row", { name: new RegExp(`${mon.slice(8)}/03/${Y}`) });
  await expect(row.getByText("En attente")).toBeVisible();
  await expect(c.page.getByText(/Aucun jour férié approuvé/)).toBeVisible(); // décompte signalé non fiable
  await c.ctx.close();

  const o = await as(browser, "ops@demo.test");
  await o.page.goto("/leaves");
  const orow = o.page.getByRole("row", { name: new RegExp(`${mon.slice(8)}/03/${Y}`) });
  await orow.getByRole("button", { name: /Approuver 2 j/ }).click();
  await expect(orow.getByText("Approuvée")).toBeVisible();
  await expect(o.page.getByLabel("Motif", { exact: true })).toHaveCount(0); // pas de droit d'ajustement
  await o.ctx.close();

  const c2 = await as(browser, "consultant@demo.test");
  await c2.page.goto("/me/leaves");
  await expect(c2.page.getByRole("row", { name: new RegExp(`${mon.slice(8)}/03/${Y}`) }).getByText("Approuvée")).toBeVisible();
  await expect.poll(async () => num(await c2.page.locator(".kpi .v").innerText())).toBe(before - 2);
  await c2.ctx.close();
});
