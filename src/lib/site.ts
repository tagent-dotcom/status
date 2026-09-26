export const SITE_NAME = "WorldStatus";
export const SITE_TAGLINE = "Is it down everywhere, or just where you are?";

const FALLBACK_ORIGIN = "http://localhost:3000";

/** Parses an origin, adding https:// when the scheme is missing. Returns null if unusable. */
function toOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Public origin without trailing slash, used for canonical URLs, robots.txt and the sitemap.
 * Read directly from the environment (not the full validated config) so metadata works during
 * builds without database settings. Never throws: a blank or malformed SITE_URL falls back to
 * Vercel's production domain, then the deployment URL, then localhost.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  return (
    toOrigin(env.SITE_URL) ??
    toOrigin(env.VERCEL_PROJECT_PRODUCTION_URL) ??
    toOrigin(env.VERCEL_URL) ??
    FALLBACK_ORIGIN
  );
}
