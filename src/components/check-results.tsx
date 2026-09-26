"use client";

import { Fragment, useMemo, useState } from "react";
import type { Analysis, AreaStatus, InsightSeverity } from "@/lib/analysis";
import type { CheckView } from "@/lib/checks";
import { DIAGNOSES, STAGE_LABELS, type ProbeResult } from "@/lib/diagnosis-info";
import { formatMs } from "@/lib/format";
import { countryFlag, countryName } from "@/lib/geo/countries";
import { RelativeTime } from "./relative-time";
import { StatusBadge, StatusIcon } from "./status-badge";
import { WorldMap } from "./world-map";

const HEADLINE: Record<AreaStatus, string> = {
  up: "is up from everywhere we tested",
  degraded: "is up, with problems in some places",
  partial: "is down in some places",
  down: "is down from everywhere we tested",
  unknown: "couldn't be measured",
};

const SEVERITY_KIND: Record<InsightSeverity, AreaStatus> = { critical: "down", warning: "degraded", info: "unknown" };

function Verdict({ check }: { check: CheckView }) {
  const { analysis } = check;
  const conclusive = analysis.tally.up + analysis.tally.degraded + analysis.tally.down;
  const reached = analysis.tally.up + analysis.tally.degraded;
  return (
    <div className="flex flex-col gap-1">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-ink sm:text-2xl">
        <StatusIcon kind={analysis.status} size={24} />
        <span>
          {check.hostname} {HEADLINE[analysis.status]}
        </span>
      </h2>
      <p className="tabular text-sm text-ink-2">
        {reached} of {conclusive} probes in {analysis.countries.length} {analysis.countries.length === 1 ? "country" : "countries"} reached the site ·
        checked <RelativeTime iso={check.finishedAt ?? check.createdAt} />
      </p>
    </div>
  );
}

