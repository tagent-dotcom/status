import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { StatusPageClient } from "@/components/status-page-client";
import { getCheck, getLatestFinishedCheck, type CheckView } from "@/lib/checks";
import { getDeps } from "@/lib/deps";
import { getSiteSummary, isIndexable } from "@/lib/history";
import { SITE_NAME } from "@/lib/site";
import { parseHostnameSlug } from "@/lib/target";

// Deduplicated per request: generateMetadata and the page share these queries.
const loadSite = cache(async (hostname: string) => getSiteSummary(getDeps().sql, hostname));
const loadLatest = cache(async (hostname: string) => getLatestFinishedCheck(getDeps().sql, hostname));

function describe(hostname: string, latest: CheckView | null): string {
  if (!latest) return `Check whether ${hostname} is down for everyone or just in your country or ISP. Live tests from real networks worldwide.`;
  const a = latest.analysis;
  const reached = a.tally.up + a.tally.degraded;
  const conclusive = reached + a.tally.down;
  const failing = a.countries.filter((c) => c.status === "down" || c.status === "partial").length;
  return `${hostname} was reachable from ${reached} of ${conclusive} probes in ${a.countries.length} countries at the last check${
    failing ? `, with problems in ${failing} ${failing === 1 ? "country" : "countries"}` : ""
  }. Run a live check and see history by country, city and ISP.`;
}

export async function generateMetadata(props: PageProps<"/status/[hostname]">): Promise<Metadata> {
  const { hostname: slug } = await props.params;
  const hostname = parseHostnameSlug(slug);
  if (!hostname) return { title: "Not found", robots: { index: false } };
  await connection();
  const [site, latest] = await Promise.all([loadSite(hostname), loadLatest(hostname)]);
  const indexable = site !== null && isIndexable(site);
  const title = `Is ${hostname} down? Live status worldwide`;
  return {
    title,
    description: describe(hostname, latest),
    // One canonical URL per site, whatever query (?check=, filters) was used to reach it.
    alternates: { canonical: `/status/${hostname}` },
    // Only proven, repeatedly checked sites are indexed: never thin pages for junk hostnames.
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description: describe(hostname, latest), url: `/status/${hostname}`, siteName: SITE_NAME },
  };
}

export default async function StatusPage(props: PageProps<"/status/[hostname]">) {
  const { hostname: slug } = await props.params;
  const search = await props.searchParams;
  const hostname = parseHostnameSlug(slug);
  if (!hostname) notFound();

  if (decodeURIComponent(slug) !== hostname) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(search)) if (typeof v === "string") qs.set(k, v);
    const query = qs.toString();
    permanentRedirect(`/status/${hostname}${query ? `?${query}` : ""}`);
  }

  await connection();
  const requestedId = typeof search.check === "string" ? search.check : null;
  const [latest, requested] = await Promise.all([
    loadLatest(hostname),
    requestedId ? getCheck(getDeps(), requestedId) : Promise.resolve(null),
  ]);
  // Ignore ?check= ids that belong to a different site.
  const initialCheck = requested && requested.hostname === hostname ? requested : latest;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-ink-2">Website status</p>
        <h1 className="break-all text-2xl font-semibold text-ink sm:text-3xl">Is {hostname} down?</h1>
      </header>
      <StatusPageClient hostname={hostname} initialCheck={initialCheck} />
    </div>
  );
}
