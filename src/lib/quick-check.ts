import { createHash } from "node:crypto";
import { analyze } from "./analysis";
import { assertSafeTarget, classifyMeasurement, parseCheckRequest, upstreamToAppError, type CheckView, type Deps } from "./checks";
import { AppError } from "./errors";
import { GlobalpingError, type GlobalpingClient } from "./globalping/client";
import type { GlobalpingMeasurement } from "./globalping/schema";
import { canonicalLocationKey, planProbes } from "./locations";
import { MemoryLimiter, RecentChecks } from "./memory-limiter";

// Database-less mode: checks go straight to the probe network and results are read back from
// it. The Globalping measurement id is the check id, so result links are shareable for as long
// as Globalping keeps the measurement. Nothing is stored on our side.

const limiter = new MemoryLimiter();
const recent = new RecentChecks();

export type QuickDeps = Pick<Deps, "config" | "globalping" | "dnsSafety">;

export interface QuickCheckInput {
  url: unknown;
  locations: unknown;
  /** Rate-limit identity (client IP, or null when unknown). Kept in memory only. */
  clientKey: string | null;
}

export async function createQuickCheck(
  deps: QuickDeps,
  input: QuickCheckInput,
  state: { limiter: MemoryLimiter; recent: RecentChecks } = { limiter, recent },
): Promise<{ checkId: string; hostname: string; reused: boolean }> {
  const { config, globalping } = deps;
  const { target, request } = parseCheckRequest(input.url, input.locations);

  const key = createHash("sha256").update(`${target.url}\n${canonicalLocationKey(request)}`).digest("hex");
  const existing = state.recent.get(key);
  if (existing) return { checkId: existing, hostname: target.hostname, reused: true };

  await assertSafeTarget(deps, target.hostname);

  const client = input.clientKey ?? "unknown";
  const waitMinute = state.limiter.hit(`m:${client}`, 60, config.RATE_LIMIT_PER_MINUTE);
  if (waitMinute) throw new AppError("rate_limited", 429, "You're running checks too quickly. Please wait a moment.", waitMinute);
  const waitHour = state.limiter.hit(`h:${client}`, 3600, config.RATE_LIMIT_PER_HOUR);
  if (waitHour) throw new AppError("rate_limited", 429, "You've reached the hourly limit for new checks. Please try again later.", waitHour);

  const plan = planProbes(request, config.MAX_PROBES_PER_CHECK);
  try {
    const created = await globalping.createHttpMeasurement({
      hostname: target.hostname,
      protocol: target.protocol === "https" ? "HTTPS" : "HTTP",
      path: target.path,
      query: target.query,
      locations: plan.locations,
    });
    state.recent.set(key, created.id, config.CHECK_DEDUPE_SECONDS);
    return { checkId: created.id, hostname: target.hostname, reused: false };
  } catch (error) {
    if (error instanceof GlobalpingError) throw upstreamToAppError(error);
    throw error;
  }
}

/** Rebuilds the checked URL from what the probe network echoes back. */
export function measurementTargetUrl(m: GlobalpingMeasurement): string {
  const protocol = m.measurementOptions?.protocol?.toUpperCase() === "HTTP" ? "http" : "https";
  const path = m.measurementOptions?.request?.path || "/";
  const query = m.measurementOptions?.request?.query;
  return `${protocol}://${m.target.toLowerCase()}${path.startsWith("/") ? path : `/${path}`}${query ? `?${query}` : ""}`;
}

function isoOrNow(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

const MEASUREMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function getQuickCheck(globalping: GlobalpingClient, id: string): Promise<CheckView | null> {
  if (!MEASUREMENT_ID.test(id)) return null;
  let measurement: GlobalpingMeasurement;
  try {
    measurement = await globalping.getMeasurement(id);
  } catch (error) {
    if (error instanceof GlobalpingError && (error.kind === "not_found" || error.kind === "bad_request")) return null;
    if (error instanceof GlobalpingError) throw upstreamToAppError(error);
    throw error;
  }
  // Only HTTP measurements are ours to show.
  if (measurement.type !== "http") return null;

  const targetUrl = measurementTargetUrl(measurement);
  const results = classifyMeasurement(measurement, targetUrl);
  const finished = measurement.status !== "in-progress";
  return {
    id: measurement.id,
    hostname: new URL(targetUrl).hostname,
    targetUrl,
    status: finished ? "finished" : "pending",
    locationRequest: null,
    requestedProbes: measurement.probesCount,
    probesCount: measurement.probesCount,
    createdAt: isoOrNow(measurement.createdAt),
    finishedAt: finished ? isoOrNow(measurement.updatedAt) : null,
    error: null,
    results,
    analysis: analyze(results),
  };
}
