import { describe, expect, it } from "vitest";
import { analyze, statusOf } from "@/lib/analysis";
import { classifyResult } from "@/lib/diagnosis";
import type { ProbeResult } from "@/lib/diagnosis-info";
import { measurementSchema } from "@/lib/globalping/schema";
import { PROBES, failed, finished, item, measurement, type ProbeOverrides } from "../fixtures/globalping";

function results(entries: Array<[ProbeOverrides, unknown]>): ProbeResult[] {
  const parsed = measurementSchema.parse(measurement("m", entries.map(([p, r]) => item(p, r))));
  return parsed.results.map((i) => classifyResult(i, "example.com", "https")).filter((r): r is ProbeResult => r !== null);
}

describe("statusOf", () => {
  it.each([
    [{ up: 0, degraded: 0, down: 0 }, "unknown"],
    [{ up: 3, degraded: 0, down: 0 }, "up"],
    [{ up: 2, degraded: 1, down: 0 }, "degraded"],
    [{ up: 0, degraded: 0, down: 2 }, "down"],
    [{ up: 1, degraded: 0, down: 1 }, "partial"],
  ])("%j -> %s", (t, s) => expect(statusOf(t)).toBe(s));
});

describe("analyze", () => {
  it("reports all-up", () => {
    const a = analyze(results([[PROBES.newYorkComcast, finished()], [PROBES.frankfurtHetzner, finished()]]));
    expect(a.status).toBe("up");
    expect(a.insights[0]).toMatchObject({ severity: "info", title: "Up from all 2 countries tested" });
  });

  it("identifies a single-country outage and its cause (the Pakistan vs US case)", () => {
    const a = analyze(
      results([
        [PROBES.karachiPtcl, failed("getaddrinfo ENOTFOUND example.com", "target")],
        [PROBES.lahoreNayatel, failed("getaddrinfo ENOTFOUND example.com", "target")],
        [PROBES.newYorkComcast, finished()],
        [PROBES.ashburnAws, finished()],
        [PROBES.frankfurtHetzner, finished()],
      ]),
    );
    expect(a.status).toBe("partial");
    const pk = a.countries.find((c) => c.country === "PK");
    expect(pk).toMatchObject({ status: "down", down: 2, topFailure: "dns_not_found" });
    expect(a.insights[0]).toMatchObject({ severity: "critical", title: "Unreachable from Pakistan, working elsewhere" });
    expect(a.insights[0].detail).toContain("Domain not found");
  });

  it("identifies ISP-specific failures inside one country", () => {
    const a = analyze(
      results([
        [PROBES.karachiPtcl, failed("read ECONNRESET", "target")],
        [PROBES.lahoreNayatel, finished()],
        [PROBES.newYorkComcast, finished()],
      ]),
    );
    const insight = a.insights.find((i) => i.title.startsWith("ISP-specific"));
    expect(insight?.detail).toContain("Pakistan Telecommunication Company Limited (AS17557)");
    expect(insight?.detail).toContain("Connection reset");
  });

  it("calls a global failure a site-side problem", () => {
    const a = analyze(
      results([
        [PROBES.karachiPtcl, finished({ statusCode: 502 })],
        [PROBES.newYorkComcast, finished({ statusCode: 502 })],
      ]),
    );
    expect(a.status).toBe("down");
    expect(a.insights[0]).toMatchObject({ severity: "critical", title: "Down from every location tested" });
    expect(a.insights[0].detail).toContain("Server error");
  });

  it("never lets probe errors change the verdict", () => {
    const a = analyze(
      results([
        [PROBES.karachiPtcl, failed("probe crashed", "internal")],
        [PROBES.newYorkComcast, finished()],
      ]),
    );
    expect(a.status).toBe("up");
    expect(a.countries.find((c) => c.country === "PK")?.status).toBe("unknown");
    expect(a.insights.some((i) => i.title === "1 probe excluded")).toBe(true);
  });

  it("reports when nothing was conclusive", () => {
    const a = analyze(results([[PROBES.karachiPtcl, failed("x", "internal")]]));
    expect(a.status).toBe("unknown");
    expect(a.insights).toEqual([expect.objectContaining({ title: "No conclusive results" })]);
  });

  it("flags region-only offsite redirects as possible block pages", () => {
    const a = analyze(
      results([
        [PROBES.karachiPtcl, finished({ statusCode: 302, headers: { location: "https://notice.example-isp.pk/" } })],
        [PROBES.newYorkComcast, finished()],
      ]),
    );
    const insight = a.insights.find((i) => i.title === "Redirected elsewhere in some countries");
    expect(insight?.detail).toContain("Pakistan");
    expect(insight?.detail).toContain("notice.example-isp.pk");
  });

  it("flags countries that are much slower than the global median", () => {
    const a = analyze(
      results([
        [PROBES.karachiPtcl, finished({ timings: { total: 9000 } })],
        [PROBES.newYorkComcast, finished({ timings: { total: 300 } })],
        [PROBES.frankfurtHetzner, finished({ timings: { total: 350 } })],
        [PROBES.londonBt, finished({ timings: { total: 320 } })],
      ]),
    );
    expect(a.insights.some((i) => i.title === "Slow in Pakistan")).toBe(true);
  });

  it("warns that a single failing probe is weak evidence", () => {
    const a = analyze(
      results([
        [PROBES.karachiPtcl, failed("read ECONNRESET", "target")],
        [PROBES.newYorkComcast, finished()],
      ]),
    );
    expect(a.insights[0].detail).toContain("Only one probe was available here");
  });
});
