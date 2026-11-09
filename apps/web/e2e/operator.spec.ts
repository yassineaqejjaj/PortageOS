import { expect, test } from "@playwright/test";
import { PASSWORD } from "./helpers";

const PLATFORM = process.env.PLATFORM_SLUG ?? "plateforme-demo";
async function loginAs(page: import("@playwright/test").Page, slug: string, email: string) {
  await page.goto("/login");
  await page.getByLabel("Société").fill(slug); await page.getByLabel("Adresse email").fill(email); await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test("console plateforme : invisible aux sociétés, création, quota et suspension d'une société", async ({ browser }) => {
  const run = Date.now().toString(36), slug = `e2e-${run}`, name = `Société E2E ${run}`;
  const a = await browser.newContext(); const pa = await a.newPage();
  await loginAs(pa, "demo", "admin@demo.test");
  await expect(pa).not.toHaveURL(/\/login/);
  await expect(pa.getByRole("link", { name: "Console plateforme" })).toHaveCount(0);
  await pa.goto("/operator"); await expect(pa.getByText(/Accès refusé/)).toBeVisible();
  await a.close();

  const o = await browser.newContext(); const p = await o.newPage();
  await loginAs(p, PLATFORM, "operator@demo.test");
  await expect(p).not.toHaveURL(/\/login/);
  await p.goto("/operator");
  await expect(p.getByRole("heading", { name: "Console plateforme" })).toBeVisible();
  await p.getByLabel("Identifiant de connexion").fill(slug); await p.getByLabel("Raison sociale").fill(name);
  await p.getByLabel(/Quota de membres \(facultatif\)/).fill("3"); await p.getByLabel("E-mail du premier administrateur").fill(`admin-${run}@e2e.test`);
  await p.getByRole("button", { name: "Créer la société" }).click();
  await expect(p.getByRole("status").filter({ hasText: "/invite?token=" })).toBeVisible();
  const row = p.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByText("Active")).toBeVisible();
  await p.getByLabel(`Motif de suspension de ${name}`).fill("Test E2E de suspension");
  await p.getByRole("button", { name: `Suspendre ${name}` }).click();
  await expect(row.getByText("Suspendue")).toBeVisible();
  await p.getByRole("button", { name: `Réactiver ${name}` }).click();
  await expect(row.getByText("Active")).toBeVisible();
  await o.close();
});
