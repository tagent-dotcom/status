import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  // Optional. Without a database the app runs in "quick check" mode: one page, live checks,
  // nothing stored (no history, no /status pages). Add it later to enable those.
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  GLOBALPING_API_URL: z
    .string()
    .url()
    .default("https://api.globalping.io")
    .transform((v) => v.replace(/\/+$/, "")),
  // Optional. Unauthenticated requests are capped at 50 probes per measurement and a much
  // lower hourly allowance. Required for any real traffic.
  GLOBALPING_TOKEN: z.string().optional(),
  // Our own ceiling on probes spent per hour, across all instances, so a traffic spike can't
  // burn through the Globalping allowance/credits.
  GLOBALPING_HOURLY_PROBE_BUDGET: z.coerce.number().int().min(1).default(250),
  MAX_PROBES_PER_CHECK: z.coerce.number().int().min(1).max(500).default(50),

  // Identical checks (same URL + same locations) inside this window share one measurement.
  CHECK_DEDUPE_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),

  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(30),

  // Only trust X-Forwarded-For / X-Real-IP when running behind a proxy that sets them
  // (Vercel, Cloudflare, nginx). Otherwise clients could spoof their rate-limit identity.
  // Defaults to true on Vercel, whose edge always sets these headers.
  TRUST_PROXY_HEADERS: bool.optional(),
  // Secret used to HMAC client IPs before they are stored. Required when a database is used.
  IP_HASH_SECRET: z.string().min(16, "IP_HASH_SECRET must be at least 16 characters").optional(),

  // Skip the server-side DNS resolution safety check. Only for tests with fake hostnames.
  UNSAFE_SKIP_DNS_CHECK: bool.default(false),
});

const refined = schema
  .superRefine((c, ctx) => {
    if (c.DATABASE_URL && !c.IP_HASH_SECRET) {
      ctx.addIssue({ code: "custom", path: ["IP_HASH_SECRET"], message: "IP_HASH_SECRET is required when DATABASE_URL is set" });
    }
  })
  .transform((c) => ({ ...c, TRUST_PROXY_HEADERS: c.TRUST_PROXY_HEADERS ?? process.env.VERCEL === "1" }));

export type Config = z.output<typeof refined>;

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached) return cached;
  // Hosting dashboards often create variables with blank values. Treat blank as unset so
  // optional settings fall back to their defaults instead of failing validation.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const parsed = refined.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  if (parsed.data.UNSAFE_SKIP_DNS_CHECK && process.env.NODE_ENV === "production") {
    throw new Error("UNSAFE_SKIP_DNS_CHECK must not be enabled in production");
  }
  if (!parsed.data.TRUST_PROXY_HEADERS && process.env.NODE_ENV === "production") {
    console.warn(
      "[config] TRUST_PROXY_HEADERS is false: all visitors share ONE rate-limit bucket. " +
        "Set TRUST_PROXY_HEADERS=true when running behind a proxy/CDN that sets X-Forwarded-For.",
    );
  }
  cached = parsed.data;
  return cached;
}

/** True when a database is configured (history, status pages and SEO are enabled). */
export function hasDatabase(): boolean {
  return Boolean(getConfig().DATABASE_URL);
}

/** Test helper: forget the cached config so changed env vars are picked up. */
export function resetConfigForTests(): void {
  cached = undefined;
}
