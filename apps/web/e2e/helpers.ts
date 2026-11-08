import { expect, Page } from "@playwright/test";
export const PASSWORD = process.env.DEMO_PASSWORD ?? "";
if (!PASSWORD) throw new Error("DEMO_PASSWORD requis (le même que pour `pnpm seed`)");

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Société").fill("demo");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/(companies|crm|audit)/);
}
