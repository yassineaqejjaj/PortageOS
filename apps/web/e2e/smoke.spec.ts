import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("redirige vers la connexion sans session", async ({ page }) => {
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/login/);
});

test("refuse des identifiants invalides sans révéler lequel est faux", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Société").fill("demo");
  await page.getByLabel("Adresse email").fill("admin@demo.test");
  await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Identifiants invalides" })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("validation du formulaire de connexion", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Indiquez votre société.")).toBeVisible();
});

test("le jeton n'est pas accessible au JavaScript (cookie httpOnly)", async ({ page, context }) => {
  await login(page, "admin@demo.test");
  expect(await page.evaluate(() => document.cookie)).not.toContain("portage_session");
  const c = (await context.cookies()).find(x => x.name === "portage_session");
  expect(c?.httpOnly).toBe(true);
  expect(c?.sameSite).toBe("Lax");
});

test("déconnexion", async ({ page }) => {
  await login(page, "admin@demo.test");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/login/);
});
