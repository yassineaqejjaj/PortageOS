import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const uniq = () => Math.random().toString(36).slice(2, 8);

test("admin crée un client (validation SIREN, puis succès et audit)", async ({ page }) => {
  await login(page, "admin@demo.test");
  await page.goto("/companies");
  const name = `Client E2E ${uniq()}`;
  await page.getByLabel("Nom").fill(name);
  await page.getByLabel(/SIREN/).fill("12");
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByText("Le SIREN comporte 9 chiffres.")).toBeVisible();
  await page.getByLabel(/SIREN/).fill(String(Math.floor(100000000 + Math.random() * 899999999)));
  await page.getByRole("button", { name: "Créer le client" }).click();
  await expect(page.getByRole("cell", { name })).toBeVisible();
  await page.goto("/audit");
  await expect(page.getByRole("cell", { name: "company.create" }).first()).toBeVisible();
});

test("consultant: aucune entrée de navigation métier et accès refusé aux clients", async ({ page }) => {
  await login(page, "consultant@demo.test").catch(() => {});
  await page.goto("/companies");
  await expect(page.getByRole("alert").filter({ hasText: "Accès refusé" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Clients" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Journal d’audit" })).toHaveCount(0);
});

test("workflow 1 (début): prospect nouveau → contacté → qualifié → converti", async ({ page }) => {
  await login(page, "commerce@demo.test");
  await page.goto("/crm/prospects");
  const name = `Prospect ${uniq()}`;
  await page.getByLabel("Nom", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(`${uniq()}@example.test`);
  await page.getByRole("button", { name: "Ajouter le prospect" }).click();
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByText("Nouveau")).toBeVisible();
  await row.getByRole("button", { name: "Marquer contacté" }).click();
  await expect(row.getByText("Contacté")).toBeVisible();
  await row.getByRole("button", { name: "Qualifier" }).click();
  await expect(row.getByText("Qualifié")).toBeVisible();
  await row.getByRole("button", { name: "Convertir" }).click();
  await expect(row.getByText("Converti")).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
});

test("prospect: sans contact, impossible de passer à « Contacté »; perte avec motif obligatoire", async ({ page }) => {
  await login(page, "commerce@demo.test");
  await page.goto("/crm/prospects");
  const name = `Sans contact ${uniq()}`;
  await page.getByLabel("Nom", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Ajouter le prospect" }).click();
  const row = page.getByRole("row", { name: new RegExp(name) });
  await row.getByRole("button", { name: "Marquer contacté" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "aucun moyen de contact" })).toBeVisible();
  await row.getByRole("button", { name: "Marquer perdu" }).click();
  await expect(row.getByRole("button", { name: "Confirmer" })).toBeDisabled();
  await row.getByPlaceholder(/Motif de perte/).fill("Budget gelé");
  await row.getByRole("button", { name: "Confirmer" }).click();
  await expect(row.getByText("Perdu")).toBeVisible();
  await expect(row.getByText("Budget gelé")).toBeVisible();
});
