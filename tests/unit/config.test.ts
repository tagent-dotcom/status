import { afterEach, describe, expect, it } from "vitest";
import { getConfig, resetConfigForTests } from "@/lib/config";

const KEYS = ["DATABASE_URL", "IP_HASH_SECRET", "DATABASE_POOL_MAX", "GLOBALPING_API_URL", "TRUST_PROXY_HEADERS", "RATE_LIMIT_PER_MINUTE"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigForTests();
});

describe("getConfig", () => {
  it("treats blank variables as unset so defaults apply", () => {
    Object.assign(process.env, {
      DATABASE_URL: "postgres://u:p@db/x",
      IP_HASH_SECRET: "0123456789abcdef",
      DATABASE_POOL_MAX: "",
      GLOBALPING_API_URL: "  ",
      TRUST_PROXY_HEADERS: "",
      RATE_LIMIT_PER_MINUTE: "",
    });
    resetConfigForTests();
    expect(getConfig()).toMatchObject({
      DATABASE_POOL_MAX: 10,
      GLOBALPING_API_URL: "https://api.globalping.io",
      TRUST_PROXY_HEADERS: false,
      RATE_LIMIT_PER_MINUTE: 5,
    });
  });

  it("runs without a database (quick-check mode) and needs no secret then", () => {
    Object.assign(process.env, { DATABASE_URL: "", IP_HASH_SECRET: "" });
    resetConfigForTests();
    expect(getConfig().DATABASE_URL).toBeUndefined();
  });

  it("ignores a short IP_HASH_SECRET when there is no database", () => {
    Object.assign(process.env, { DATABASE_URL: "", IP_HASH_SECRET: "short" });
    resetConfigForTests();
    expect(() => getConfig()).not.toThrow();
  });

  it("requires a 16+ character IP_HASH_SECRET with a database", () => {
    Object.assign(process.env, { DATABASE_URL: "postgres://u:p@db/x", IP_HASH_SECRET: "short" });
    resetConfigForTests();
    expect(() => getConfig()).toThrow(/at least 16 characters/);
  });

  it("requires IP_HASH_SECRET once a database is configured", () => {
    Object.assign(process.env, { DATABASE_URL: "postgres://u:p@db/x", IP_HASH_SECRET: "" });
    resetConfigForTests();
    expect(() => getConfig()).toThrow(/IP_HASH_SECRET is required when DATABASE_URL is set/);
  });

  it("trusts proxy headers by default on Vercel only", () => {
    const vercel = process.env.VERCEL;
    try {
      Object.assign(process.env, { DATABASE_URL: "", TRUST_PROXY_HEADERS: "" });
      process.env.VERCEL = "1";
      resetConfigForTests();
      expect(getConfig().TRUST_PROXY_HEADERS).toBe(true);
      delete process.env.VERCEL;
      resetConfigForTests();
      expect(getConfig().TRUST_PROXY_HEADERS).toBe(false);
      process.env.VERCEL = "1";
      process.env.TRUST_PROXY_HEADERS = "false";
      resetConfigForTests();
      expect(getConfig().TRUST_PROXY_HEADERS).toBe(false);
    } finally {
      if (vercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = vercel;
    }
  });
});