function Insights({ analysis }: { analysis: Analysis }) {
  if (analysis.insights.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="What we found">
      {analysis.insights.map((insight, i) => (
        <li key={i} className="flex gap-3 rounded-lg border border-line bg-surface p-3">
          <span className="mt-0.5">
            <StatusIcon kind={insight.severity === "info" && analysis.status === "up" ? "up" : SEVERITY_KIND[insight.severity]} />
          </span>
          <div>
            <p className="font-medium text-ink">{insight.title}</p>
            <p className="mt-0.5 text-sm text-ink-2">{insight.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const TIMING_SERIES = [
  { key: "DNS", field: "dns", color: "var(--series-1)" },
  { key: "Connect", field: "tcp", color: "var(--series-2)" },
  { key: "TLS", field: "tls", color: "var(--series-3)" },
  { key: "Wait", field: "firstByte", color: "var(--series-4)" },
  { key: "Download", field: "download", color: "var(--series-5)" },
] as const;

function TimingLegend() {
  return (
    <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs text-ink-2 md:flex">
      <span className="text-muted">Load time breakdown:</span>
      {TIMING_SERIES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} />
          {s.key}
        </span>
      ))}
    </p>
  );
}

function TimingBar({ r }: { r: ProbeResult }) {
  const t = r.timings;
  const total = t.total ?? 0;
  if (!total) return <span className="text-muted">–</span>;
  const segments = TIMING_SERIES.map((s) => ({ ...s, value: t[s.field] ?? 0 })).filter((s) => s.value > 0);
  const title = segments.map((s) => `${s.key} ${formatMs(s.value)}`).join(" · ");
  return (
    <span className="flex items-center gap-2" title={title}>
      <span className="tabular w-16 shrink-0 text-right text-ink">{formatMs(total)}</span>
      <span className="hidden h-2 w-24 gap-[2px] overflow-hidden rounded-sm md:flex" aria-hidden="true">
        {segments.map((s) => (
          <span key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </span>
    </span>
  );
}

function ProbeRow({ r }: { r: ProbeResult }) {
  const [open, setOpen] = useState(false);
  const info = DIAGNOSES[r.diagnosis];
  return (
    <>
      <tr className="border-t border-line align-top">
        <td className="py-2 pr-3">
          <div className="text-ink">
            {r.probe.city}
            {r.probe.state ? `, ${r.probe.state}` : ""}
          </div>
          <div className="text-xs text-muted">{r.probe.networkType === "eyeball" ? "Home/mobile ISP" : r.probe.networkType === "datacenter" ? "Data center" : "Network"}</div>
        </td>
        <td className="py-2 pr-3">
          <div className="text-ink">{r.probe.network}</div>
          <div className="tabular text-xs text-muted">AS{r.probe.asn}</div>
        </td>
        <td className="py-2 pr-3">
          <StatusBadge kind={r.outcome} label={info.label} />
          {r.failedStage && <div className="mt-0.5 text-xs text-muted">Failed at: {STAGE_LABELS[r.failedStage]}</div>}
        </td>
        <td className="tabular py-2 pr-3 text-ink-2">{r.statusCode ?? "–"}</td>
        <td className="py-2 pr-3">
          <TimingBar r={r} />
        </td>
        <td className="py-2 text-right">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-xs font-medium text-accent-ink hover:underline">
            {open ? "Hide" : "Details"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-2">
          <td colSpan={6} className="px-3 py-2 text-sm text-ink-2">
            <p>{info.explanation}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              {r.resolvedAddress && (
                <>
                  <dt className="text-muted">Resolved IP</dt>
                  <dd className="font-mono text-ink">{r.resolvedAddress}</dd>
                </>
              )}
              {r.redirectLocation && (
                <>
                  <dt className="text-muted">Redirects to</dt>
                  <dd className="break-all font-mono text-ink">{r.redirectLocation}</dd>
                </>
              )}
              {r.tls && (
                <>
                  <dt className="text-muted">Certificate</dt>
                  <dd className="text-ink">
                    {r.tls.authorized ? "Trusted" : `Not trusted${r.tls.error ? ` (${r.tls.error})` : ""}`}
                    {r.tls.issuer ? ` · issued by ${r.tls.issuer}` : ""}
                    {r.tls.expiresAt ? ` · expires ${r.tls.expiresAt.slice(0, 10)}` : ""}
                  </dd>
                </>
              )}
              {r.timings.total !== null && (
                <>
                  <dt className="text-muted">Timings</dt>
                  <dd className="tabular text-ink">
                    DNS {formatMs(r.timings.dns)} · connect {formatMs(r.timings.tcp)} · TLS {formatMs(r.timings.tls)} · first byte{" "}
                    {formatMs(r.timings.firstByte)} · download {formatMs(r.timings.download)}
                  </dd>
                </>
              )}
              {r.errorMessage && (
                <>
                  <dt className="text-muted">Raw error</dt>
                  <dd className="break-all font-mono text-ink">{r.errorMessage}</dd>
                </>
              )}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

function CountryTable({ check, focusCountry }: { check: CheckView; focusCountry: string | null }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const byCountry = useMemo(() => {
    const map = new Map<string, ProbeResult[]>();
    for (const r of check.results) {
      const list = map.get(r.probe.country) ?? [];
      list.push(r);
      map.set(r.probe.country, list);
    }
    return map;
  }, [check.results]);

  // Failing countries first, then alphabetical.
  const order: AreaStatus[] = ["down", "partial", "degraded", "unknown", "up"];
  const countries = [...check.analysis.countries].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || countryName(a.country).localeCompare(countryName(b.country)),
  );

  const isOpen = (c: string) => expanded.has(c) || c === focusCountry;
  const toggle = (c: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Results by country and probe</caption>
        <thead className="text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Location</th>
            <th className="py-2 pr-3 font-medium">ISP</th>
            <th className="py-2 pr-3 font-medium">Result</th>
            <th className="py-2 pr-3 font-medium">HTTP</th>
            <th className="py-2 pr-3 font-medium">Load time</th>
            <th className="py-2 pr-3" />
          </tr>
        </thead>
        <tbody>
          {countries.map((c) => {
            const conclusive = c.up + c.degraded + c.down;
            return (
              <Fragment key={c.country}>
                <tr id={`country-${c.country}`} className="border-t border-line bg-surface-2/60">
                  <td colSpan={6} className="px-3 py-2">
                    <button type="button" onClick={() => toggle(c.country)} aria-expanded={isOpen(c.country)} className="flex w-full items-center gap-3 text-left">
                      <span aria-hidden="true">{countryFlag(c.country)}</span>
                      <span className="font-medium text-ink">{countryName(c.country)}</span>
                      <StatusBadge kind={c.status} />
                      <span className="tabular text-xs text-ink-2">
                        {c.up + c.degraded}/{conclusive} reached
                        {c.topFailure && c.status !== "up" ? ` · mostly ${DIAGNOSES[c.topFailure].label}` : ""}
                      </span>
                      <span className="ml-auto text-xs text-muted">{isOpen(c.country) ? "▾" : "▸"} {c.total} probes</span>
                    </button>
                  </td>
                </tr>
                {isOpen(c.country) && (byCountry.get(c.country) ?? []).map((r, i) => <ProbeRow key={i} r={r} />)}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <TimingLegend />
    </div>
  );
}

export function CheckResults({ check }: { check: CheckView }) {
  const [focusCountry, setFocusCountry] = useState<string | null>(null);
  const probes = useMemo(
    () =>
      check.results.map((r) => ({
        latitude: r.probe.latitude,
        longitude: r.probe.longitude,
        status: (r.outcome === "inconclusive" ? "unknown" : r.outcome) as AreaStatus,
        label: `${r.probe.city}, ${countryName(r.probe.country)} · ${r.probe.network}: ${DIAGNOSES[r.diagnosis].label}`,
      })),
    [check.results],
  );

  return (
    <section className="space-y-5" aria-live="polite">
      <Verdict check={check} />
      <Insights analysis={check.analysis} />
      <div className="rounded-lg border border-line bg-surface p-3">
        <WorldMap
          countries={check.analysis.countries}
          probes={probes}
          onSelectCountry={(code) => {
            setFocusCountry(code);
            document.getElementById(`country-${code}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
      </div>
      <CountryTable check={check} focusCountry={focusCountry} />
    </section>
  );
}
