"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { statusOf } from "@/lib/analysis";
import { ApiError, fetchHistory, type HistoryFilters } from "@/lib/api-client";
import { DIAGNOSES, STAGE_LABELS } from "@/lib/diagnosis-info";
import { formatDateTime, formatMs, formatNumber, formatPercent } from "@/lib/format";
import { countryFlag, countryName } from "@/lib/geo/countries";
import type { HistoryResult } from "@/lib/history";
import { StatusBadge } from "./status-badge";
import { TimelineChart } from "./timeline-chart";

const RANGES = [
  { key: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { key: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { key: "30d", label: "Last 30 days", ms: 30 * 86_400_000 },
  { key: "90d", label: "Last 90 days", ms: 90 * 86_400_000 },
] as const;

const selectClass = "h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink";

function readFilters(params: URLSearchParams) {
  return {
    range: params.get("range") ?? "7d",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    country: params.get("country") ?? "",
    city: params.get("city") ?? "",
    asn: params.get("asn") ?? "",
    networkType: params.get("networkType") ?? "",
  };
}

type Filters = ReturnType<typeof readFilters>;

function toQuery(f: Filters): HistoryFilters {
  if (f.range === "custom" && f.from && f.to) {
    // Custom dates are whole UTC days, inclusive of the end day.
    const to = new Date(`${f.to}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 1);
    return { from: `${f.from}T00:00:00Z`, to: to.toISOString(), country: f.country, city: f.city, asn: f.asn, networkType: f.networkType };
  }
  const range = RANGES.find((r) => r.key === f.range) ?? RANGES[1];
  // Round to the minute so repeated loads hit the HTTP cache.
  const now = Math.floor(Date.now() / 60_000) * 60_000 + 60_000;
  return {
    from: new Date(now - range.ms).toISOString(),
    to: new Date(now).toISOString(),
    country: f.country,
    city: f.city,
    asn: f.asn,
    networkType: f.networkType,
  };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function AvailabilityCell({ up, degraded, down }: { up: number; degraded: number; down: number }) {
  const conclusive = up + degraded + down;
  return (
    <span className="flex items-center gap-2">
      <StatusBadge kind={statusOf({ up, degraded, down })} label={formatPercent(conclusive ? (up + degraded) / conclusive : null)} />
    </span>
  );
}

export function HistoryPanel({ hostname, refreshKey }: { hostname: string; refreshKey: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  // Each response is tagged with the request it answers; "loading" is derived by comparing
  // tags, so the effect never sets state synchronously. The last good data stays on screen
  // (dimmed) while a new request is in flight.
  const requestKey = `${hostname}|${searchParams.toString()}|${refreshKey}`;
  const [response, setResponse] = useState<{ key: string; data: HistoryResult | null; error: string | null } | null>(null);
  const [lastData, setLastData] = useState<HistoryResult | null>(null);
  const loading = response?.key !== requestKey;
  const data = loading ? lastData : (response?.data ?? null);
  const error = loading ? null : (response?.error ?? null);

  useEffect(() => {
    const controller = new AbortController();
    fetchHistory(hostname, toQuery(filters), refreshKey, controller.signal)
      .then((d) => {
        setResponse({ key: requestKey, data: d, error: null });
        setLastData(d);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        // Site not checked yet (404): an empty state, not an error.
        const message = e instanceof ApiError && e.status === 404 ? null : e instanceof Error ? e.message : "Couldn't load history.";
        setResponse({ key: requestKey, data: null, error: message });
        if (message === null) setLastData(null);
      });
    return () => controller.abort();
  }, [hostname, filters, refreshKey, requestKey]);

  function setFilter(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    // Narrower filters depend on broader ones.
    if (patch.country !== undefined && patch.country !== filters.country) {
      next.city = "";
      next.asn = "";
    }
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v && !(k === "range" && v === "7d")) params.set(k, v);
      else params.delete(k);
    }
    if (next.range !== "custom") {
      params.delete("from");
      params.delete("to");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const options = data?.options;
  const cityOptions = options?.cities.filter((c) => !filters.country || c.country === filters.country) ?? [];
  const networkOptions = options?.networks.filter((n) => !filters.country || n.country === filters.country) ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="space-y-4" aria-labelledby="history-heading">
      <h2 id="history-heading" className="text-lg font-semibold text-ink">
        History
      </h2>

      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="History filters">
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Period
          <select className={selectClass} value={filters.range} onChange={(e) => setFilter({ range: e.target.value })}>
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
            <option value="custom">Custom dates…</option>
          </select>
        </label>
        {filters.range === "custom" && (
          <>
            <label className="flex flex-col gap-1 text-xs text-ink-2">
              From
              <input type="date" className={selectClass} max={filters.to || today} value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-2">
              To
              <input type="date" className={selectClass} min={filters.from} max={today} value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Country
          <select className={selectClass} value={filters.country} onChange={(e) => setFilter({ country: e.target.value })}>
            <option value="">All countries</option>
            {(options?.countries ?? (filters.country ? [filters.country] : [])).map((c) => (
              <option key={c} value={c}>
                {countryFlag(c)} {countryName(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          City
          <select className={selectClass} value={filters.city} disabled={!filters.country} onChange={(e) => setFilter({ city: e.target.value })}>
            <option value="">{filters.country ? "All cities" : "Pick a country first"}</option>
            {cityOptions.map((c) => (
              <option key={`${c.country}-${c.city}`} value={c.city}>
                {c.city}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          ISP
          <select className={`${selectClass} max-w-56`} value={filters.asn} onChange={(e) => setFilter({ asn: e.target.value })}>
            <option value="">All ISPs</option>
            {networkOptions.map((n) => (
              <option key={`${n.country}-${n.asn}`} value={String(n.asn)}>
                {n.network} (AS{n.asn}){filters.country ? "" : ` · ${n.country}`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Network type
          <select className={selectClass} value={filters.networkType} onChange={(e) => setFilter({ networkType: e.target.value })}>
            <option value="">All</option>
            <option value="eyeball">Home &amp; mobile</option>
            <option value="datacenter">Data center</option>
          </select>
        </label>
        {(filters.country || filters.asn || filters.networkType || filters.range !== "7d") && (
          <button
            type="button"
            className="h-9 rounded-md px-2 text-sm text-accent-ink hover:underline"
            onClick={() => router.replace(pathname, { scroll: false })}
          >
            Reset
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-critical-text">
          {error}
        </p>
      )}

      {!data && loading && <p className="text-sm text-muted">Loading history…</p>}
      {!data && !loading && !error && (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">No history yet. Every check you run is added here.</p>
      )}

      {data && (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-50" : ""}`} aria-busy={loading}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Availability" value={formatPercent(data.totals.availability)} sub="Share of probes that reached the site" />
            <Stat label="Checks" value={formatNumber(data.totals.checks)} />
            <Stat label="Probe results" value={formatNumber(data.totals.total)} sub={`${formatNumber(data.totals.inconclusive)} inconclusive, not counted`} />
            <Stat label="Failed results" value={formatNumber(data.totals.down)} sub={`${formatNumber(data.totals.degraded)} degraded`} />
          </div>

          {data.totals.total === 0 ? (
            <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
              No results for these filters and dates. Run a check above, or widen the filters.
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-line bg-surface p-3">
                <TimelineChart buckets={data.timeline} unit={data.bucket} from={data.from} to={data.to} />
              </div>

              {data.failures.length > 0 && (
                <div className="rounded-lg border border-line bg-surface p-3">
                  <h3 className="text-sm font-semibold text-ink">Why it failed</h3>
                  <ul className="mt-2 space-y-1.5">
                    {data.failures.map((f) => (
                      <li key={`${f.diagnosis}-${f.failedStage}`} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-ink">
                          {DIAGNOSES[f.diagnosis]?.label ?? f.diagnosis}
                          {f.failedStage && <span className="text-muted"> · {STAGE_LABELS[f.failedStage]}</span>}
                        </span>
                        <span className="tabular text-ink-2">{formatNumber(f.count)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <BreakdownTable
                  title="By country"
                  head={["Country", "Availability", "Results", "Median load"]}
                  rows={data.countries
                    .slice()
                    .sort((a, b) => (a.availability ?? 2) - (b.availability ?? 2))
                    .map((c) => ({
                      key: c.country,
                      cells: [
                        <button key="c" type="button" className="text-left text-ink hover:underline" onClick={() => setFilter({ country: c.country })}>
                          {countryFlag(c.country)} {countryName(c.country)}
                        </button>,
                        <AvailabilityCell key="a" {...c} />,
                        <span key="r" className="tabular">{formatNumber(c.total)}</span>,
                        <span key="m" className="tabular">{formatMs(c.medianTotalMs)}</span>,
                      ],
                    }))}
                />
                <BreakdownTable
                  title="By ISP"
                  head={["ISP", "Availability", "Results"]}
                  rows={data.networks.map((n) => ({
                    key: `${n.country}-${n.asn}`,
                    cells: [
                      <button
                        key="n"
                        type="button"
                        className="text-left text-ink hover:underline"
                        onClick={() => setFilter({ country: n.country, asn: String(n.asn), city: "" })}
                      >
                        {n.network} <span className="text-muted">AS{n.asn} · {n.country}</span>
                      </button>,
                      <AvailabilityCell key="a" {...n} />,
                      <span key="r" className="tabular">{formatNumber(n.total)}</span>,
                    ],
                  }))}
                />
                <BreakdownTable
                  title="By city"
                  head={["City", "Availability", "Results"]}
                  rows={data.cities.map((c) => ({
                    key: `${c.country}-${c.city}`,
                    cells: [
                      <button
                        key="c"
                        type="button"
                        className="text-left text-ink hover:underline"
                        onClick={() => setFilter({ country: c.country, city: c.city })}
                      >
                        {c.city} <span className="text-muted">{countryName(c.country)}</span>
                      </button>,
                      <AvailabilityCell key="a" {...c} />,
                      <span key="r" className="tabular">{formatNumber(c.total)}</span>,
                    ],
                  }))}
                />
                <BreakdownTable
                  title="Latest results"
                  head={["When", "Where", "Result"]}
                  rows={data.recent.slice(0, 25).map((r, i) => ({
                    key: `${r.checkId}-${i}`,
                    cells: [
                      <span key="t" className="tabular whitespace-nowrap text-ink-2">{formatDateTime(r.checkedAt).replace(/, \d{4}/, "")}</span>,
                      <span key="w" className="text-ink">
                        {r.probe.city}, {r.probe.country} <span className="text-muted">· {r.probe.network}</span>
                      </span>,
                      <StatusBadge key="s" kind={r.outcome} label={DIAGNOSES[r.diagnosis]?.label} />,
                    ],
                  }))}
                />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function BreakdownTable({ title, head, rows }: { title: string; head: string[]; rows: Array<{ key: string; cells: React.ReactNode[] }> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <h3 className="px-3 pt-3 text-sm font-semibold text-ink">{title}</h3>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface text-xs text-muted">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line">
                {r.cells.map((c, i) => (
                  <td key={i} className="px-3 py-2 align-top">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
