export const SITE_NAME = "WorldStatus";
export const SITE_TAGLINE = "Is it down everywhere, or just where you are?";

/**
 * Public origin without trailing slash. Read directly from the environment (not the full
 * validated config) so metadata routes work without database settings.
 */
export function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
