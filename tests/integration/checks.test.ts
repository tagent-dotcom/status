import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROBE_BUDGET_KEY, createCheck, getCheck, getLatestFinishedCheck, type Deps } from "../../src/lib/checks";
import type { Sql } from "../../src/lib/db/client";
import { migrate } from "../../src/lib/db/migrate";
import { AppError } from "../../src/lib/errors";
import { GlobalpingClient } from "../../src/lib/globalping/client";
import { getHistory, historyQuerySchema, isIndexable, getSiteSummary, listIndexableSites } from "../../src/lib/history";
import { FakeNetwork } from "../fixtures/fake-network";
import { closeSql, configure, prepareDatabase, truncateAll } from "./setup";

let sql: Sql;
let network: FakeNetwork;

function deps(overrides: Record<string, string> = {}, duration = 0): Deps {
  network = new FakeNetwork(duration);
  return {
    sql,
    config: configure(overrides),
    globalping: new GlobalpingClient({ baseUrl: "http://fake.globalping", fetchImpl: network.fetch }),
  };
}

const PK_US = { mode: "custom", locations: [{ country: "PK" }, { country: "US" }] };

async function runToCompletion(d: Deps, url: string, locations: unknown = PK_US, clientHash = "client-a") {
  const { checkId } = await createCheck(d, { url, locations, clientHash });
  for (let i = 0; i < 20; i++) {
    const view = await getCheck(d, checkId);
    if (view && view.status !== "pending") return view;
    await new Promise((r) => setTimeout(r, 1100));
  }
  throw new Error("check did not finish");
}

async function expectAppError(promise: Promise<unknown>, code: string, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ code, status });
  return error as AppError;
}

beforeAll(async () => {
  sql = await prepareDatabase();
});

beforeEach(async () => {
  await truncateAll(sql);
});

afterAll(async () => {
  await closeSql();
});

