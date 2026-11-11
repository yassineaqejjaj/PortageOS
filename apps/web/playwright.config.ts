import { defineConfig, devices } from "@playwright/test";

const API_ENV = {
  JWT_SECRET: process.env.JWT_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-0123456789",
  APP_DATABASE_URL: process.env.APP_DATABASE_URL ?? "postgresql://portage_app:portage_app_dev@localhost:5432/portage",
  PORT: "4311",
  WHATSAPP_PROVIDER: "fake", WHATSAPP_APP_SECRET: "e2e-whatsapp-secret-e2e-whatsapp", WHATSAPP_VERIFY_TOKEN: "e2e-verify", // faux fournisseur : jamais en production
  MFA_ENCRYPTION_KEY: process.env.MFA_ENCRYPTION_KEY ?? Buffer.from("e2e-mfa-key-e2e-mfa-key-e2e-mfa!").toString("base64"), // clé de test uniquement
};

/** Ports dédiés (4310/4311) pour ne jamais réutiliser un serveur étranger. Prérequis: base migrée + `pnpm seed` (DEMO_PASSWORD), API et web compilés (`pnpm build`). */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { baseURL: "http://localhost:4310", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /smoke\.spec\.ts/ },
  ],
  webServer: [
    { command: "node ../api/dist/main.js", url: "http://localhost:4311/health", env: API_ENV, reuseExistingServer: false, timeout: 60_000 },
    { command: "pnpm exec next start -p 4310", url: "http://localhost:4310/login", env: { API_URL: "http://localhost:4311" }, reuseExistingServer: false, timeout: 60_000 },
  ],
});
