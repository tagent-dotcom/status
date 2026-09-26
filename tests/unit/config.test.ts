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

  it("still requires the database URL and secret, naming them in the error", () => {
    Object.assign(process.env, { DATABASE_URL: "", IP_HASH_SECRET: "" });
    resetConfigForTests();
    expect(() => getConfig()).toThrow(/DATABASE_URL.*IP_HASH_SECRET|IP_HASH_SECRET.*DATABASE_URL/);
  });
});
