import { DIAGNOSES, type DiagnosisCode, type Outcome, type ProbeResult } from "./diagnosis-info";
import { countryName } from "./geo/countries";

// Turns a set of probe results into answers: where is it failing, and most likely why.
// Shared by server and client (pure, no Node APIs).

export type AreaStatus = "up" | "degraded" | "partial" | "down" | "unknown";

export interface Tally {
  total: number;
  up: number;
  degraded: number;
  down: number;
  inconclusive: number;
}

export interface CountrySummary extends Tally {
  country: string;
  status: AreaStatus;
  topFailure: DiagnosisCode | null;
  medianTotalMs: number | null;
}

export interface NetworkSummary extends Tally {
  country: string;
  asn: number;
  network: string;
  status: AreaStatus;
  topFailure: DiagnosisCode | null;
}

export type InsightSeverity = "critical" | "warning" | "info";

export interface Insight {
  severity: InsightSeverity;
  title: string;
  detail: string;
}

export interface Analysis {
  tally: Tally;
  status: AreaStatus;
  countries: CountrySummary[];
  networks: NetworkSummary[];
  insights: Insight[];
}

function emptyTally(): Tally {
  return { total: 0, up: 0, degraded: 0, down: 0, inconclusive: 0 };
}

function add(tally: Tally, outcome: Outcome): void {
  tally.total += 1;
  tally[outcome] += 1;
}

/** Status of an area from its tally. Inconclusive (probe-side) results never count. */
export function statusOf(t: Pick<Tally, "up" | "degraded" | "down">): AreaStatus {
  const conclusive = t.up + t.degraded + t.down;
  if (conclusive === 0) return "unknown";
  if (t.down === 0) return t.degraded === 0 ? "up" : "degraded";
  if (t.up + t.degraded === 0) return "down";
  return "partial";
}

