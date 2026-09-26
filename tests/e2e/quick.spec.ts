import { expect, test } from "@playwright/test";

// The same build started without DATABASE_URL (see playwright.config.ts): one page, live
// results inline, nothing stored.
test.use({ baseURL: `http://localhost:${Number(process.env.E2E_PORT ?? 3100) + 1}` });

const run = Date.now().toString(36);

test("checks a site on the home page without a database", async ({ page }) => {
  const host = `pk-blocked-quick-${run}.example.org`;
  await page.goto("/");
  await page.getByLabel("Website address").fill(host);
  await page.getByRole("radio", { name: /Choose countries/ }).click();
  await page.getByRole("button", { name: "Check from around the world" }).click();

  // Stays on the home page with a shareable ?check= link.
  await expect(page).toHaveURL(/\/\?check=/);
  await expect(page.getByText(`${host} is down in some places`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Unreachable from Pakistan, working elsewhere")).toBeVisible();
  // No history section in this mode.
  await expect(page.getByRole("heading", { name: "History" })).toHaveCount(0);

  // The shared link reproduces the result for someone else.
  const shared = page.url();
  const other = await page.context().browser()!.newPage();
  await other.goto(shared);
  await expect(other.getByText(`${host} is down in some places`)).toBeVisible({ timeout: 20_000 });
  await other.close();
});

test("site pages redirect to the single-page checker, prefilled", async ({ page }) => {
  await page.goto("/status/example.org");
  await expect(page).toHaveURL(/\/\?url=example\.org$/);
  await expect(page.getByLabel("Website address")).toHaveValue("example.org");
});

test("database-only endpoints fail cleanly", async ({ request }) => {
  const history = await request.get("/api/sites/example.org/history");
  expect(history.status()).toBe(404);
  expect((await history.json()).error.message).toContain("History isn't enabled");
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
  expect((await request.get("/sitemaps/0.xml")).status()).toBe(200);
  expect((await request.get("/api/checks/doesnotexist")).status()).toBe(404);
});
