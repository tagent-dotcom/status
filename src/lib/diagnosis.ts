import type {
  DiagnosisCode,
  FailedStage,
  NetworkType,
  Outcome,
  ProbeLocationInfo,
  ProbeResult,
  ProbeTls,
} from "./diagnosis-info";
import type { GlobalpingFinishedHttpResult, GlobalpingProbe, GlobalpingResultItem } from "./globalping/schema";
import { isPublicIp } from "./ip";

export const SLOW_THRESHOLD_MS = 10_000;
const MAX_ERROR_LENGTH = 500;

interface Verdict {
  outcome: Outcome;
  failedStage: FailedStage | null;
  diagnosis: DiagnosisCode;
}

function networkTypeOf(tags: string[]): NetworkType {
  if (tags.includes("eyeball-network")) return "eyeball";
  if (tags.includes("datacenter-network")) return "datacenter";
  return "unknown";
}

export function probeLocation(probe: GlobalpingProbe): ProbeLocationInfo {
  return {
    continent: probe.continent,
    region: probe.region,
    country: probe.country.toUpperCase(),
    state: probe.state ?? null,
    city: probe.city,
    asn: probe.asn,
    network: probe.network,
    latitude: probe.latitude,
    longitude: probe.longitude,
    networkType: networkTypeOf(probe.tags),
  };
}

