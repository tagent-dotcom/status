import { createHash, randomUUID } from "node:crypto";
import { analyze, type Analysis } from "./analysis";
import type { Config } from "./config";
import type { Sql } from "./db/client";
import { classifyResult } from "./diagnosis";
import type { DiagnosisCode, FailedStage, NetworkType, Outcome, ProbeResult } from "./diagnosis-info";
import { AppError } from "./errors";
import { GlobalpingError, type GlobalpingClient } from "./globalping/client";
import type { GlobalpingMeasurement } from "./globalping/schema";
import {
  canonicalLocationKey,
  dedupeLocations,
  locationRequestSchema,
  planProbes,
  type LocationRequest,
} from "./locations";
import { consume, refund } from "./ratelimit";
import { checkDnsSafety } from "./ssrf";
import { parseTarget, type Target } from "./target";

export const PROBE_BUDGET_KEY = "globalping:probes";
// A measurement with a 15s per-test timeout normally finishes within ~30s. Past this, give up.
const PENDING_TIMEOUT_MS = 3 * 60_000;
// A check that never received a measurement id (its creator crashed mid-request).
const ORPHAN_TIMEOUT_MS = 30_000;
// At most one upstream poll per check per interval, however many people are watching it.
const POLL_INTERVAL_MS = 1_000;

export interface Deps {
  sql: Sql;
  config: Config;
  globalping: GlobalpingClient;
  /** Overridable for tests. */
  dnsSafety?: typeof checkDnsSafety;
}

export type CheckStatus = "pending" | "finished" | "failed";

export interface CheckView {
  id: string;
  hostname: string;
  targetUrl: string;
  status: CheckStatus;
  /** null for database-less quick checks, where the original request isn't kept. */
  locationRequest: LocationRequest | null;
  requestedProbes: number;
  probesCount: number | null;
  createdAt: string;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
  results: ProbeResult[];
  analysis: Analysis;
}

interface CheckRow {
  id: string;
  site_id: number;
  hostname: string;
  target_url: string;
  location_request: LocationRequest;
  provider_measurement_id: string | null;
  status: CheckStatus;
  error_code: string | null;
  error_message: string | null;
  requested_probes: number;
  probes_count: number | null;
  partial_results: ProbeResult[] | null;
  created_at: Date;
  finished_at: Date | null;
}

export interface CreateCheckInput {
  url: unknown;
  locations: unknown;
  clientHash: string;
}

export interface CreateCheckResult {
  checkId: string;
  hostname: string;
  reused: boolean;
}

function dedupeKey(target: Target, request: LocationRequest): string {
  return createHash("sha256").update(`${target.url}\n${canonicalLocationKey(request)}`).digest("hex");
}

export function upstreamToAppError(error: GlobalpingError): AppError {
  switch (error.kind) {
    case "rate_limited":
      return new AppError(
        "capacity",
        503,
        "The global probe network is at capacity right now. Please try again in a few minutes.",
        error.retryAfterSeconds ?? 60,
      );
    case "no_probes":
      return new AppError("no_probes", 422, "No probes are online in the locations you picked. Try a broader location, such as the whole country.");
    case "bad_request":
      return new AppError("invalid_locations", 400, `The probe network rejected this request: ${error.message}`);
    default:
      return new AppError("probe_network_error", 502, "We couldn't reach the global probe network. Please try again shortly.");
  }
}

/** Validates the user's URL and location request, throwing user-facing errors. */
export function parseCheckRequest(url: unknown, locations: unknown): { target: Target; request: LocationRequest } {
  if (typeof url !== "string") throw new AppError("invalid_target", 400, "Enter a website address.");
  const parsedTarget = parseTarget(url);
  if (!parsedTarget.ok) throw new AppError("invalid_target", 400, parsedTarget.message);

  const parsedLocations = locationRequestSchema.safeParse(locations ?? { mode: "worldwide" });
  if (!parsedLocations.success) {
    const first = parsedLocations.error.issues[0];
    throw new AppError("invalid_locations", 400, first ? first.message : "Invalid locations.");
  }
  return { target: parsedTarget.target, request: dedupeLocations(parsedLocations.data) };
}

/** Refuses hostnames that resolve to private addresses (SSRF defence). */
export async function assertSafeTarget(deps: Pick<Deps, "config" | "dnsSafety">, hostname: string): Promise<void> {
  if (deps.config.UNSAFE_SKIP_DNS_CHECK) return;
  const safety = await (deps.dnsSafety ?? checkDnsSafety)(hostname);
  if (!safety.ok) {
    throw new AppError("private_address", 400, "This domain points to a private network address and can't be checked.");
  }
}

