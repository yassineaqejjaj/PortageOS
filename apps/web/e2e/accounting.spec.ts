import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const as = async (browser: import("@playwright/test").Browser, email: string) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await login(page, email); return { ctx, page }; };

test("écriture d'ajustement → clôture → période close refusée → export FEC par l'expert-comptable → réouverture réservée à l'administrateur", async ({ browser }) => {
  const period = `${1100 + Math.floor(Math.random() * 900)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}`; // période très ancienne et aléatoire (900 × 12 combinaisons) : aucune autre écriture ni facture ne la concerne et une collision avec une exécution précédente est négligeable
  const label = `Ajustement E2E ${period}`;

  const f = await as(browser, "finance@demo.test");
  await f.page.goto("/accounting/journal");
  await f.page.getByLabel("Du", { exact: true }).fill(period); await f.page.getByLabel("Au", { exact: true }).fill(period);
  await f.page.getByLabel("Date de valeur").fill(`${period}-15`); await f.page.getByLabel("Libellé").fill(label); await f.page.getByLabel("Motif", { exact: true }).fill("Régularisation de test E2E");
  await f.page.locator("#a0").selectOption("512"); await f.page.locator("#d0").fill("100");
  await f.page.locator("#a1").selectOption("706"); await f.page.locator("#c1").fill("100");
  await expect(f.page.getByText(/· équilibrée/)).toBeVisible();
  await f.page.getByRole("button", { name: "Enregistrer l’écriture" }).click();
  await expect(f.page.getByText(label)).toBeVisible();

  await f.page.goto("/accounting");
  await f.page.getByLabel("Période", { exact: true }).fill(period);
  await expect(f.page.getByText("Équilibrée")).toBeVisible();
  await expect(f.page.getByRole("row", { name: /512/ }).first()).toContainText(/100,00/);
  const ack = f.page.getByLabel(/J’ai pris connaissance/); if (await ack.isVisible().catch(() => false)) await ack.check();
  await f.page.getByRole("button", { name: `Clore la période ${period}` }).click();
  await expect(f.page.getByText("Période close").first()).toBeVisible();

  await f.page.goto("/accounting/journal"); // une nouvelle écriture dans la période close est refusée
  await f.page.getByLabel("Date de valeur").fill(`${period}-20`); await f.page.getByLabel("Libellé").fill("Doit être refusée"); await f.page.getByLabel("Motif", { exact: true }).fill("Test de période close");
  await f.page.locator("#a0").selectOption("512"); await f.page.locator("#d0").fill("1"); await f.page.locator("#a1").selectOption("706"); await f.page.locator("#c1").fill("1");
  await f.page.getByRole("button", { name: "Enregistrer l’écriture" }).click();
  await expect(f.page.getByRole("alert").filter({ hasText: /close/ })).toBeVisible();
  await f.ctx.close();

  const a = await as(browser, "accountant@demo.test");
  await expect(a.page.getByRole("link", { name: "Comptabilité" })).toBeVisible();
  await expect(a.page.getByRole("link", { name: "Facturation" })).toHaveCount(0); // périmètre limité à la comptabilité
  await a.page.goto("/accounting"); await a.page.getByLabel("Période", { exact: true }).fill(period);
  await expect(a.page.getByRole("button", { name: /Clore la période/ })).toHaveCount(0);
  await expect(a.page.getByText(/n’a pas été validé/)).toBeVisible();
  const [dl] = await Promise.all([a.page.waitForEvent("download"), a.page.getByRole("button", { name: `Exporter le FEC de ${period}` }).click()]);
  expect(dl.suggestedFilename()).toBe(`FEC-demo-${period}_${period}.txt`); // définitif : période close
  const text = await readFile(await dl.path(), "utf8");
  expect(text.split("\r\n")[0]).toBe("JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise");
  expect(text).toContain(`OD\tOpérations diverses\t1\t${period.replace("-", "")}15\t512\tBanque`); expect(text).toContain("100,00");
  await a.page.goto("/invoices"); await expect(a.page.getByRole("alert").filter({ hasText: "Accès refusé" })).toBeVisible();
  await a.ctx.close();

  // La réouverture (administrateur seul, motif, ordre inverse) est couverte par les tests d'API : en E2E, la période aléatoire peut précéder des périodes closes par d'autres exécutions.
  const ad = await as(browser, "admin@demo.test");
  await ad.page.goto("/accounting"); await ad.page.getByLabel("Période", { exact: true }).fill(period);
  await expect(ad.page.getByRole("button", { name: "Rouvrir la période" })).toBeVisible(); // proposé à l'administrateur seulement
  await ad.ctx.close();
  const fin = await as(browser, "finance@demo.test");
  await fin.page.goto("/accounting"); await fin.page.getByLabel("Période", { exact: true }).fill(period);
  await expect(fin.page.getByText("Période close").first()).toBeVisible();
  await expect(fin.page.getByRole("button", { name: "Rouvrir la période" })).toHaveCount(0); // pas pour la finance
  await fin.ctx.close();
});
