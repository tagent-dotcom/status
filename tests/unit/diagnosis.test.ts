import { describe, expect, it } from "vitest";
import { classifyFailure, classifyResult } from "@/lib/diagnosis";
import { measurementSchema } from "@/lib/globalping/schema";
import { PROBES, finished, item, measurement } from "../fixtures/globalping";

function classify(result: unknown, host = "example.com", protocol: "https" | "http" = "https") {
  const parsed = measurementSchema.parse(measurement("m1", [item(PROBES.karachiPtcl, result)]));
  return classifyResult(parsed.results[0], host, protocol);
}

describe("classifyResult (finished tests)", () => {
  it("marks a normal 200 as up and keeps location + timings", () => {
    const r = classify(finished());
    expect(r).toMatchObject({
      outcome: "up",
      diagnosis: "ok",
      failedStage: null,
      statusCode: 200,
      probe: { country: "PK", city: "Karachi", asn: 17557, networkType: "eyeball" },
      timings: { total: 420, firstByte: 250 },
      tls: { authorized: true, issuer: "Let's Encrypt", expiresAt: "2027-01-01T00:00:00.000Z" },
    });
  });

  it("treats same-site redirects as up", () => {
    const r = classify(finished({ statusCode: 301, headers: { location: "https://www.example.com/" } }));
    expect(r).toMatchObject({ outcome: "up", diagnosis: "ok_redirect", redirectLocation: "https://www.example.com/" });
  });

  it("resolves relative redirect locations", () => {
    const r = classify(finished({ statusCode: 302, headers: { Location: "/login" } }));
    expect(r).toMatchObject({ diagnosis: "ok_redirect", redirectLocation: "https://example.com/login" });
  });

  it("flags redirects to another domain without calling it down", () => {
    const r = classify(finished({ statusCode: 302, headers: { location: "https://other-brand.net/" } }));
    expect(r).toMatchObject({ outcome: "up", diagnosis: "redirect_offsite" });
  });

  it("detects redirects to block pages", () => {
    const r = classify(finished({ statusCode: 302, headers: { location: "http://blocked.isp-example.pk/" } }));
    expect(r).toMatchObject({ outcome: "down", failedStage: "http", diagnosis: "block_page" });
  });

  it("does not treat a same-site path containing 'blocked' as a block page", () => {
    const r = classify(finished({ statusCode: 302, headers: { location: "https://example.com/blocked/" } }));
    expect(r).toMatchObject({ outcome: "up", diagnosis: "ok_redirect" });
  });

  it("detects ISP/government block page bodies", () => {
    const r = classify(finished({ rawBody: "<h1>This website has been blocked as per the directions of the PTA</h1>", tls: null }), "example.com", "http");
    expect(r).toMatchObject({ outcome: "down", diagnosis: "block_page" });
  });

  it("does not flag ordinary pages that mention blocking", () => {
    const r = classify(finished({ rawBody: "<p>Learn how to get blocked accounts restored.</p>" }));
    expect(r).toMatchObject({ outcome: "up", diagnosis: "ok" });
  });

  it("detects Cloudflare country bans", () => {
    const r = classify(finished({ statusCode: 403, rawBody: "Error code: 1009 ... The owner of this website has banned the country or region your IP address is in" }));
    expect(r).toMatchObject({ outcome: "down", diagnosis: "geo_blocked" });
  });

  it("treats bot challenges as reachable", () => {
    expect(classify(finished({ statusCode: 403, headers: { "cf-mitigated": "challenge" } }))).toMatchObject({ outcome: "up", diagnosis: "bot_protection" });
    expect(classify(finished({ statusCode: 503, rawBody: "<title>Just a moment...</title>" }))).toMatchObject({ outcome: "up", diagnosis: "bot_protection" });
  });

  it.each([
    [403, "down", "http_forbidden"],
    [451, "down", "http_legal_block"],
    [429, "degraded", "http_rate_limited"],
    [404, "down", "http_client_error"],
    [500, "down", "http_server_error"],
    [502, "down", "http_server_error"],
  ])("maps HTTP %i to %s/%s", (statusCode, outcome, diagnosis) => {
    expect(classify(finished({ statusCode }))).toMatchObject({ outcome, diagnosis, failedStage: "http" });
  });

  it("flags untrusted certificates on https", () => {
    const r = classify(finished({ tls: { authorized: false, error: "CERT_HAS_EXPIRED" } }));
    expect(r).toMatchObject({ outcome: "down", failedStage: "tls", diagnosis: "tls_invalid", errorMessage: "CERT_HAS_EXPIRED" });
  });

  it("flags private/sinkhole DNS answers even when HTTP succeeded", () => {
    const r = classify(finished({ resolvedAddress: "10.10.10.10" }));
    expect(r).toMatchObject({ outcome: "down", failedStage: "dns", diagnosis: "dns_private_answer" });
  });

  it("marks very slow responses as degraded", () => {
    const r = classify(finished({ timings: { total: 12_500 } }));
    expect(r).toMatchObject({ outcome: "degraded", diagnosis: "slow" });
  });

  it("returns null for in-progress tests", () => {
    expect(classify({ status: "in-progress", rawOutput: "" })).toBeNull();
  });

  it("treats offline probes as inconclusive", () => {
    expect(classify({ status: "offline", rawOutput: "" })).toMatchObject({ outcome: "inconclusive", diagnosis: "probe_error" });
  });

  it("treats unknown future statuses as inconclusive instead of failing the measurement", () => {
    expect(classify({ status: "quarantined", rawOutput: "" })).toMatchObject({ outcome: "inconclusive", diagnosis: "probe_error" });
  });
});

describe("classifyFailure", () => {
  it.each([
    ["The measurement timed out during DNS resolution.", "resolver", "dns", "dns_failure"],
    ["getaddrinfo ENOTFOUND example.com", "target", "dns", "dns_not_found"],
    ["getaddrinfo EAI_AGAIN example.com", undefined, "dns", "dns_failure"],
    ["Private IP ranges are not allowed.", "target", "dns", "dns_private_answer"],
    ["Request timed out while establishing the TCP connection.", "target", "tcp", "tcp_timeout"],
    ["connect ECONNREFUSED 93.184.216.34:443", "target", "tcp", "tcp_refused"],
    ["connect EHOSTUNREACH 93.184.216.34:443", "target", "tcp", "network_unreachable"],
    ["Request timed out during the TLS handshake.", "target", "tls", "tls_handshake_failed"],
    ["Client network socket disconnected before secure TLS connection was established", "target", "tls", "tls_handshake_failed"],
    ["read ECONNRESET", "target", "connection", "connection_reset"],
    ["socket hang up", "target", "connection", "connection_reset"],
    ["Request timed out while waiting for the first response byte.", "target", "http", "server_timeout"],
  ])("classifies %j", (msg, source, stage, diagnosis) => {
    expect(classifyFailure(msg, source)).toMatchObject({ outcome: "down", failedStage: stage, diagnosis });
  });

  it("marks download timeouts as degraded", () => {
    expect(classifyFailure("Request timed out while downloading the response.", "target")).toMatchObject({ outcome: "degraded", diagnosis: "download_timeout" });
  });

  it("never counts probe-internal failures as downtime", () => {
    expect(classifyFailure("Something broke inside the probe", "internal")).toMatchObject({ outcome: "inconclusive", diagnosis: "probe_error" });
  });

  it("falls back to unknown_failure", () => {
    expect(classifyFailure("weird", undefined)).toMatchObject({ outcome: "down", failedStage: null, diagnosis: "unknown_failure" });
  });
});
