import { z } from "zod";
import { statusOf, type AreaStatus } from "./analysis";
import { rowToProbeResult } from "./checks";
import type { Sql } from "./db/client";
import type { DiagnosisCode, FailedStage, ProbeResult } from "./diagnosis-info";
import { NETWORK_TYPES } from "./locations";

export const MAX_RANGE_DAYS = 90;
const DAY_MS = 86_400_000;

export const historyQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    country: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2}$/))
      .optional(),
    city: z.string().trim().min(1).max(64).optional(),
    asn: z.coerce.number().int().min(1).max(4_294_967_295).optional(),
    networkType: z.enum(NETWORK_TYPES).optional(),
  })
  .transform((q, ctx) => {
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getTime() - 7 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    if (from >= to) {
      ctx.addIssue({ code: "custom", message: "The start date must be before the end date" });
      return z.NEVER;
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      ctx.addIssue({ code: "custom", message: `Choose a range of at most ${MAX_RANGE_DAYS} days` });
      return z.NEVER;
    }
    if (q.city && !q.country) {
      ctx.addIssue({ code: "custom", message: "Choose a country for the city" });
      return z.NEVER;
    }
    return { ...q, from, to, networkType: q.networkType === "any" ? undefined : q.networkType };
  });

export type HistoryQuery = z.output<typeof historyQuerySchema>;
export type BucketUnit = "hour" | "day" | "week";

export interface Counts {
  total: number;
  up: number;
  degraded: number;
  down: number;
  inconclusive: number;
}

export interface TimelineBucket extends Counts {
  start: string;
}

export interface HistoryCountry extends Counts {
  country: string;
  status: AreaStatus;
  availability: number | null;
  medianTotalMs: number | null;
}

export interface HistoryNetwork extends Counts {
  country: string;
  asn: number;
  network: string;
  status: AreaStatus;
  availability: number | null;
}

export interface HistoryCity extends Counts {
  country: string;
  city: string;
  status: AreaStatus;
  availability: number | null;
}

export interface HistoryFailure {
  diagnosis: DiagnosisCode;
  failedStage: FailedStage | null;
  count: number;
}

export interface HistoryResult {
  hostname: string;
  from: string;
  to: string;
  bucket: BucketUnit;
  totals: Counts & { availability: number | null; checks: number };
  timeline: TimelineBucket[];
  countries: HistoryCountry[];
  networks: HistoryNetwork[];
  cities: HistoryCity[];
  failures: HistoryFailure[];
  recent: Array<ProbeResult & { checkedAt: string; checkId: string }>;
  options: {
    countries: string[];
    cities: Array<{ country: string; city: string }>;
    networks: Array<{ country: string; asn: number; network: string }>;
  };
}

export function bucketFor(from: Date, to: Date): BucketUnit {
  const span = to.getTime() - from.getTime();
  if (span <= 2 * DAY_MS) return "hour";
  if (span <= 60 * DAY_MS) return "day";
  return "week";
}

/** Share of conclusive probe results that reached the site, 0..1. Inconclusive never counts. */
export function availability(c: Pick<Counts, "up" | "degraded" | "down">): number | null {
  const conclusive = c.up + c.degraded + c.down;
  return conclusive === 0 ? null : (c.up + c.degraded) / conclusive;
}

const COUNT_COLUMNS = (sql: Sql) => sql`
  count(*)::int AS total,
  count(*) FILTER (WHERE outcome = 'up')::int AS up,
  count(*) FILTER (WHERE outcome = 'degraded')::int AS degraded,
  count(*) FILTER (WHERE outcome = 'down')::int AS down,
  count(*) FILTER (WHERE outcome = 'inconclusive')::int AS inconclusive
`;