describe("createCheck + getCheck", () => {
  it("runs a check end to end and pinpoints a Pakistan-only DNS outage", async () => {
    const d = deps();
    const view = await runToCompletion(d, "https://pk-blocked.example.org/");
    expect(view.status).toBe("finished");
    expect(view.hostname).toBe("pk-blocked.example.org");
    expect(view.results).toHaveLength(6); // 3 PK + 3 US probes in the fake catalog
    expect(view.analysis.status).toBe("partial");
    expect(view.analysis.countries.find((c) => c.country === "PK")).toMatchObject({ status: "down", topFailure: "dns_not_found" });
    expect(view.analysis.countries.find((c) => c.country === "US")).toMatchObject({ status: "up" });
    expect(view.analysis.insights[0].title).toBe("Unreachable from Pakistan, working elsewhere");

    const [site] = await sql`SELECT finished_checks, ever_reachable, last_checked_at FROM sites WHERE hostname = 'pk-blocked.example.org'`;
    expect(site).toMatchObject({ finished_checks: 1, ever_reachable: true });
    expect(site.last_checked_at).toBeInstanceOf(Date);
  });

  it("reuses an identical recent check instead of starting another measurement", async () => {
    const d = deps();
    const a = await createCheck(d, { url: "example.org", locations: PK_US, clientHash: "a" });
    const b = await createCheck(d, { url: "https://EXAMPLE.org/", locations: { mode: "custom", locations: [{ country: "us" }, { country: "PK" }] }, clientHash: "b" });
    expect(b).toEqual({ checkId: a.checkId, hostname: "example.org", reused: true });
    expect(network.createCalls).toBe(1);

    const c = await createCheck(d, { url: "example.org", locations: { mode: "worldwide" }, clientHash: "a" });
    expect(c.checkId).not.toBe(a.checkId);
    expect(network.createCalls).toBe(2);
  });

  it("collapses a burst of identical concurrent requests into one measurement", async () => {
    const d = deps();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => createCheck(d, { url: "burst.example.org", locations: PK_US, clientHash: `c${i}` })),
    );
    expect(new Set(results.map((r) => r.checkId)).size).toBe(1);
    expect(network.createCalls).toBe(1);
    // Losers of the insert race must refund their budget reservation.
    const [row] = await sql`SELECT sum(count)::int AS used FROM rate_limit_counters WHERE bucket_key = ${PROBE_BUDGET_KEY}`;
    expect(row.used).toBe(6);
  });

  it("stores results exactly once even when many viewers poll concurrently", async () => {
    const d = deps({}, 1500);
    const { checkId } = await createCheck(d, { url: "https://popular.example.org/", locations: PK_US, clientHash: "a" });
    await new Promise((r) => setTimeout(r, 1600));
    await Promise.all(Array.from({ length: 10 }, () => getCheck(d, checkId)));
    await new Promise((r) => setTimeout(r, 1100));
    const views = await Promise.all(Array.from({ length: 10 }, () => getCheck(d, checkId)));
    expect(views.every((v) => v?.status === "finished")).toBe(true);
    const [row] = await sql`SELECT count(*)::int AS n FROM check_results WHERE check_id = ${checkId}`;
    expect(row.n).toBe(6);
    const [site] = await sql`SELECT finished_checks FROM sites WHERE hostname = 'popular.example.org'`;
    expect(site.finished_checks).toBe(1);
  });

  it("polls the provider at most once per second however many people watch", async () => {
    const d = deps({}, 60_000);
    const { checkId } = await createCheck(d, { url: "watched.example.org", locations: PK_US, clientHash: "a" });
    const views = await Promise.all(Array.from({ length: 25 }, () => getCheck(d, checkId)));
    expect(views.every((v) => v?.status === "pending")).toBe(true);
    expect(network.getCalls).toBe(1);
  });

  it("shares live partial results while a measurement is running", async () => {
    const d = deps({}, 4000);
    const { checkId } = await createCheck(d, { url: "partial.example.org", locations: PK_US, clientHash: "a" });
    await new Promise((r) => setTimeout(r, 2100));
    const view = await getCheck(d, checkId);
    expect(view?.status).toBe("pending");
    expect(view?.results.length).toBeGreaterThan(0);
    expect(view?.results.length).toBeLessThan(6);
  });

  it("rejects invalid input with user-facing messages", async () => {
    const d = deps();
    await expectAppError(createCheck(d, { url: "ftp://example.org", locations: undefined, clientHash: "a" }), "invalid_target", 400);
    await expectAppError(createCheck(d, { url: 42, locations: undefined, clientHash: "a" }), "invalid_target", 400);
    await expectAppError(createCheck(d, { url: "example.org", locations: { mode: "custom", locations: [] }, clientHash: "a" }), "invalid_locations", 400);
    expect(network.createCalls).toBe(0);
  });

  it("refuses domains that resolve to private addresses", async () => {
    const d = { ...deps({ UNSAFE_SKIP_DNS_CHECK: "false" }), dnsSafety: async () => ({ ok: false as const, reason: "private_address" as const, addresses: ["127.0.0.1"] }) };
    await expectAppError(createCheck(d, { url: "evil.example.org", locations: undefined, clientHash: "a" }), "private_address", 400);
    expect(network.createCalls).toBe(0);
  });

  it("rate limits each client and reports when to retry", async () => {
    const d = deps({ RATE_LIMIT_PER_MINUTE: "2" });
    await createCheck(d, { url: "one.example.org", locations: undefined, clientHash: "same" });
    await createCheck(d, { url: "two.example.org", locations: undefined, clientHash: "same" });
    const error = await expectAppError(createCheck(d, { url: "three.example.org", locations: undefined, clientHash: "same" }), "rate_limited", 429);
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    // Other clients are unaffected, and reusing an existing check is never rate limited.
    await createCheck(d, { url: "three.example.org", locations: undefined, clientHash: "other" });
    await createCheck(d, { url: "one.example.org", locations: undefined, clientHash: "same" });
  });

  it("enforces the global hourly probe budget", async () => {
    const d = deps({ GLOBALPING_HOURLY_PROBE_BUDGET: "60" });
    await createCheck(d, { url: "a.example.org", locations: { mode: "worldwide" }, clientHash: "a" }); // requests 50
    await expectAppError(createCheck(d, { url: "b.example.org", locations: { mode: "worldwide" }, clientHash: "b" }), "capacity", 503);
  });

  it("only charges the budget for probes that actually ran", async () => {
    const d = deps();
    const { checkId } = await createCheck(d, { url: "a.example.org", locations: { mode: "worldwide" }, clientHash: "a" });
    const [check] = await sql`SELECT requested_probes, probes_count FROM checks WHERE id = ${checkId}`;
    expect(check.requested_probes).toBe(50);
    const [row] = await sql`SELECT sum(count)::int AS used FROM rate_limit_counters WHERE bucket_key = ${PROBE_BUDGET_KEY}`;
    expect(row.used).toBe(check.probes_count);
  });

  it.each([
    [429, "capacity", 503],
    [422, "no_probes", 422],
    [400, "invalid_locations", 400],
    [500, "probe_network_error", 502],
  ])("maps upstream HTTP %i to %s, refunds the budget and frees the slot for a retry", async (upstream, code, status) => {
    const d = deps();
    network.failNextCreateWith = upstream;
    await expectAppError(createCheck(d, { url: "flaky.example.org", locations: PK_US, clientHash: "a" }), code, status);
    const [row] = await sql`SELECT coalesce(sum(count), 0)::int AS used FROM rate_limit_counters WHERE bucket_key = ${PROBE_BUDGET_KEY}`;
    expect(row.used).toBe(0);
    const [failedCheck] = await sql`SELECT status, dedupe_bucket FROM checks`;
    expect(failedCheck).toMatchObject({ status: "failed", dedupe_bucket: null });

    const retry = await createCheck(d, { url: "flaky.example.org", locations: PK_US, clientHash: "a" });
    expect(retry.reused).toBe(false);
  });

  it("reports no probes when nothing matches the requested place", async () => {
    const d = deps();
    await expectAppError(
      createCheck(d, { url: "example.org", locations: { mode: "custom", locations: [{ country: "AQ" }] }, clientHash: "a" }),
      "no_probes",
      422,
    );
  });

  it("expires checks whose creator died before starting the measurement", async () => {
    const d = deps();
    const [site] = await sql`INSERT INTO sites (hostname) VALUES ('orphan.example.org') RETURNING id`;
    const id = "7d1f8e0e-3c1a-4d8e-9d55-2d8a8b1b8c01";
    await sql`
      INSERT INTO checks (id, site_id, target_url, location_request, requested_probes, dedupe_key, dedupe_bucket, created_at)
      VALUES (${id}, ${site.id}, 'https://orphan.example.org/', ${sql.json({ mode: "worldwide", networkType: "any" })}, 50, 'k', 1, now() - interval '5 minutes')
    `;
    const view = await getCheck(d, id);
    expect(view).toMatchObject({ status: "failed", error: { code: "orphaned" } });
  });

  it("returns null for unknown or malformed ids", async () => {
    const d = deps();
    expect(await getCheck(d, "not-a-uuid")).toBeNull();
    expect(await getCheck(d, "7d1f8e0e-3c1a-4d8e-9d55-2d8a8b1b8c99")).toBeNull();
  });
});

