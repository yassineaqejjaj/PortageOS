import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import { PASSWORD } from "./helpers";

const SECRET = "e2e-whatsapp-secret-e2e-whatsapp";
const API = "http://localhost:4311";
async function loginAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Société").fill("demo"); await page.getByLabel("Adresse email").fill("admin@demo.test"); await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function webhook(payload: unknown) {
  const raw = JSON.stringify(payload);
  return fetch(`${API}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") }, body: raw });
}

test("WhatsApp : configuration, consentement, message entrant, réponse dans la fenêtre, STOP", async ({ page }) => {
  const n = String(Date.now()).slice(-9), pnid = `7${n}`, from = `3367${n.slice(0, 7)}`;
  await loginAdmin(page);

  await page.goto("/settings/whatsapp");
  await expect(page.getByRole("heading", { name: "Canal WhatsApp" })).toBeVisible();
  await expect(page.getByText(/Mode simulé/).first()).toBeVisible();
  await page.getByLabel("Identifiant du numéro (Meta)").fill(pnid);
  await page.getByRole("button", { name: /Enregistrer|Mettre à jour/ }).first().click();
  await expect(page.getByText("Enregistré, non vérifié")).toBeVisible();
  await page.getByRole("button", { name: "Vérifier la connexion" }).click();
  await expect(page.getByText("Vérifié auprès de Meta")).toBeVisible();

  await page.goto("/whatsapp");
  await expect(page.getByRole("heading", { name: "WhatsApp", exact: true })).toBeVisible();
  const select = page.getByLabel("Consultant");
  await expect.poll(async () => select.locator("option").count()).toBeGreaterThan(1);
  await select.selectOption({ index: 1 });
  await page.getByLabel("Numéro WhatsApp").fill(`+${from}`);
  await page.getByLabel("Preuve / précision").fill("Formulaire E2E");
  await page.getByRole("button", { name: "Enregistrer le consentement" }).click();
  await expect(page.getByRole("cell", { name: `+${from}` })).toBeVisible();
  await expect(page.getByText("Consentement donné").first()).toBeVisible();

  // message entrant signé : conversation visible, réponse possible (fenêtre de 24 h ouverte)
  const r = await webhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: pnid }, contacts: [{ wa_id: from, profile: { name: "Contact E2E" } }], messages: [{ from, id: `wamid.${n}a`, type: "text", text: { body: "Bonjour E2E" } }] } }] }] });
  expect(r.status).toBe(200);
  expect((await fetch(`${API}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "0".repeat(64) }, body: "{}" })).status).toBe(401);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(`\\+${from}`) }).click();
  await expect(page.getByText("Bonjour E2E")).toBeVisible();
  await page.getByLabel("Votre réponse").fill("Bien reçu, merci.");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText("Bien reçu, merci.")).toBeVisible();
  await expect(page.getByText("Simulé (rien n’est parti)")).toBeVisible();

  // STOP : consentement retiré, texte libre bloqué
  expect((await webhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: pnid }, messages: [{ from, id: `wamid.${n}b`, type: "text", text: { body: "STOP" } }] } }] }] })).status).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(`\\+${from}`) }).click();
  await expect(page.getByText(/a retiré son consentement/).first()).toBeVisible();
  await expect(page.getByLabel("Votre réponse")).toBeDisabled();
  await expect(page.getByText("Retiré").first()).toBeVisible();
});

test("WhatsApp : invisible pour un consultant", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Société").fill("demo"); await page.getByLabel("Adresse email").fill("consultant@demo.test"); await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveCount(0);
  await page.goto("/whatsapp"); await expect(page.getByText(/Accès refusé/)).toBeVisible();
});