export async function createCheck(deps: Deps, input: CreateCheckInput): Promise<CreateCheckResult> {
  const { sql, config, globalping } = deps;
  const { target, request } = parseCheckRequest(input.url, input.locations);

  const key = dedupeKey(target, request);
  const bucket = Math.floor(Date.now() / 1000 / config.CHECK_DEDUPE_SECONDS);

  // Someone just ran the identical check: share it. This is what keeps a popular site going
  // down (thousands of people checking at once) from costing thousands of measurements.
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM checks WHERE dedupe_key = ${key} AND dedupe_bucket = ${bucket}
  `;
  if (existing) return { checkId: existing.id, hostname: target.hostname, reused: true };

  // After the dedupe lookup: a reused check already passed this, and during a traffic spike we
  // must not do thousands of DNS lookups for requests that cost nothing.
  await assertSafeTarget(deps, target.hostname);

  const minute = await consume(sql, `client:${input.clientHash}:m`, 60, config.RATE_LIMIT_PER_MINUTE);
  if (!minute.allowed) {
    throw new AppError("rate_limited", 429, "You're running checks too quickly. Please wait a moment.", minute.retryAfterSeconds);
  }
  const hour = await consume(sql, `client:${input.clientHash}:h`, 3600, config.RATE_LIMIT_PER_HOUR);
  if (!hour.allowed) {
    await refund(sql, `client:${input.clientHash}:m`, minute.windowStart, 1);
    throw new AppError("rate_limited", 429, "You've reached the hourly limit for new checks. Please try again later.", hour.retryAfterSeconds);
  }

  const plan = planProbes(request, config.MAX_PROBES_PER_CHECK);
  const budget = await consume(sql, PROBE_BUDGET_KEY, 3600, config.GLOBALPING_HOURLY_PROBE_BUDGET, plan.requestedProbes);
  if (!budget.allowed) {
    throw new AppError(
      "capacity",
      503,
      "We've used this hour's measurement capacity. Recent results are still shown; please try a new check later.",
      budget.retryAfterSeconds,
    );
  }

  const [site] = await sql<{ id: number }[]>`
    INSERT INTO sites (hostname) VALUES (${target.hostname})
    ON CONFLICT (hostname) DO UPDATE SET hostname = EXCLUDED.hostname
    RETURNING id
  `;

  const checkId = randomUUID();
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO checks (id, site_id, target_url, location_request, requested_probes, dedupe_key, dedupe_bucket, requester_hash)
    VALUES (${checkId}, ${site.id}, ${target.url}, ${sql.json(request)}, ${plan.requestedProbes}, ${key}, ${bucket}, ${input.clientHash})
    ON CONFLICT (dedupe_key, dedupe_bucket) DO NOTHING
    RETURNING id
  `;
  if (inserted.length === 0) {
    // Lost a race with an identical concurrent request: use theirs and give the budget back.
    await refund(sql, PROBE_BUDGET_KEY, budget.windowStart, plan.requestedProbes);
    const [winner] = await sql<{ id: string }[]>`
      SELECT id FROM checks WHERE dedupe_key = ${key} AND dedupe_bucket = ${bucket}
    `;
    if (winner) return { checkId: winner.id, hostname: target.hostname, reused: true };
    throw new AppError("probe_network_error", 503, "Please try again.");
  }

  try {
    const created = await globalping.createHttpMeasurement({
      hostname: target.hostname,
      protocol: target.protocol === "https" ? "HTTPS" : "HTTP",
      path: target.path,
      query: target.query,
      locations: plan.locations,
    });
    await sql`
      UPDATE checks SET provider_measurement_id = ${created.id}, probes_count = ${created.probesCount}
      WHERE id = ${checkId}
    `;
    // Globalping may find fewer probes than requested; only pay for what ran.
    await refund(sql, PROBE_BUDGET_KEY, budget.windowStart, plan.requestedProbes - created.probesCount);
  } catch (error) {
    await refund(sql, PROBE_BUDGET_KEY, budget.windowStart, plan.requestedProbes);
    const appError = error instanceof GlobalpingError ? upstreamToAppError(error) : null;
    // Free the dedupe slot (NULL bucket) so a retry isn't stuck with this failure.
    await sql`
      UPDATE checks
      SET status = 'failed', finished_at = now(), dedupe_bucket = NULL,
          error_code = ${appError?.code ?? "internal"},
          error_message = ${appError?.message ?? "Unexpected error while starting the check."}
      WHERE id = ${checkId}
    `;
    throw appError ?? error;
  }

  return { checkId, hostname: target.hostname, reused: false };
}

const CHECK_COLUMNS = (sql: Sql) => sql`
  c.id, c.site_id, s.hostname, c.target_url, c.location_request, c.provider_measurement_id, c.status,
  c.error_code, c.error_message, c.requested_probes, c.probes_count, c.partial_results, c.created_at, c.finished_at
`;

