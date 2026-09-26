import { resolve4, resolve6 } from "node:dns/promises";
import { isPublicIp } from "./ip";

export type DnsSafety =
  | { ok: true; addresses: string[] }
  | { ok: false; reason: "private_address"; addresses: string[] };

const LOOKUP_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dns timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function safeResolve(fn: (h: string) => Promise<string[]>, hostname: string): Promise<string[]> {
  try {
    return await withTimeout(fn(hostname), LOOKUP_TIMEOUT_MS);
  } catch {
    // NXDOMAIN, NODATA, SERVFAIL, timeout from *our* vantage point. That is not a reason to
    // refuse: a site blocked or broken near our server is exactly what users need to check
    // from elsewhere. Remote probes do their own resolution.
    return [];
  }
}

/**
 * Refuses hostnames whose public DNS points at private/internal addresses (e.g. a domain
 * with an A record of 127.0.0.1 or 169.254.169.254). Probes resolve independently, and the
 * Globalping network refuses private targets itself; this is our own layer of defence so
 * the service can't be pointed at internal infrastructure.
 */
export async function checkDnsSafety(hostname: string): Promise<DnsSafety> {
  const [v4, v6] = await Promise.all([safeResolve(resolve4, hostname), safeResolve(resolve6, hostname)]);
  const addresses = [...v4, ...v6];
  if (addresses.some((a) => !isPublicIp(a))) {
    return { ok: false, reason: "private_address", addresses };
  }
  return { ok: true, addresses };
}