export async function getHistory(sql: Sql, hostname: string, q: HistoryQuery): Promise<HistoryResult | null> {
  const [site] = await sql<{ id: number }[]>`SELECT id FROM sites WHERE hostname = ${hostname}`;
  if (!site) return null;

  const bucket = bucketFor(q.from, q.to);
  const where = sql`
    site_id = ${site.id}
    AND checked_at >= ${q.from} AND checked_at < ${q.to}
    ${q.country ? sql`AND country = ${q.country}` : sql``}
    ${q.city ? sql`AND lower(city) = lower(${q.city})` : sql``}
    ${q.asn ? sql`AND asn = ${q.asn}` : sql``}
    ${q.networkType ? sql`AND network_type = ${q.networkType}` : sql``}
  `;
  // Options ignore the filters so every dropdown keeps showing what exists for the period.
  const optionsWhere = sql`site_id = ${site.id} AND checked_at >= ${q.from} AND checked_at < ${q.to}`;

  const [totals, timeline, countries, networks, cities, failures, recent, optCountries, optCities, optNetworks] = await Promise.all([
    sql<(Counts & { checks: number })[]>`
      SELECT ${COUNT_COLUMNS(sql)}, count(DISTINCT check_id)::int AS checks FROM check_results WHERE ${where}
    `,
    sql<(Counts & { start: Date })[]>`
      SELECT date_trunc(${bucket}, checked_at, 'UTC') AS start, ${COUNT_COLUMNS(sql)}
      FROM check_results WHERE ${where}
      GROUP BY 1 ORDER BY 1
    `,
    sql<(Counts & { country: string; median_total: number | null })[]>`
      SELECT country, ${COUNT_COLUMNS(sql)},
             percentile_cont(0.5) WITHIN GROUP (ORDER BY timing_total)
               FILTER (WHERE outcome IN ('up', 'degraded') AND timing_total IS NOT NULL) AS median_total
      FROM check_results WHERE ${where}
      GROUP BY country
    `,
    sql<(Counts & { country: string; asn: number; network: string })[]>`
      SELECT country, asn, max(network) AS network, ${COUNT_COLUMNS(sql)}
      FROM check_results WHERE ${where}
      GROUP BY country, asn
      ORDER BY count(*) FILTER (WHERE outcome = 'down') DESC, count(*) DESC
      LIMIT 100
    `,
    sql<(Counts & { country: string; city: string })[]>`
      SELECT country, city, ${COUNT_COLUMNS(sql)}
      FROM check_results WHERE ${where}
      GROUP BY country, city
      ORDER BY count(*) FILTER (WHERE outcome = 'down') DESC, count(*) DESC
      LIMIT 100
    `,
    sql<{ diagnosis: DiagnosisCode; failed_stage: FailedStage | null; count: number }[]>`
      SELECT diagnosis, failed_stage, count(*)::int AS count
      FROM check_results WHERE ${where} AND outcome IN ('down', 'degraded')
      GROUP BY diagnosis, failed_stage
      ORDER BY count DESC
      LIMIT 20
    `,
    sql`
      SELECT check_id, checked_at, continent, region, country, state, city, asn, network, latitude, longitude, network_type,
             outcome, failed_stage, diagnosis, status_code, resolved_address, redirect_location,
             timing_total, timing_dns, timing_tcp, timing_tls, timing_first_byte, timing_download,
             tls_authorized, tls_error, tls_issuer, tls_expires_at, tls_fingerprint, error_message
      FROM check_results WHERE ${where}
      ORDER BY checked_at DESC, id DESC
      LIMIT 100
    `,
    sql<{ country: string }[]>`
      SELECT DISTINCT country FROM check_results WHERE ${optionsWhere} ORDER BY country
    `,
    sql<{ country: string; city: string }[]>`
      SELECT DISTINCT country, city FROM check_results WHERE ${optionsWhere} ORDER BY country, city LIMIT 500
    `,
    sql<{ country: string; asn: number; network: string }[]>`
      SELECT country, asn, max(network) AS network FROM check_results WHERE ${optionsWhere}
      GROUP BY country, asn ORDER BY country, max(network) LIMIT 500
    `,
  ]);

  const t = totals[0];
  return {
    hostname,
    from: q.from.toISOString(),
    to: q.to.toISOString(),
    bucket,
    totals: { ...t, availability: availability(t) },
    timeline: timeline.map((b) => ({ ...b, start: b.start.toISOString() })),
    countries: countries.map(({ median_total, ...c }) => ({
      ...c,
      status: statusOf(c),
      availability: availability(c),
      medianTotalMs: median_total === null ? null : Math.round(median_total),
    })),
    networks: networks.map((n) => ({ ...n, status: statusOf(n), availability: availability(n) })),
    cities: cities.map((c) => ({ ...c, status: statusOf(c), availability: availability(c) })),
    failures: failures.map((f) => ({ diagnosis: f.diagnosis, failedStage: f.failed_stage, count: f.count })),
    recent: recent.map((r) => ({
      ...rowToProbeResult(r as unknown as Parameters<typeof rowToProbeResult>[0]),
      checkedAt: (r.checked_at as Date).toISOString(),
      checkId: r.check_id as string,
    })),
    options: { countries: optCountries.map((c) => c.country), cities: optCities, networks: optNetworks },
  };
}

export interface SiteSummary {
  hostname: string;
  createdAt: string;
  lastCheckedAt: string | null;
  finishedChecks: number;
  everReachable: boolean;
}

export async function getSiteSummary(sql: Sql, hostname: string): Promise<SiteSummary | null> {
  const [row] = await sql<{ hostname: string; created_at: Date; last_checked_at: Date | null; finished_checks: number; ever_reachable: boolean }[]>`
    SELECT hostname, created_at, last_checked_at, finished_checks, ever_reachable FROM sites WHERE hostname = ${hostname}
  `;
  if (!row) return null;
  return {
    hostname: row.hostname,
    createdAt: row.created_at.toISOString(),
    lastCheckedAt: row.last_checked_at ? row.last_checked_at.toISOString() : null,
    finishedChecks: row.finished_checks,
    everReachable: row.ever_reachable,
  };
}

/** Sites worth indexing: proven reachable at least once and checked more than once. */
export const INDEXABLE_MIN_CHECKS = 2;

export function isIndexable(site: SiteSummary): boolean {
  return site.everReachable && site.finishedChecks >= INDEXABLE_MIN_CHECKS;
}

/** Stable order (by id) so sitemap pages don't shift as sites get re-checked. */
export async function listIndexableSites(sql: Sql, offset: number, limit: number): Promise<Array<{ hostname: string; lastCheckedAt: Date }>> {
  const rows = await sql<{ hostname: string; last_checked_at: Date }[]>`
    SELECT hostname, last_checked_at FROM sites
    WHERE ever_reachable AND finished_checks >= ${INDEXABLE_MIN_CHECKS} AND last_checked_at IS NOT NULL
    ORDER BY id
    OFFSET ${offset} LIMIT ${limit}
  `;
  return rows.map((r) => ({ hostname: r.hostname, lastCheckedAt: r.last_checked_at }));
}

export async function countIndexableSites(sql: Sql): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM sites WHERE ever_reachable AND finished_checks >= ${INDEXABLE_MIN_CHECKS} AND last_checked_at IS NOT NULL
  `;
  return row.n;
}

/** Most recently checked sites that are proven reachable, for internal links on the home page. */
export async function listRecentlyCheckedSites(sql: Sql, limit: number): Promise<Array<{ hostname: string }>> {
  return sql<{ hostname: string }[]>`
    SELECT hostname FROM sites
    WHERE ever_reachable AND last_checked_at IS NOT NULL
    ORDER BY last_checked_at DESC
    LIMIT ${limit}
  `;
}