async function loadCheck(sql: Sql, id: string): Promise<CheckRow | null> {
  const [row] = await sql<CheckRow[]>`
    SELECT ${CHECK_COLUMNS(sql)} FROM checks c JOIN sites s ON s.id = c.site_id WHERE c.id = ${id}
  `;
  return row ?? null;
}

async function failCheck(sql: Sql, id: string, code: string, message: string): Promise<void> {
  await sql`
    UPDATE checks
    SET status = 'failed', finished_at = now(), error_code = ${code}, error_message = ${message},
        dedupe_bucket = NULL, partial_results = NULL
    WHERE id = ${id} AND status = 'pending'
  `;
}

/** Classifies every finished test in a measurement of `targetUrl`. */
export function classifyMeasurement(measurement: GlobalpingMeasurement, targetUrl: string): ProbeResult[] {
  const url = new URL(targetUrl);
  const protocol = url.protocol === "http:" ? "http" : "https";
  return measurement.results
    .map((item) => classifyResult(item, url.hostname, protocol))
    .filter((r): r is ProbeResult => r !== null);
}

/**
 * Stores final results exactly once. The conditional UPDATE is the lock: concurrent pollers
 * that both saw "finished" race on it, and only the winner inserts rows.
 */
async function finalizeCheck(sql: Sql, row: CheckRow, measurement: GlobalpingMeasurement): Promise<void> {
  const results = classifyMeasurement(measurement, row.target_url);
  const finishedAt = new Date(measurement.updatedAt);
  const checkedAt = Number.isNaN(finishedAt.getTime()) ? new Date() : finishedAt;

  await sql.begin(async (tx) => {
    const won = await tx`
      UPDATE checks
      SET status = 'finished', finished_at = now(), probes_count = ${measurement.probesCount}, partial_results = NULL
      WHERE id = ${row.id} AND status = 'pending'
      RETURNING id
    `;
    if (won.length === 0) return;

    if (results.length > 0) {
      const rows = results.map((r) => ({
        check_id: row.id,
        site_id: row.site_id,
        checked_at: checkedAt,
        continent: r.probe.continent,
        region: r.probe.region,
        country: r.probe.country,
        state: r.probe.state,
        city: r.probe.city,
        asn: r.probe.asn,
        network: r.probe.network,
        latitude: r.probe.latitude,
        longitude: r.probe.longitude,
        network_type: r.probe.networkType,
        outcome: r.outcome,
        failed_stage: r.failedStage,
        diagnosis: r.diagnosis,
        status_code: r.statusCode,
        resolved_address: r.resolvedAddress,
        redirect_location: r.redirectLocation,
        timing_total: r.timings.total,
        timing_dns: r.timings.dns,
        timing_tcp: r.timings.tcp,
        timing_tls: r.timings.tls,
        timing_first_byte: r.timings.firstByte,
        timing_download: r.timings.download,
        tls_authorized: r.tls?.authorized ?? null,
        tls_error: r.tls?.error ?? null,
        tls_issuer: r.tls?.issuer ?? null,
        tls_expires_at: r.tls?.expiresAt ? new Date(r.tls.expiresAt) : null,
        tls_fingerprint: r.tls?.fingerprint ?? null,
        error_message: r.errorMessage,
      }));
      await tx`INSERT INTO check_results ${tx(rows)}`;
    }

    const reachable = results.some((r) => r.outcome === "up" || r.outcome === "degraded");
    await tx`
      UPDATE sites
      SET finished_checks = finished_checks + 1,
          last_checked_at = greatest(coalesce(last_checked_at, ${checkedAt}), ${checkedAt}),
          ever_reachable = ever_reachable OR ${reachable}
      WHERE id = ${row.site_id}
    `;
  });
}

interface ResultRow {
  continent: string;
  region: string;
  country: string;
  state: string | null;
  city: string;
  asn: number;
  network: string;
  latitude: number;
  longitude: number;
  network_type: NetworkType;
  outcome: Outcome;
  failed_stage: FailedStage | null;
  diagnosis: DiagnosisCode;
  status_code: number | null;
  resolved_address: string | null;
  redirect_location: string | null;
  timing_total: number | null;
  timing_dns: number | null;
  timing_tcp: number | null;
  timing_tls: number | null;
  timing_first_byte: number | null;
  timing_download: number | null;
  tls_authorized: boolean | null;
  tls_error: string | null;
  tls_issuer: string | null;
  tls_expires_at: Date | null;
  tls_fingerprint: string | null;
  error_message: string | null;
}

