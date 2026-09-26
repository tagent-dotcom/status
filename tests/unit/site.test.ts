import { describe, expect, it } from "vitest";
import { siteUrl } from "@/lib/site";

describe("siteUrl", () => {
  it("uses SITE_URL and strips trailing slashes and paths", () => {
    expect(siteUrl({ SITE_URL: "https://worldstatus.example/" })).toBe("https://worldstatus.example");
    expect(siteUrl({ SITE_URL: "https://worldstatus.example/some/path" })).toBe("https://worldstatus.example");
  });

  it("adds https:// when the scheme is missing", () => {
    expect(siteUrl({ SITE_URL: "status-kappa.vercel.app" })).toBe("https://status-kappa.vercel.app");
  });

  it("falls back when SITE_URL is blank or malformed (never throws)", () => {
    expect(siteUrl({ SITE_URL: "" })).toBe("http://localhost:3000");
    expect(siteUrl({ SITE_URL: "   " })).toBe("http://localhost:3000");
    expect(siteUrl({ SITE_URL: "ht tp://bad" })).toBe("http://localhost:3000");
    expect(siteUrl({ SITE_URL: "ftp://files.example" })).toBe("http://localhost:3000");
  });

  it("uses Vercel's production domain, then the deployment URL", () => {
    expect(siteUrl({ SITE_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "status.vercel.app", VERCEL_URL: "status-abc123.vercel.app" })).toBe(
      "https://status.vercel.app",
    );
    expect(siteUrl({ VERCEL_URL: "status-abc123.vercel.app" })).toBe("https://status-abc123.vercel.app");
  });
});