describe("history and SEO helpers", () => {
  it("aggregates by country, ISP and city with filters", async () => {
    const d = deps();
    await runToCompletion(d, "isp-reset.example.org");
    // A second check with different locations so there are two checks in history.
    await runToCompletion(d, "isp-reset.example.org", { mode: "custom", locations: [{ country: "PK" }] });

    const all = await getHistory(sql, "isp-reset.example.org", historyQuerySchema.parse({}));
    expect(all).not.toBeNull();
    expect(all!.totals).toMatchObject({ checks: 2, total: 9, down: 2 });
    expect(all!.bucket).toBe("day");
    expect(all!.options.countries).toEqual(["PK", "US"]);
    const ptcl = all!.networks.find((n) => n.asn === 17557);
    expect(ptcl).toMatchObject({ down: 2, status: "down", availability: 0 });
    expect(all!.failures[0]).toMatchObject({ diagnosis: "connection_reset", failedStage: "connection", count: 2 });
    expect(all!.recent).toHaveLength(9);

    const pk = await getHistory(sql, "isp-reset.example.org", historyQuerySchema.parse({ country: "pk" }));
    expect(pk!.totals.total).toBe(6);
    expect(pk!.countries.map((c) => c.country)).toEqual(["PK"]);
    // Filter options stay unfiltered so users can switch.
    expect(pk!.options.countries).toEqual(["PK", "US"]);

    const karachi = await getHistory(sql, "isp-reset.example.org", historyQuerySchema.parse({ country: "PK", city: "karachi" }));
    expect(karachi!.totals).toMatchObject({ total: 2, down: 2 });

    const eyeball = await getHistory(sql, "isp-reset.example.org", historyQuerySchema.parse({ networkType: "datacenter" }));
    expect(eyeball!.recent.every((r) => r.probe.networkType === "datacenter")).toBe(true);

    const past = await getHistory(sql, "isp-reset.example.org", historyQuerySchema.parse({ from: "2020-01-01", to: "2020-01-02" }));
    expect(past!.totals.total).toBe(0);
    expect(past!.totals.availability).toBeNull();
    expect(past!.bucket).toBe("hour");

    expect(await getHistory(sql, "never-checked.example.org", historyQuerySchema.parse({}))).toBeNull();
  });

  it("validates history filters", () => {
    expect(historyQuerySchema.safeParse({ from: "2026-01-10", to: "2026-01-01" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ from: "2025-01-01", to: "2026-01-01" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ city: "Karachi" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ country: "Pakistan" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ from: "garbage" }).success).toBe(false);
  });

  it("only makes proven, repeatedly-checked sites indexable", async () => {
    const d = deps();
    await runToCompletion(d, "real.example.org");
    let summary = await getSiteSummary(sql, "real.example.org");
    expect(isIndexable(summary!)).toBe(false);
    await runToCompletion(d, "real.example.org", { mode: "custom", locations: [{ country: "DE" }] });
    summary = await getSiteSummary(sql, "real.example.org");
    expect(isIndexable(summary!)).toBe(true);

    // A site that never answered anywhere is never indexable.
    await runToCompletion(d, "junk-down.example.org");
    await runToCompletion(d, "junk-down.example.org", { mode: "custom", locations: [{ country: "DE" }] });
    expect(isIndexable((await getSiteSummary(sql, "junk-down.example.org"))!)).toBe(false);

    expect((await listIndexableSites(sql, 0, 10)).map((s) => s.hostname)).toEqual(["real.example.org"]);
  });

  it("returns the latest finished check for the status page", async () => {
    const d = deps();
    expect(await getLatestFinishedCheck(sql, "fresh.example.org")).toBeNull();
    const first = await runToCompletion(d, "fresh.example.org");
    const latest = await getLatestFinishedCheck(sql, "fresh.example.org");
    expect(latest?.id).toBe(first.id);
    expect(latest?.results).toHaveLength(6);
  });
});

describe("migrate", () => {
  it("refuses to run when an applied migration was edited", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "migrations-"));
    try {
      await cp(path.join(process.cwd(), "migrations"), dir, { recursive: true });
      await writeFile(path.join(dir, "0001_init.sql"), "-- edited\n", { flag: "a" });
      await expect(migrate(sql, dir)).rejects.toThrow(/was modified after being applied/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