export function rowToProbeResult(r: ResultRow): ProbeResult {
  return {
    probe: {
      continent: r.continent,
      region: r.region,
      country: r.country,
      state: r.state,
      city: r.city,
      asn: r.asn,
      network: r.network,
      latitude: r.latitude,
      longitude: r.longitude,
      networkType: r.network_type,
    },
    outcome: r.outcome,
    failedStage: r.failed_stage,
    diagnosis: r.diagnosis,
    statusCode: r.status_code,
    resolvedAddress: r.resolved_address,
    redirectLocation: r.redirect_location,
    timings: {
      total: r.timing_total,
      dns: r.timing_dns,
      tcp: r.timing_tcp,
      tls: r.timing_tls,
      firstByte: r.timing_first_byte,
      download: r.timing_download,
    },
    tls:
      r.tls_authorized === null
        ? null
        : {
            authorized: r.tls_authorized,
            error: r.tls_error,
            issuer: r.tls_issuer,
            expiresAt: r.tls_expires_at ? r.tls_expires_at.toISOString() : null,
            fingerprint: r.tls_fingerprint,
          },
    errorMessage: r.error_message,
  };
}

async function loadResults(sql: Sql, checkId: string): Promise<ProbeResult[]> {
  const rows = await sql<ResultRow[]>`
    SELECT continent, region, country, state, city, asn, network, latitude, longitude, network_type,
           outcome, failed_stage, diagnosis, status_code, resolved_address, redirect_location,
           timing_total, timing_dns, timing_tcp, timing_tls, timing_first_byte, timing_download,
           tls_authorized, tls_error, tls_issuer, tls_expires_at, tls_fingerprint, error_message
    FROM check_results WHERE check_id = ${checkId}
    ORDER BY country, city, asn, id
  `;
  return rows.map(rowToProbeResult);
}

function toView(row: CheckRow, results: ProbeResult[]): CheckView {
  return {
    id: row.id,
    hostname: row.hostname,
    targetUrl: row.target_url,
    status: row.status,
    locationRequest: row.location_request,
    requestedProbes: row.requested_probes,
    probesCount: row.probes_count,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    error: row.status === "failed" ? { code: row.error_code ?? "internal", message: row.error_message ?? "The check failed." } : null,
    results,
    analysis: analyze(results),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the current state of a check, advancing it when needed: polls the provider
 * (throttled), stores results once finished, and expires checks that never complete.
 */
export async function getCheck(deps: Pick<Deps, "sql" | "globalping">, id: string): Promise<CheckView | null> {
  const { sql, globalping } = deps;
  if (!UUID.test(id)) return null;
  let row = await loadCheck(sql, id);
  if (!row) return null;

  if (row.status === "pending") {
    const age = Date.now() - row.created_at.getTime();
    if (!row.provider_measurement_id) {
      if (age > ORPHAN_TIMEOUT_MS) {
        await failCheck(sql, id, "orphaned", "The check could not be started. Please run it again.");
        row = (await loadCheck(sql, id)) ?? row;
      }
      return toView(row, []);
    }

    const claimed = await sql`
      UPDATE checks SET last_polled_at = now()
      WHERE id = ${id} AND status = 'pending'
        AND (last_polled_at IS NULL OR last_polled_at < now() - make_interval(secs => ${POLL_INTERVAL_MS / 1000}))
      RETURNING id
    `;
    if (claimed.length > 0) {
      try {
        const measurement = await globalping.getMeasurement(row.provider_measurement_id);
        if (measurement.status !== "in-progress") {
          await finalizeCheck(sql, row, measurement);
        } else if (age > PENDING_TIMEOUT_MS) {
          await failCheck(sql, id, "timeout", "The measurement took too long to finish. Please run it again.");
        } else {
          await sql`UPDATE checks SET partial_results = ${sql.json(classifyMeasurement(measurement, row.target_url) as never)} WHERE id = ${id} AND status = 'pending'`;
        }
      } catch (error) {
        if (error instanceof GlobalpingError && error.kind === "not_found") {
          await failCheck(sql, id, "not_found", "The measurement expired at the probe network. Please run it again.");
        } else if (age > PENDING_TIMEOUT_MS) {
          await failCheck(sql, id, "timeout", "The probe network didn't return results in time. Please run it again.");
        } else {
          // Transient (network, 429, 5xx): the next poll retries.
          console.warn(`Polling measurement for check ${id} failed`, error);
        }
      }
      row = (await loadCheck(sql, id)) ?? row;
    }
  }

  if (row.status === "finished") return toView(row, await loadResults(sql, id));
  if (row.status === "pending") return toView(row, row.partial_results ?? []);
  return toView(row, []);
}

/** The newest finished check for a site, if any. */
export async function getLatestFinishedCheck(sql: Sql, hostname: string): Promise<CheckView | null> {
  const [row] = await sql<CheckRow[]>`
    SELECT ${CHECK_COLUMNS(sql)}
    FROM checks c JOIN sites s ON s.id = c.site_id
    WHERE s.hostname = ${hostname} AND c.status = 'finished'
    ORDER BY c.created_at DESC
    LIMIT 1
  `;
  if (!row) return null;
  return toView(row, await loadResults(sql, row.id));
}
