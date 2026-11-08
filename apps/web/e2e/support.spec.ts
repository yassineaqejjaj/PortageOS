import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const as = async (browser: import("@playwright/test").Browser, email: string) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await login(page, email); return { ctx, page }; };

test("support : demande du client → notification au personnel → réponse + note interne → clôture", async ({ browser }) => {
  const subject = `Question E2E ${Math.random().toString(36).slice(2, 8)}`;
  const c = await as(browser, "client@demo.test");
  await c.page.goto("/support");
  await c.page.getByLabel("Sujet").fill(subject); await c.page.getByLabel("Message").fill("Bonjour, pouvez-vous m'aider ?");
  await c.page.getByRole("button", { name: "Envoyer la demande" }).click();
  await expect(c.page.getByRole("link", { name: subject })).toBeVisible();

  const o = await as(browser, "ops@demo.test");
  await expect(o.page.getByRole("link", { name: /Notifications, [1-9]\d* non lue/ })).toBeVisible(); // cloche avec compteur
  await o.page.goto("/notifications");
  await expect(o.page.getByText(/Aucun fournisseur d.e-mail n.est connecté/)).toBeVisible();
  await o.page.getByRole("link", { name: `Nouvelle demande : ${subject}` }).click();
  await expect(o.page.getByRole("heading", { name: subject })).toBeVisible();
  await o.page.getByLabel("Votre réponse").fill("Bonjour, voici la réponse du support.");
  await o.page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(o.page.getByText("En attente du demandeur").first()).toBeVisible();
  await o.page.getByLabel("Votre réponse").fill("Note interne : client sensible, traiter en priorité.");
  await o.page.getByLabel(/Note interne \(non visible/).check();
  await o.page.getByRole("button", { name: "Ajouter la note" }).click();
  await expect(o.page.getByText(/Note interne \(invisible du demandeur\)/)).toBeVisible();

  await c.page.goto("/support");
  await c.page.getByRole("link", { name: subject }).click();
  await expect(c.page.getByText("Bonjour, voici la réponse du support.")).toBeVisible();
  await expect(c.page.locator("body")).not.toContainText("client sensible"); // la note interne est invisible du demandeur
  await c.page.getByLabel("Votre réponse").fill("Merci, c'est clair.");
  await c.page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(c.page.getByText("Ouverte").first()).toBeVisible();

  await o.page.reload();
  await o.page.getByRole("button", { name: "Marquer comme résolue" }).click();
  await expect(o.page.getByText("Résolue").first()).toBeVisible();
  await c.page.reload();
  await c.page.getByRole("button", { name: "Clore la demande" }).click();
  await expect(c.page.getByText("Close", { exact: true }).first()).toBeVisible();
  await expect(c.page.getByLabel("Votre réponse")).toHaveCount(0);
  await c.ctx.close(); await o.ctx.close();
});

test("notifications : préférences modifiables et boîte personnelle", async ({ browser }) => {
  const k = await as(browser, "consultant@demo.test");
  await k.page.goto("/notifications");
  const box = k.page.getByLabel("CRA refusé par le client");
  await expect(box).toBeVisible();
  const was = await box.isChecked();
  await box.click(); // case contrôlée : l'état suit la réponse du serveur
  await expect(box).toBeChecked({ checked: !was });
  await box.click();
  await expect(box).toBeChecked({ checked: was });
  await k.ctx.close();
});
