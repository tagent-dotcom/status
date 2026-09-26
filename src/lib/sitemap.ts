// Sitemap XML builders. Google allows 50,000 URLs per sitemap file, so status pages are split
// into numbered files listed by a sitemap index.

export const URLS_PER_SITEMAP = 50_000;

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function sitemapIndexXml(base: string, pages: number): string {
  const entries = Array.from({ length: pages }, (_, i) => `  <sitemap><loc>${escapeXml(`${base}/sitemaps/${i}.xml`)}</loc></sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>\n`;
}

export function urlSetXml(entries: Array<{ loc: string; lastmod?: Date }>): string {
  const body = entries
    .map((e) => `  <url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.toISOString()}</lastmod>` : ""}</url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export const XML_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
};
