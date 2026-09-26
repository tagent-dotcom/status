import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { expandIPv6 } from "./ip";

/**
 * Best-effort client IP. Forwarding headers are only honoured when the deployment says a
 * trusted proxy sets them; otherwise any client could pick its own rate-limit identity.
 * Returns null when unknown (all such requests then share one rate-limit bucket).
 */
export function clientIp(headers: Headers, trustProxyHeaders: boolean): string | null {
  if (!trustProxyHeaders) return null;
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    // First entry is the original client when every hop appends (Vercel, nginx, AWS ALB).
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && isIP(value)) return value;
  }
  return null;
}

/** Keyed hash of an IP so we can rate-limit without storing personal data. */
export function hashIp(ip: string | null, secret: string): string {
  const value = ip ?? "unknown";
  // Group IPv6 by /64: one subscriber usually gets a whole /64, so per-address limits are trivial to dodge.
  const expanded = isIP(value) === 6 ? expandIPv6(value) : null;
  const normalised = expanded ? expanded.split(":").slice(0, 4).join(":") : value;
  return createHmac("sha256", secret).update(normalised).digest("hex").slice(0, 32);
}
