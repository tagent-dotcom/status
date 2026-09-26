import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the production build against the local mock probe network.
// Prerequisites: a migrated database in E2E_DATABASE_URL and `npm run build`.
const port = Number(process.env.E2E_PORT ?? 3100);
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://status:status@localhost:5432/status_e2e";
// Use a preinstalled Chromium when provided (e.g. sandboxes without browser downloads).
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: "npx tsx scripts/mock-globalping.ts",
      url: "http://127.0.0.1:4010/health",
      env: { MOCK_PORT: "4010", MOCK_DURATION_MS: "3000" },
      reuseExistingServer: true,
    },
    {
      command: `npx next start -p ${port}`,
      url: `http://localhost:${port}/`,
      reuseExistingServer: true,
      env: {
        DATABASE_URL: databaseUrl,
        IP_HASH_SECRET: "e2e-secret-0123456789",
        GLOBALPING_API_URL: "http://127.0.0.1:4010",
        RATE_LIMIT_PER_MINUTE: "100",
        RATE_LIMIT_PER_HOUR: "1000",
        GLOBALPING_HOURLY_PROBE_BUDGET: "100000",
        SITE_URL: "https://worldstatus.example",
      },
    },
    {
      // Same build with no database: single-page quick-check mode.
      command: `npx next start -p ${port + 1}`,
      url: `http://localhost:${port + 1}/`,
      reuseExistingServer: true,
      env: {
        GLOBALPING_API_URL: "http://127.0.0.1:4010",
        RATE_LIMIT_PER_MINUTE: "100",
        RATE_LIMIT_PER_HOUR: "1000",
        SITE_URL: "https://worldstatus.example",
      },
    },
  ],
});
