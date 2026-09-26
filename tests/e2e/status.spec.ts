import { expect, test } from "@playwright/test";

// Hostnames select scenarios in the mock probe network (tests/fixtures/fake-network.ts).
// A unique suffix per run keeps runs independent of earlier data.
const run = Date.now().toString(36);

test("finds a Pakistan-only outage from the home page", async ({ page }) => {
  const host = `pk-blocked-${run}.example.org`;
  await page.goto("/");
  await page.getByLabel("Website address").fill(host);
  await page.getByRole("radio", { name: /Choose countries/ }).click();
  // Defaults to Pakistan + United States.
  await expect(page.getByLabel("Country for location 1")).toHaveValue("PK");
  await expect(page.getByLabel("Country for location 2")).toHaveValue("US");
  await page.getByRole("button", { name: "Check from around the world" }).click();

  await expect(page).toHaveURL(new RegExp(`/status/${host}\\?check=`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Is ${host} down?`);
  await expect(page.getByText(`${host} is down in some places`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Unreachable from Pakistan, working elsewhere")).toBeVisible();
  await expect(page.getByText(/Most common result: Domain not found/)).toBeVisible();

  // Country table: Pakistan first (failing), down.
  const pakistan = page.getByRole("button", { name: /^Pakistan Down/ });
  await expect(pakistan).toBeVisible();
  await pakistan.click();
  const results = page.getByRole("table", { name: "Results by country and probe" });
  await expect(results.getByRole("cell", { name: /Karachi/ })).toBeVisible();
  await results.getByRole("button", { name: "Details" }).first().click();
  await expect(page.getByText(/getaddrinfo ENOTFOUND/)).toBeVisible();

  // History reflects the finished check.
  await expect(page.getByText("Availability").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "By country" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Why it failed" })).toBeVisible();
});

test("identifies an ISP-specific problem", async ({ page }) => {
  const host = `isp-reset-${run}.example.org`;
  await page.goto(`/status/${host}`);
  await expect(page.getByText(`Nobody has checked ${host} yet`)).toBeVisible();
  await page.getByRole("radio", { name: /Choose countries/ }).click();
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByText("ISP-specific problem in Pakistan")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Pakistan Telecommunication Company Limited \(AS17557\)/)).toBeVisible();
});

test("filters history by country via the URL and the controls", async ({ page }) => {
  const host = `geo-403-${run}.example.org`;
  await page.goto(`/status/${host}`);
  await page.getByRole("radio", { name: /Choose countries/ }).click();
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByText(/is down in some places/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("combobox", { name: "Country", exact: true }).selectOption("PK");
  await expect(page).toHaveURL(/country=PK/);
  const history = page.locator("section", { has: page.getByRole("heading", { name: "History" }) });
  await expect(history.getByText("Country blocked").first()).toBeVisible();
  await expect(history.getByText("0%").first()).toBeVisible();

  await page.getByRole("combobox", { name: "City", exact: true }).selectOption("Karachi");
  await expect(page).toHaveURL(/city=Karachi/);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page).not.toHaveURL(/country=/);
});

test("validates input before calling the server", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Website address").fill("http://localhost:3000");
  await page.getByRole("button", { name: "Check from around the world" }).click();
  const alert = page.locator("#check-error");
  await expect(alert).toHaveText("Only standard web ports (80 and 443) can be checked.");
  await page.getByLabel("Website address").fill("ftp://example.com");
  await page.getByRole("button", { name: "Check from around the world" }).click();
  await expect(alert).toHaveText("Only http:// and https:// websites can be checked.");
});

test("status pages are canonical and unproven sites are not indexed", async ({ page, request }) => {
  const response = await request.get("/status/EXAMPLE-New.org", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers()["location"]).toBe("/status/example-new.org");

  await page.goto(`/status/never-checked-${run}.example.org?check=whatever`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://worldstatus.example/status/never-checked-${run}.example.org`);

  expect((await request.get("/status/not a domain")).status()).toBe(404);
  expect((await request.get("/status/127.0.0.1")).status()).toBe(404);
});

test("works on a phone @mobile", async ({ page }) => {
  const host = `mobile-${run}.example.org`;
  await page.goto("/");
  await page.getByLabel("Website address").fill(host);
  await page.getByRole("button", { name: "Check from around the world" }).click();
  await expect(page.getByText(`${host} is up from everywhere we tested`)).toBeVisible({ timeout: 20_000 });
  // No horizontal page scroll at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
