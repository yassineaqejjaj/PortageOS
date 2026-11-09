import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("menu de gestion : groupes du design, sous-menu CRM, page courante unique, réduction mémorisée", async ({ page }) => {
  await login(page, "admin@demo.test"); await page.goto("/crm/campaigns"); await page.waitForLoadState("networkidle");
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  for (const g of ["Pilotage", "Relation", "Opérations", "Gouvernance"]) await expect(nav.getByText(g, { exact: true }).first()).toBeVisible();
  await expect(nav.locator(".nav-chip")).toHaveText("Gestion"); // pastille du portail
  const crm = nav.getByRole("button", { name: "CRM" }); await expect(crm).toHaveAttribute("aria-expanded", "true"); // ouvert car la page courante est dans le sous-menu
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1); await expect(nav.getByRole("link", { name: "Campagnes" })).toHaveAttribute("aria-current", "page");
  await crm.click(); await expect(crm).toHaveAttribute("aria-expanded", "false"); await expect(nav.getByRole("link", { name: "Campagnes" })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-expanded", "false");
  await nav.getByRole("button", { name: "Configuration" }).click(); await expect(nav.getByRole("link", { name: "Journal d’audit" })).toBeVisible();
  await nav.getByRole("link", { name: "Clients" }).click(); await expect(page).toHaveURL(/\/companies$/);
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await nav.getByRole("button", { name: "Réduire la navigation" }).click();
  await expect(nav.locator(".nav-chip")).toBeHidden(); await expect(nav.getByRole("link", { name: "Clients" })).toBeVisible(); // icône seule, nom accessible conservé (title)
  await expect.poll(async () => (await nav.boundingBox())!.width).toBeLessThan(90); // fin de la transition
  await page.reload(); await page.waitForLoadState("networkidle"); await expect.poll(async () => (await page.getByRole("navigation", { name: "Navigation principale" }).boundingBox())!.width).toBeLessThan(90); // mémorisé
});

test("menus des portails : consultant et client ne voient que leurs entrées, sans groupes de gestion", async ({ browser }) => {
  const c = await browser.newContext(); const p = await c.newPage(); await login(p, "consultant@demo.test"); await p.waitForLoadState("networkidle");
  const nav = p.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.locator(".nav-chip")).toHaveText("Consultant"); await expect(nav.getByRole("button", { name: "CRA et absences" })).toBeVisible();
  for (const hidden of ["Clients", "Facturation", "Pilotage", "Gouvernance", "CRM"]) await expect(nav.getByText(hidden, { exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Mes documents" })).toBeVisible(); await c.close();
  const k = await browser.newContext(); const q = await k.newPage(); await login(q, "client@demo.test"); await q.waitForLoadState("networkidle");
  const nq = q.getByRole("navigation", { name: "Navigation principale" }); await expect(nq.locator(".nav-chip")).toHaveText("Client"); await expect(nq.getByRole("link", { name: "CRA à valider" })).toBeVisible(); await expect(nq.getByRole("link", { name: "Facturation" })).toHaveCount(0); await k.close();
});

test("mobile : menu en tiroir (bouton Menu), fermeture par Échap et après navigation", async ({ browser }) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 800 } }); const p = await c.newPage(); await login(p, "admin@demo.test"); await p.waitForLoadState("networkidle");
  const nav = p.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav).not.toBeInViewport(); await p.getByRole("button", { name: "Menu" }).click(); await expect(nav).toBeInViewport();
  await p.keyboard.press("Escape"); await expect(nav).not.toBeInViewport();
  await p.getByRole("button", { name: "Menu" }).click(); await nav.getByRole("link", { name: "Clients" }).click(); await expect(p).toHaveURL(/\/companies$/); await expect(nav).not.toBeInViewport(); await c.close();
});
