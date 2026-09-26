import { getSql } from "@/lib/db/client";
import { countIndexableSites } from "@/lib/history";
import { siteUrl } from "@/lib/site";
import { URLS_PER_SITEMAP, XML_HEADERS, sitemapIndexXml } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

/** Sitemap index. Page 0 also carries the home page. */
export async function GET() {
  const count = await countIndexableSites(getSql());
  const pages = Math.max(1, Math.ceil(count / URLS_PER_SITEMAP));
  return new Response(sitemapIndexXml(siteUrl(), pages), { headers: XML_HEADERS });
}
