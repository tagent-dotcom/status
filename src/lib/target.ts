// Parsing and validation of user-entered websites. Pure (no Node APIs) so the browser can use
// the same rules for instant feedback; the server re-validates and adds a DNS check (ssrf.ts).

export interface Target {
  /** Lowercase ASCII (punycode) hostname, no trailing dot. Keys the status page. */
  hostname: string;
  protocol: "https" | "http";
  /** Always the default port for the protocol; other ports are refused (see below). */
  port: 443 | 80;
  /** Path including leading slash, without query. */
  path: string;
  /** Query string without the leading "?", or "". */
  query: string;
  /** Canonical URL string. */
  url: string;
}

export type TargetError =
  | "empty"
  | "too_long"
  | "invalid_url"
  | "unsupported_protocol"
  | "credentials_not_allowed"
  | "ip_not_allowed"
  | "port_not_allowed"
  | "invalid_hostname"
  | "reserved_hostname";

export type TargetResult = { ok: true; target: Target } | { ok: false; error: TargetError; message: string };

const MAX_INPUT_LENGTH = 2048;
const MAX_PATH_LENGTH = 1024;

// Special-use / private TLDs that never resolve on the public internet (RFC 6761, 6762, 8375,
// 9476 plus common internal conventions). Checking them is pointless and can reach internal
// infrastructure on a probe's LAN.
const RESERVED_TLDS = new Set([
  "localhost",
  "local",
  "internal",
  "intranet",
  "private",
  "corp",
  "home",
  "lan",
  "test",
  "example",
  "invalid",
  "onion",
  "alt",
  "arpa",
]);

const messages: Record<TargetError, string> = {
  empty: "Enter a website address, for example example.com.",
  too_long: "That address is too long.",
  invalid_url: "That doesn't look like a website address.",
  unsupported_protocol: "Only http:// and https:// websites can be checked.",
  credentials_not_allowed: "Remove the username/password from the address.",
  ip_not_allowed: "Enter a domain name rather than an IP address.",
  port_not_allowed: "Only standard web ports (80 and 443) can be checked.",
  invalid_hostname: "That domain name isn't valid.",
  reserved_hostname: "That is a private or reserved domain name and can't be checked from the internet.",
};

function fail(error: TargetError): TargetResult {
  return { ok: false, error, message: messages[error] };
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Validates an already-lowercased ASCII hostname. */
export function isValidHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) return false;
  const labels = hostname.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL.test(l))) return false;
  return TLD.test(labels[labels.length - 1]);
}

function looksLikeIp(host: string): boolean {
  if (host.startsWith("[")) return true; // URL() brackets IPv6 hosts
  // WHATWG URL already normalises decimal/octal/hex IPv4 forms (e.g. 2130706433) to dotted quads.
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Parses user input such as "example.com", "https://www.example.com/path?q=1" or
 * "EXAMPLE.com." into a normalised target, or explains why it can't be checked.
 */
export function parseTarget(input: string): TargetResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return fail("empty");
  if (trimmed.length > MAX_INPUT_LENGTH) return fail("too_long");
  if (/\s/.test(trimmed)) return fail("invalid_url");

  // Accept bare domains. Anything with an explicit scheme must be http(s).
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  let candidate = trimmed;
  if (schemeMatch && trimmed.slice(schemeMatch[0].length).startsWith("//")) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return fail("unsupported_protocol");
  } else if (schemeMatch && !/^[^:]+:\d/.test(trimmed)) {
    // "javascript:alert(1)", "mailto:x" etc. ("example.com:443" is host:port, handled below.)
    return fail("unsupported_protocol");
  } else {
    candidate = `https://${trimmed.replace(/^\/\/+/, "")}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail("invalid_url");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return fail("unsupported_protocol");
  if (url.username !== "" || url.password !== "") return fail("credentials_not_allowed");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.length === 0) return fail("invalid_url");
  if (looksLikeIp(hostname)) return fail("ip_not_allowed");

  // Probing arbitrary ports turns the network into a port scanner; only standard web ports.
  const protocol = url.protocol === "https:" ? "https" : "http";
  const port = url.port === "" ? (protocol === "https" ? 443 : 80) : Number(url.port);
  if ((protocol === "https" && port !== 443) || (protocol === "http" && port !== 80)) {
    return fail("port_not_allowed");
  }

  if (!isValidHostname(hostname)) return fail("invalid_hostname");
  const tld = hostname.slice(hostname.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.has(tld)) return fail("reserved_hostname");

  const path = url.pathname || "/";
  if (path.length > MAX_PATH_LENGTH) return fail("too_long");
  const query = url.search.replace(/^\?/, "");
  if (query.length > MAX_PATH_LENGTH) return fail("too_long");

  const canonical = `${protocol}://${hostname}${path}${query ? `?${query}` : ""}`;
  return {
    ok: true,
    target: { hostname, protocol, port: port as 443 | 80, path, query, url: canonical },
  };
}

/**
 * Validates the hostname segment of a /status/<hostname> URL. Stricter than parseTarget:
 * the page slug must already be canonical so each site has exactly one URL (good for SEO).
 */
export function parseHostnameSlug(slug: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const result = parseTarget(decoded);
  if (!result.ok) return null;
  const { hostname, path, query } = result.target;
  if (path !== "/" || query !== "") return null;
  return hostname;
}
