import Link from "next/link";
import { connection } from "next/server";
import { HomeCheckForm } from "@/components/home-check-form";
import { QuickCheck } from "@/components/quick-check";
import { hasDatabase } from "@/lib/config";
import { getSql } from "@/lib/db/client";
import { listRecentlyCheckedSites } from "@/lib/history";
import { SITE_TAGLINE } from "@/lib/site";

async function recentSites(): Promise<string[]> {
  if (!hasDatabase()) return [];
  try {
    return (await listRecentlyCheckedSites(getSql(), 12)).map((s) => s.hostname);
  } catch (error) {
    // The home page must still work (and let people start checks) if this query fails.
    console.error("Could not load recently checked sites", error);
    return [];
  }
}

const STEPS: Array<{ title: string; body: string; requiresDatabase?: boolean }> = [
  {
    title: "Real networks, not just data centers",
    body: "Each check runs from probes on home broadband, mobile and data-center connections in the countries, cities and ISPs you choose.",
  },
  {
    title: "Every step is measured",
    body: "DNS lookup, connection, HTTPS handshake and HTTP response are timed separately, so a failure points at the layer that broke.",
  },
  {
    title: "We explain the pattern",
    body: "Down in one country but up elsewhere? Failing on one ISP only? A private DNS answer or a block page? The results say so in plain language.",
  },
  {
    requiresDatabase: true,
    title: "History you can filter",
    body: "Every result is kept. Filter a site's history by country, city, ISP, network type and date to see when and where problems happen.",
  },
];

export default async function Home() {
  await connection();
  const persistent = hasDatabase();
  const recent = await recentSites();

  return (
    <div className="space-y-14">
      <section className="mx-auto max-w-3xl space-y-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{SITE_TAGLINE}</h1>
        <p className="text-lg text-ink-2">
          Check any website from real internet connections around the world. Find out whether it&apos;s down for everyone, blocked in one
          country, or failing on a single ISP, and why.
        </p>
        {persistent ? (
          <div className="rounded-xl border border-line bg-surface p-4 text-left shadow-sm sm:p-5">
            <HomeCheckForm />
          </div>
        ) : null}
      </section>

      {/* Without a database, results appear right here (full width) instead of on /status pages. */}
      {!persistent && <QuickCheck />}

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading" className="space-y-3">
          <h2 id="recent-heading" className="text-sm font-semibold text-ink-2">
            Recently checked
          </h2>
          <ul className="flex flex-wrap gap-2">
            {recent.map((host) => (
              <li key={host}>
                <Link href={`/status/${host}`} className="inline-block rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink hover:bg-surface-2">
                  {host}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="how-it-works" aria-labelledby="how-heading" className="space-y-5">
        <h2 id="how-heading" className="text-xl font-semibold text-ink">
          How it works
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {STEPS.filter((s) => persistent || !s.requiresDatabase).map((s) => (
            <div key={s.title} className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-medium text-ink">{s.title}</h3>
              <p className="mt-1 text-sm text-ink-2">{s.body}</p>
            </div>
          ))}
        </div>
        {persistent && (
        <p className="text-sm text-ink-2">
          Every site gets a public page at <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-ink">/status/example.com</code> that
          anyone can open, share and re-check.
        </p>
        )}
      </section>
    </div>
  );
}
