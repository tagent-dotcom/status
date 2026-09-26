import type { NextRequest } from "next/server";
import { getSql } from "@/lib/db/client";
import { listIndexableSites } from "@/lib/history";
import { siteUrl } from "@/lib/site";
import { URLS_PER_SITEMAP, XML_HEADERS, urlSetXml } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, ctx: RouteContext<"/sitemaps/[page]">) {
  const { page: raw } = await ctx.params;
  const match = /^(\d{1,6})\.xml$/.exec(raw);
  if (!match) return new Response("Not found", { status: 404 });
  const page = Number(match[1]);

  const base = siteUrl();
  const sites = await listIndexableSites(getSql(), page * URLS_PER_SITEMAP, URLS_PER_SITEMAP);
  if (sites.length === 0 && page > 0) return new Response("Not found", { status: 404 });

  const entries: Array<{ loc: string; lastmod?: Date }> = sites.map((s) => ({ loc: `${base}/status/${s.hostname}`, lastmod: s.lastCheckedAt }));
  if (page === 0) entries.unshift({ loc: `${base}/` });
  return new Response(urlSetXml(entries), { headers: XML_HEADERS });
}