function topFailure(results: ProbeResult[]): DiagnosisCode | null {
  const counts = new Map<DiagnosisCode, number>();
  for (const r of results) {
    if (r.outcome === "down" || r.outcome === "degraded") counts.set(r.diagnosis, (counts.get(r.diagnosis) ?? 0) + 1);
  }
  let best: DiagnosisCode | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function probesPhrase(n: number): string {
  return n === 1 ? "1 probe" : `${n} probes`;
}

function reason(code: DiagnosisCode | null): string {
  if (!code) return "";
  return ` Most common result: ${DIAGNOSES[code].label}. ${DIAGNOSES[code].explanation}`;
}

function groupBy<K, V>(items: V[], key: (v: V) => K): Map<K, V[]> {
  const map = new Map<K, V[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function analyze(results: ProbeResult[]): Analysis {
  const tally = emptyTally();
  for (const r of results) add(tally, r.outcome);

  const byCountry = groupBy(results, (r) => r.probe.country);
  const countries: CountrySummary[] = [...byCountry].map(([country, rs]) => {
    const t = emptyTally();
    for (const r of rs) add(t, r.outcome);
    const totals = rs.filter((r) => r.outcome !== "inconclusive" && r.timings.total !== null).map((r) => r.timings.total as number);
    return { country, ...t, status: statusOf(t), topFailure: topFailure(rs), medianTotalMs: median(totals) };
  });
  countries.sort((a, b) => countryName(a.country).localeCompare(countryName(b.country)));

  const byNetwork = groupBy(results, (r) => `${r.probe.country}|${r.probe.asn}`);
  const networks: NetworkSummary[] = [...byNetwork].map(([, rs]) => {
    const t = emptyTally();
    for (const r of rs) add(t, r.outcome);
    const { country, asn, network } = rs[0].probe;
    return { country, asn, network, ...t, status: statusOf(t), topFailure: topFailure(rs) };
  });

  const status = statusOf(tally);
  return { tally, status, countries, networks, insights: buildInsights(results, tally, status, countries, networks) };
}

function buildInsights(
  results: ProbeResult[],
  tally: Tally,
  status: AreaStatus,
  countries: CountrySummary[],
  networks: NetworkSummary[],
): Insight[] {
  const insights: Insight[] = [];
  const conclusive = tally.up + tally.degraded + tally.down;

  if (conclusive === 0) {
    if (tally.total > 0) {
      insights.push({
        severity: "info",
        title: "No conclusive results",
        detail: "Every probe reported an internal problem, so this check says nothing about the site. Try again.",
      });
    }
    return insights;
  }

  if (status === "down") {
    insights.push({
      severity: "critical",
      title: "Down from every location tested",
      detail: `All ${probesPhrase(conclusive)} failed. A problem on the site's side is far more likely than regional blocking.${reason(topFailure(results))}`,
    });
  } else if (status === "up") {
    insights.push({
      severity: "info",
      title: `Up from all ${countries.length === 1 ? "1 country" : `${countries.length} countries`} tested`,
      detail: `All ${probesPhrase(conclusive)} reached the site.`,
    });
  } else {
    // Countries where every conclusive probe failed while the rest of the world gets through.
    const reachableElsewhere = (c: CountrySummary) => {
      const otherUp = tally.up + tally.degraded - (c.up + c.degraded);
      const otherConclusive = conclusive - (c.up + c.degraded + c.down);
      return otherConclusive > 0 && otherUp / otherConclusive >= 0.5;
    };
    const downCountries = countries.filter((c) => c.status === "down" && reachableElsewhere(c));
    for (const c of downCountries) {
      const n = c.down;
      insights.push({
        severity: "critical",
        title: `Unreachable from ${countryName(c.country)}, working elsewhere`,
        detail: `${probesPhrase(n)} in ${countryName(c.country)} failed while most other countries reached the site.${n === 1 ? " Only one probe was available here, so confirm with another check." : ""}${reason(c.topFailure)}`,
      });
    }

    // Within a country with mixed results: specific ISPs failing while others work.
    const partialCountries = countries.filter((c) => c.status === "partial");
    for (const c of partialCountries) {
      const nets = networks.filter((n) => n.country === c.country);
      const failing = nets.filter((n) => n.status === "down");
      const working = nets.filter((n) => n.status === "up" || n.status === "degraded");
      if (failing.length > 0 && working.length > 0) {
        const names = failing.map((n) => `${n.network} (AS${n.asn})`).join(", ");
        insights.push({
          severity: "warning",
          title: `ISP-specific problem in ${countryName(c.country)}`,
          detail: `Failing on ${names}, while ${working.length === 1 ? "another ISP" : `${working.length} other ISPs`} in ${countryName(c.country)} can reach the site. This points to filtering or routing at those ISPs rather than the site itself.${reason(failing[0].topFailure)}`,
        });
      } else {
        insights.push({
          severity: "warning",
          title: `Intermittent in ${countryName(c.country)}`,
          detail: `${c.down} of ${c.up + c.degraded + c.down} probes in ${countryName(c.country)} failed.${reason(c.topFailure)}`,
        });
      }
    }

    const scatteredDown = countries.filter((c) => c.status === "down" && !reachableElsewhere(c));
    if (scatteredDown.length > 0 && downCountries.length === 0) {
      insights.push({
        severity: "critical",
        title: "Down in most locations",
        detail: `Failing in ${scatteredDown.map((c) => countryName(c.country)).join(", ")}.${reason(topFailure(results))}`,
      });
    }
  }

  // Offsite redirects that only some countries get are a classic block-page pattern.
  const offsite = results.filter((r) => r.diagnosis === "redirect_offsite" && r.redirectLocation);
  const offsiteCountries = new Set(offsite.map((r) => r.probe.country));
  const direct = results.filter((r) => r.diagnosis === "ok" || r.diagnosis === "ok_redirect");
  if (offsite.length > 0 && direct.length > 0 && offsiteCountries.size < countries.length) {
    const hosts = new Set<string>();
    for (const r of offsite) {
      try {
        hosts.add(new URL(r.redirectLocation as string).hostname);
      } catch {
        // ignore malformed
      }
    }
    insights.push({
      severity: "warning",
      title: "Redirected elsewhere in some countries",
      detail: `Visitors in ${[...offsiteCountries].map(countryName).join(", ")} are redirected to ${[...hosts].join(", ") || "another site"} while other countries get the site directly. If you didn't set this up, it may be an ISP or government block page.`,
    });
  }

  // Much slower in some countries than the global median.
  const globalMedian = median(
    results.filter((r) => r.outcome !== "inconclusive" && r.timings.total !== null).map((r) => r.timings.total as number),
  );
  if (globalMedian !== null) {
    const slow = countries.filter((c) => c.medianTotalMs !== null && c.medianTotalMs > 3000 && c.medianTotalMs > globalMedian * 3);
    if (slow.length > 0) {
      insights.push({
        severity: "warning",
        title: `Slow in ${slow.map((c) => countryName(c.country)).join(", ")}`,
        detail: `Median load time there is ${slow.map((c) => `${((c.medianTotalMs as number) / 1000).toFixed(1)}s`).join(", ")} versus ${(globalMedian / 1000).toFixed(1)}s worldwide. Consider a CDN or a closer server.`,
      });
    }
  }

  if (tally.inconclusive > 0) {
    insights.push({
      severity: "info",
      title: `${probesPhrase(tally.inconclusive)} excluded`,
      detail: "Some probes had internal problems. Their results are shown but not counted.",
    });
  }

  return insights;
}
