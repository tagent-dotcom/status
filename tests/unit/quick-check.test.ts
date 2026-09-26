import { describe, expect, it } from "vitest";
import type { Config } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { GlobalpingClient } from "@/lib/globalping/client";
import { measurementSchema } from "@/lib/globalping/schema";
import { MemoryLimiter, RecentChecks } from "@/lib/memory-limiter";
import { createQuickCheck, getQuickCheck, measurementTargetUrl } from "@/lib/quick-check";
import { FakeNetwork } from "../fixtures/fake-network";
import { measurement } from "../fixtures/globalping";

const config = {
  GLOBALPING_API_URL: "http://fake",
  GLOBALPING_HOURLY_PROBE_BUDGET: 1000,
  MAX_PROBES_PER_CHECK: 50,
  CHECK_DEDUPE_SECONDS: 60,
  RATE_LIMIT_PER_MINUTE: 2,
  RATE_LIMIT_PER_HOUR: 100,
  TRUST_PROXY_HEADERS: true,
  UNSAFE_SKIP_DNS_CHECK: true,
  DATABASE_POOL_MAX: 1,
} as Config;

function setup() {
  const network = new FakeNetwork(0);
  const deps = { config, globalping: new GlobalpingClient({ baseUrl: "http://fake", fetchImpl: network.fetch }) };
  const state = { limiter: new MemoryLimiter(), recent: new RecentChecks() };
  return { network, deps, state };
}

const PK_US = { mode: "custom", locations: [{ country: "PK" }, { country: "US" }] };

describe("quick checks (no database)", () => {
  it("creates a measurement and reads classified results straight from the probe network", async () => {
    const { deps, state } = setup();
    const started = await createQuickCheck(deps, { url: "https://pk-blocked.example.org/page?x=1", locations: PK_US, clientKey: "1.2.3.4" }, state);
    expect(started).toMatchObject({ hostname: "pk-blocked.example.org", reused: false });

    const view = await getQuickCheck(deps.globalping, started.checkId);
    expect(view).toMatchObject({
      id: started.checkId,
      status: "finished",
      hostname: "pk-blocked.example.org",
      targetUrl: "https://pk-blocked.example.org/page?x=1",
      locationRequest: null,
    });
    expect(view!.analysis.insights[0].title).toBe("Unreachable from Pakistan, working elsewhere");
  });

  it("shares a recent identical check instead of spending probes again", async () => {
    const { deps, state, network } = setup();
    const a = await createQuickCheck(deps, { url: "example.org", locations: PK_US, clientKey: "a" }, state);
    const b = await createQuickCheck(deps, { url: "https://EXAMPLE.org/", locations: PK_US, clientKey: "b" }, state);
    expect(b).toEqual({ checkId: a.checkId, hostname: "example.org", reused: true });
    expect(network.createCalls).toBe(1);
  });

  it("rate limits per client in memory", async () => {
    const { deps, state } = setup();
    await createQuickCheck(deps, { url: "one.example.org", locations: undefined, clientKey: "same" }, state);
    await createQuickCheck(deps, { url: "two.example.org", locations: undefined, clientKey: "same" }, state);
    const error = await createQuickCheck(deps, { url: "three.example.org", locations: undefined, clientKey: "same" }, state).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "rate_limited", status: 429 });
    await createQuickCheck(deps, { url: "three.example.org", locations: undefined, clientKey: "other" }, state);
  });

  it("maps probe-network errors to user-facing ones", async () => {
    const { deps, state, network } = setup();
    network.failNextCreateWith = 429;
    const error = await createQuickCheck(deps, { url: "x.example.org", locations: undefined, clientKey: "a" }, state).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "capacity", status: 503 });
  });

  it("returns null for unknown, malformed or non-HTTP measurements", async () => {
    const { deps, network } = setup();
    expect(await getQuickCheck(deps.globalping, "doesnotexist")).toBeNull();
    expect(await getQuickCheck(deps.globalping, "../etc/passwd")).toBeNull();
    network.measurements.set("pingone", { id: "pingone", hostname: "x", probes: [], createdAt: Date.now(), measurementOptions: undefined });
    const original = network.get.bind(network);
    network.get = (id: string) => {
      const out = original(id);
      return id === "pingone" ? { ...out, json: { ...(out.json as object), type: "ping" } } : out;
    };
    expect(await getQuickCheck(deps.globalping, "pingone")).toBeNull();
  });
});

describe("measurementTargetUrl", () => {
  it("rebuilds the URL from echoed options", () => {
    const m = measurementSchema.parse({ ...measurement("m", []), target: "Example.org", measurementOptions: { protocol: "HTTP", request: { path: "/a", query: "b=1" } } });
    expect(measurementTargetUrl(m)).toBe("http://example.org/a?b=1");
    const bare = measurementSchema.parse(measurement("m", []));
    expect(measurementTargetUrl(bare)).toBe("https://example.com/");
  });
});

describe("MemoryLimiter", () => {
  it("allows up to the limit per window and reports the wait", () => {
    let now = 1_000_000;
    const limiter = new MemoryLimiter(() => now);
    expect(limiter.hit("k", 60, 2)).toBe(0);
    expect(limiter.hit("k", 60, 2)).toBe(0);
    expect(limiter.hit("k", 60, 2)).toBeGreaterThan(0);
    now += 60_000;
    expect(limiter.hit("k", 60, 2)).toBe(0);
  });
});
