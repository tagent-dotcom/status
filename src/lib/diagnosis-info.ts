// Shared (client + server) vocabulary for per-probe results.

export type Outcome = "up" | "down" | "degraded" | "inconclusive";
export type FailedStage = "dns" | "tcp" | "tls" | "http" | "connection";
export type NetworkType = "eyeball" | "datacenter" | "unknown";

export type DiagnosisCode =
  | "ok"
  | "ok_redirect"
  | "redirect_offsite"
  | "bot_protection"
  | "slow"
  | "block_page"
  | "geo_blocked"
  | "http_forbidden"
  | "http_legal_block"
  | "http_rate_limited"
  | "http_client_error"
  | "http_server_error"
  | "tls_invalid"
  | "dns_private_answer"
  | "dns_not_found"
  | "dns_failure"
  | "tcp_timeout"
  | "tcp_refused"
  | "network_unreachable"
  | "tls_handshake_failed"
  | "connection_reset"
  | "server_timeout"
  | "download_timeout"
  | "timeout"
  | "unknown_failure"
  | "probe_error";

export interface DiagnosisInfo {
  label: string;
  /** Plain-language explanation aimed at site owners and visitors. */
  explanation: string;
}

export const DIAGNOSES: Record<DiagnosisCode, DiagnosisInfo> = {
  ok: { label: "Up", explanation: "The site responded normally." },
  ok_redirect: { label: "Up (redirect)", explanation: "The site responded with a redirect within the same site." },
  redirect_offsite: {
    label: "Redirects elsewhere",
    explanation: "The site redirected to a different domain. Normal for some sites; if it happens only in some regions it can indicate a block page.",
  },
  bot_protection: {
    label: "Bot check",
    explanation: "The site is reachable but answered with a bot/challenge page (e.g. Cloudflare). Human visitors usually get through.",
  },
  slow: { label: "Slow", explanation: "The site responded, but took more than 10 seconds." },
  block_page: {
    label: "Block page",
    explanation: "The response looks like a government or ISP block page rather than the real site.",
  },
  geo_blocked: {
    label: "Country blocked",
    explanation: "The site's firewall/CDN is refusing visitors from this country or region.",
  },
  http_forbidden: {
    label: "403 Forbidden",
    explanation: "The server refused the request. If this happens only in some countries it is usually a geo-block or firewall rule.",
  },
  http_legal_block: {
    label: "451 Legal block",
    explanation: "The server says the content is unavailable for legal reasons in this location.",
  },
  http_rate_limited: {
    label: "429 Rate limited",
    explanation: "The server is throttling requests from this network.",
  },
  http_client_error: { label: "HTTP error", explanation: "The server answered with a 4xx error for this address." },
  http_server_error: { label: "Server error", explanation: "The server answered with a 5xx error: the site itself is failing." },
  tls_invalid: {
    label: "Certificate error",
    explanation: "The HTTPS certificate isn't trusted here. Browsers will show a security warning. If only some networks see it, the connection may be intercepted.",
  },
  dns_private_answer: {
    label: "DNS blocked",
    explanation: "The local DNS answered with a private/sinkhole address. This is the most common way ISPs block websites.",
  },
  dns_not_found: {
    label: "Domain not found",
    explanation: "This network's DNS says the domain doesn't exist. If other regions resolve it, the domain is being blocked or DNS is misconfigured.",
  },
  dns_failure: { label: "DNS failure", explanation: "The DNS lookup failed or timed out on this network." },
  tcp_timeout: {
    label: "Connection timeout",
    explanation: "The server's IP didn't accept a connection in time. Often caused by IP blocking, routing problems or a server that is down.",
  },
  tcp_refused: { label: "Connection refused", explanation: "The server's IP actively refused the connection: nothing is listening on the web port." },
  network_unreachable: { label: "Unreachable", explanation: "There was no network route to the server from this location." },
  tls_handshake_failed: {
    label: "HTTPS handshake failed",
    explanation: "The encrypted connection couldn't be established. Common with SNI-based filtering or a broken TLS setup.",
  },
  connection_reset: {
    label: "Connection reset",
    explanation: "The connection was cut mid-way. When it happens only in some countries this is typical of firewall/DPI filtering.",
  },
  server_timeout: { label: "No response", explanation: "Connected, but the server never started responding." },
  download_timeout: { label: "Partial response", explanation: "The server started responding but didn't finish in time." },
  timeout: { label: "Timeout", explanation: "The request timed out." },
  unknown_failure: { label: "Failed", explanation: "The request failed for an unrecognised reason. See the raw error." },
  probe_error: {
    label: "Probe error",
    explanation: "The measuring probe itself had a problem. This result says nothing about the site and is excluded from availability.",
  },
};

export const STAGE_LABELS: Record<FailedStage, string> = {
  dns: "DNS lookup",
  tcp: "TCP connect",
  tls: "TLS handshake",
  http: "HTTP response",
  connection: "Connection",
};

export interface ProbeLocationInfo {
  continent: string;
  region: string;
  country: string;
  state: string | null;
  city: string;
  asn: number;
  network: string;
  latitude: number;
  longitude: number;
  networkType: NetworkType;
}

export interface ProbeTimings {
  total: number | null;
  dns: number | null;
  tcp: number | null;
  tls: number | null;
  firstByte: number | null;
  download: number | null;
}

export interface ProbeTls {
  authorized: boolean;
  error: string | null;
  issuer: string | null;
  expiresAt: string | null;
  fingerprint: string | null;
}

export interface ProbeResult {
  probe: ProbeLocationInfo;
  outcome: Outcome;
  failedStage: FailedStage | null;
  diagnosis: DiagnosisCode;
  statusCode: number | null;
  resolvedAddress: string | null;
  redirectLocation: string | null;
  timings: ProbeTimings;
  tls: ProbeTls | null;
  errorMessage: string | null;
}
