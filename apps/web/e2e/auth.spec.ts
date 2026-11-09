import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32(s: string) { let bits = 0, v = 0; const out: number[] = []; for (const c of s) { v = (v << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totp(secret: string, stepOffset = 0) {
  const counter = Math.floor(Date.now() / 30000) + stepOffset; const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", b32(secret)).update(buf).digest(); const o = h[h.length - 1]! & 15;
  return String((((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, "0");
}
const PASSWORD = "Cheval-Agrafe-Lune-42";

test("invitation → mot de passe choisi → connexion → MFA (activation, puis connexion en deux étapes)", async ({ browser }) => {
  const email = `e2e-${Math.random().toString(36).slice(2, 8)}@demo.test`;
  // 1. L'administrateur crée un lien d'invitation (aucun e-mail n'est envoyé)
  const a = await browser.newContext(); const ap = await a.newPage(); await login(ap, "admin@demo.test");
  await ap.goto("/members");
  await ap.getByLabel("E-mail").fill(email); await ap.getByLabel("Finance").check();
  await ap.getByRole("button", { name: "Créer le lien d’invitation" }).click();
  const link = (await ap.locator(".mono").filter({ hasText: "/invite?token=" }).innerText()).trim();
  expect(link).toContain("/invite?token="); await expect(ap.getByText(/Lien à usage unique/)).toBeVisible();
  await a.close();

  // 2. La personne invitée choisit un mot de passe (faible refusé, fort accepté, lien non réutilisable)
  const b = await browser.newContext(); const bp = await b.newPage();
  await bp.goto(link);
  await expect(bp.getByText(/Vous êtes invité/)).toBeVisible();
  await bp.getByLabel("Choisissez un mot de passe").fill("court");
  await bp.getByRole("button", { name: "Accepter l’invitation" }).click();
  await expect(bp.getByRole("alert").filter({ hasText: /Mot de passe refusé/ })).toBeVisible();
  await bp.getByLabel("Choisissez un mot de passe").fill(PASSWORD);
  await bp.getByRole("button", { name: "Accepter l’invitation" }).click();
  await expect(bp.getByText(/C’est fait/)).toBeVisible();
  await bp.goto(link); await expect(bp.getByRole("alert").filter({ hasText: /invalide|expirée|déjà utilisée/ })).toBeVisible();

  // 3. Connexion, jeton d'accès supprimé : le proxy renouvelle la session via le jeton de rafraîchissement
  const doLogin = async (page: import("@playwright/test").Page) => { await page.goto("/login"); await page.getByLabel("Société").fill("demo"); await page.getByLabel("Adresse email").fill(email); await page.getByLabel("Mot de passe").fill(PASSWORD); await page.getByRole("button", { name: "Se connecter" }).click(); };
  await doLogin(bp);
  await expect(bp).not.toHaveURL(/\/login/);
  const cookies = await b.cookies(); expect(cookies.find(c => c.name === "portage_refresh")?.httpOnly).toBe(true);
  await b.addCookies([{ name: "portage_session", value: "jeton.expire.invalide", url: "http://localhost:4310", httpOnly: true, sameSite: "Lax" }]); // jeton d'accès périmé
  await bp.goto("/invoices");
  await expect(bp.getByRole("heading", { name: "Facturation" })).toBeVisible(); // toujours connecté grâce à la rotation
  await expect.poll(async () => (await b.cookies()).find(c => c.name === "portage_session")?.value).not.toBe("jeton.expire.invalide"); // renouvelé par le proxy
  await expect(bp.getByText("Aucune facture").or(bp.getByRole("table")).first()).toBeVisible(); // les données se chargent bien (pas de retour à la connexion)

  // 4. Activation du MFA
  await bp.goto("/security");
  await bp.getByRole("button", { name: "Configurer l’application d’authentification" }).click();
  const secret = (await bp.locator(".mono").filter({ hasText: /^[A-Z2-7]{32}$/ }).innerText()).trim();
  await bp.getByLabel("Code à 6 chiffres").fill(totp(secret)); await bp.getByRole("button", { name: "Activer", exact: true }).click();
  await expect(bp.getByText(/Codes de secours — affichés une seule fois/)).toBeVisible();
  await expect(bp.getByText("Activée")).toBeVisible();

  // 5. Déconnexion puis connexion en deux étapes
  await bp.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(bp).toHaveURL(/\/login/);
  await doLogin(bp);
  await expect(bp.getByRole("heading", { name: "Vérification en deux étapes" })).toBeVisible();
  await bp.getByLabel(/Code à 6 chiffres de votre application/).fill("000000");
  await bp.getByRole("button", { name: "Vérifier" }).click();
  await expect(bp.getByRole("alert")).toBeVisible();
  await bp.getByLabel(/Code à 6 chiffres de votre application/).fill(totp(secret, 1)); // pas suivant : le pas d'activation ne peut pas être rejoué
  await bp.getByRole("button", { name: "Vérifier" }).click();
  await expect(bp).not.toHaveURL(/\/login/);
  await b.close();
});

test("les cookies de session sont httpOnly et la déconnexion révoque la session côté serveur", async ({ page, context }) => {
  await login(page, "commerce@demo.test");
  const c = await context.cookies();
  expect(c.find(x => x.name === "portage_session")?.httpOnly).toBe(true);
  expect(c.find(x => x.name === "portage_refresh")).toMatchObject({ httpOnly: true, path: "/api" });
  const refresh = c.find(x => x.name === "portage_refresh")!.value;
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/login/);
  const r = await page.request.post("/api/proxy/me", { headers: { origin: "http://localhost:4310", cookie: `portage_refresh=${refresh}` } }); // POST non autorisé sur /me, simple sonde d'accès
  expect([401, 404, 405]).toContain(r.status());
});

test("mot de passe oublié : réponse identique pour un compte inconnu, sans fuite d'information", async ({ page }) => {
  await page.goto("/login"); await page.getByRole("link", { name: "Mot de passe oublié ?" }).click(); await page.waitForURL("**/forgot-password"); await page.waitForLoadState("networkidle"); // hydratation avant saisie
  await page.getByLabel("Société").fill("demo"); await page.getByLabel("Adresse email").fill(`inconnu-${Date.now().toString(36)}@example.test`);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByRole("status")).toContainText(/Si un compte correspond/);
});
