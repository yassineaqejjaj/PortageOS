import { test } from "@playwright/test";
import { login } from "./helpers";

// Captures pour docs/screenshots (pas de baseline visuelle comparée à ce jour).
test.skip(!process.env.SCREENSHOTS, "SCREENSHOTS=1 pour générer");
for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test(`captures ${scheme}`, async ({ page }) => {
      await login(page, "commerce@demo.test");
      for (const [path, file] of [["/crm/prospects", "prospects"], ["/companies", "clients"]] as const) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `../../docs/screenshots/${file}-${scheme}.png` });
      }
      await page.getByRole("button", { name: "Se déconnecter" }).click();
      await login(page, "finance@demo.test");
      for (const [path, file] of [["/invoices", "factures"], ["/ledger", "registre"]] as const) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `../../docs/screenshots/${file}-${scheme}.png` });
      }
    });
  });
}