function header(headers: GlobalpingFinishedHttpResult["headers"], name: string): string | null {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  if (key === undefined) return null;
  const value = headers[key];
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// Phrases used by government/ISP block pages. Deliberately specific: a normal page that merely
// contains the word "blocked" must not match.
const BLOCK_PAGE_PATTERNS = [
  /\b(?:this|the requested) (?:website|site|url|web ?page|page|content) (?:has been|is|was) (?:blocked|restricted|banned)\b/i,
  /\baccess to (?:this|the requested) (?:website|site|url|web ?page|page|content) (?:has been|is) (?:blocked|restricted|denied|prohibited)\b/i,
  /\bblocked (?:by|under|as per|in compliance with|pursuant to) (?:the )?(?:order|orders|directive|directions|court|ministry|government|authorit(?:y|ies)|pta|regulator)\b/i,
  /\b(?:pakistan telecommunication authority|telecom regulatory authority)\b/i,
];

// Cloudflare "country blocked" (error 1009) and similar CDN wording.
const GEO_BLOCK_PATTERNS = [
  /error code:?\s*1009\b/i,
  /\bbanned the country or region\b/i,
  /\bnot available in your (?:country|region)\b/i,
];

const BLOCK_REDIRECT_PATTERN = /(?:^|[./-])(?:block(?:ed)?|restricted|censor(?:ed)?|forbidden|prohibited|warning)(?:[./-]|$)|pta\.gov/i;

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** True when `locationHost` is the target, a subdomain of it, or a parent of it (ignoring www). */
function isSameSite(targetHost: string, locationHost: string): boolean {
  const a = stripWww(targetHost.toLowerCase());
  const b = stripWww(locationHost.toLowerCase());
  return a === b || b.endsWith(`.${a}`) || a.endsWith(`.${b}`);
}

function classifyFinished(result: GlobalpingFinishedHttpResult, targetHost: string, protocol: "https" | "http"): Verdict & { redirectLocation: string | null } {
  const status = result.statusCode;
  const body = result.rawBody ?? "";
  const location = header(result.headers, "location");
  let redirectLocation: string | null = null;

  // A sinkhole answer that still produced an HTTP response (e.g. a block server on 10.x).
  if (result.resolvedAddress && !isPublicIp(result.resolvedAddress)) {
    return { outcome: "down", failedStage: "dns", diagnosis: "dns_private_answer", redirectLocation };
  }

  if (protocol === "https" && result.tls && !result.tls.authorized) {
    return { outcome: "down", failedStage: "tls", diagnosis: "tls_invalid", redirectLocation };
  }

  if (GEO_BLOCK_PATTERNS.some((p) => p.test(body))) {
    return { outcome: "down", failedStage: "http", diagnosis: "geo_blocked", redirectLocation };
  }
  if (BLOCK_PAGE_PATTERNS.some((p) => p.test(body))) {
    return { outcome: "down", failedStage: "http", diagnosis: "block_page", redirectLocation };
  }

  if (status >= 300 && status < 400) {
    if (location) {
      try {
        const resolved = new URL(location, `${protocol}://${targetHost}/`);
        redirectLocation = resolved.toString().slice(0, 500);
        if (BLOCK_REDIRECT_PATTERN.test(resolved.hostname) || BLOCK_REDIRECT_PATTERN.test(resolved.pathname)) {
          if (!isSameSite(targetHost, resolved.hostname)) {
            return { outcome: "down", failedStage: "http", diagnosis: "block_page", redirectLocation };
          }
        }
        if (!isSameSite(targetHost, resolved.hostname)) {
          return { outcome: "up", failedStage: null, diagnosis: "redirect_offsite", redirectLocation };
        }
      } catch {
        redirectLocation = location.slice(0, 500);
      }
    }
    return verdictWithSpeed(result, { outcome: "up", failedStage: null, diagnosis: "ok_redirect" }, redirectLocation);
  }

  if (status === 403 || status === 503 || status === 429) {
    // Bot challenges prove the site is reachable from here; they are not an outage.
    const mitigated = header(result.headers, "cf-mitigated");
    if (mitigated === "challenge" || /<title>\s*just a moment\.\.\.\s*<\/title>/i.test(body)) {
      return { outcome: "up", failedStage: null, diagnosis: "bot_protection", redirectLocation };
    }
  }

  if (status === 451) return { outcome: "down", failedStage: "http", diagnosis: "http_legal_block", redirectLocation };
  if (status === 403) return { outcome: "down", failedStage: "http", diagnosis: "http_forbidden", redirectLocation };
  if (status === 429) return { outcome: "degraded", failedStage: "http", diagnosis: "http_rate_limited", redirectLocation };
  if (status >= 500) return { outcome: "down", failedStage: "http", diagnosis: "http_server_error", redirectLocation };
  if (status >= 400) return { outcome: "down", failedStage: "http", diagnosis: "http_client_error", redirectLocation };
  if (status < 200) return { outcome: "down", failedStage: "http", diagnosis: "unknown_failure", redirectLocation };

  return verdictWithSpeed(result, { outcome: "up", failedStage: null, diagnosis: "ok" }, redirectLocation);
}

function verdictWithSpeed(result: GlobalpingFinishedHttpResult, verdict: Verdict, redirectLocation: string | null) {
  if (result.timings.total !== null && result.timings.total > SLOW_THRESHOLD_MS) {
    return { outcome: "degraded" as const, failedStage: null, diagnosis: "slow" as const, redirectLocation };
  }
  return { ...verdict, redirectLocation };
}

/**
 * Classifies a failed test from its error text. Messages come from the Globalping probe
 * (undici handler phases) or Node.js socket errors, e.g.:
 *   "The measurement timed out during DNS resolution."
 *   "Request timed out while establishing the TCP connection."
 *   "getaddrinfo ENOTFOUND example.invalid" / "connect ECONNREFUSED 1.2.3.4:443"
 */
export function classifyFailure(rawOutput: string, failureSource: string | undefined): Verdict {
  const msg = rawOutput;
  if (/private ip/i.test(msg)) return { outcome: "down", failedStage: "dns", diagnosis: "dns_private_answer" };
  if (failureSource === "internal") return { outcome: "inconclusive", failedStage: null, diagnosis: "probe_error" };
  if (/ENOTFOUND|NXDOMAIN/i.test(msg)) return { outcome: "down", failedStage: "dns", diagnosis: "dns_not_found" };
  if (failureSource === "resolver" || /DNS resolution|EAI_AGAIN|ESERVFAIL|SERVFAIL|ENODATA|EREFUSED|queryA|getaddrinfo/i.test(msg)) {
    return { outcome: "down", failedStage: "dns", diagnosis: "dns_failure" };
  }
  if (/establishing the TCP connection|connect ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(msg)) {
    return { outcome: "down", failedStage: "tcp", diagnosis: "tcp_timeout" };
  }
  if (/ECONNREFUSED/i.test(msg)) return { outcome: "down", failedStage: "tcp", diagnosis: "tcp_refused" };
  if (/EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL|EHOSTDOWN/i.test(msg)) {
    return { outcome: "down", failedStage: "tcp", diagnosis: "network_unreachable" };
  }
  if (/TLS handshake|secure TLS connection|EPROTO|ERR_SSL|SSL routines|wrong version number|tlsv1 alert|handshake failure|ALPN/i.test(msg)) {
    return { outcome: "down", failedStage: "tls", diagnosis: "tls_handshake_failed" };
  }
  if (/ECONNRESET|socket hang up|EPIPE|other side closed|UND_ERR_SOCKET|ECONNABORTED/i.test(msg)) {
    return { outcome: "down", failedStage: "connection", diagnosis: "connection_reset" };
  }
  if (/first response byte|UND_ERR_HEADERS_TIMEOUT/i.test(msg)) {
    return { outcome: "down", failedStage: "http", diagnosis: "server_timeout" };
  }
  if (/downloading the response|UND_ERR_BODY_TIMEOUT/i.test(msg)) {
    return { outcome: "degraded", failedStage: "http", diagnosis: "download_timeout" };
  }
  if (/timed? ?out|ETIMEDOUT/i.test(msg)) return { outcome: "down", failedStage: null, diagnosis: "timeout" };
  return { outcome: "down", failedStage: null, diagnosis: "unknown_failure" };
}

function tlsInfo(result: GlobalpingFinishedHttpResult): ProbeTls | null {
  if (!result.tls) return null;
  const issuer = result.tls.issuer ? (result.tls.issuer.O ?? result.tls.issuer.CN ?? null) : null;
  const expires = result.tls.expiresAt ? new Date(result.tls.expiresAt) : null;
  return {
    authorized: result.tls.authorized,
    error: result.tls.error ?? null,
    issuer,
    expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires.toISOString() : null,
    fingerprint: result.tls.fingerprint256 ?? null,
  };
}

function roundMs(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.max(0, Math.round(value));
}

/**
 * Classifies one probe's test result. Returns null for tests that haven't finished yet.
 */
export function classifyResult(
  item: GlobalpingResultItem,
  targetHost: string,
  protocol: "https" | "http",
): ProbeResult | null {
  const probe = probeLocation(item.probe);
  const result = item.result;
  const emptyTimings = { total: null, dns: null, tcp: null, tls: null, firstByte: null, download: null };

  if (result.status === "in-progress") return null;

  if (result.status === "offline") {
    return {
      probe,
      outcome: "inconclusive",
      failedStage: null,
      diagnosis: "probe_error",
      statusCode: null,
      resolvedAddress: null,
      redirectLocation: null,
      timings: emptyTimings,
      tls: null,
      errorMessage: "Probe was offline.",
    };
  }

  if (result.status === "failed") {
    const verdict = classifyFailure(result.rawOutput, result.failureSource);
    return {
      probe,
      ...verdict,
      statusCode: null,
      resolvedAddress: null,
      redirectLocation: null,
      timings: emptyTimings,
      tls: null,
      errorMessage: result.rawOutput.slice(0, MAX_ERROR_LENGTH) || null,
    };
  }

  const verdict = classifyFinished(result, targetHost, protocol);
  return {
    probe,
    outcome: verdict.outcome,
    failedStage: verdict.failedStage,
    diagnosis: verdict.diagnosis,
    statusCode: result.statusCode,
    resolvedAddress: result.resolvedAddress,
    redirectLocation: verdict.redirectLocation,
    timings: {
      total: roundMs(result.timings.total),
      dns: roundMs(result.timings.dns),
      tcp: roundMs(result.timings.tcp),
      tls: roundMs(result.timings.tls),
      firstByte: roundMs(result.timings.firstByte),
      download: roundMs(result.timings.download),
    },
    tls: tlsInfo(result),
    errorMessage: result.tls?.error ?? null,
  };
}
