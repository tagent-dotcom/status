"use client";

import { useMemo, useRef, useState } from "react";
import type { BucketUnit, TimelineBucket } from "@/lib/history";
import { formatBucket, formatNumber, formatPercent } from "@/lib/format";

const W = 720;
const H = 200;
const M = { top: 12, right: 8, bottom: 26, left: 40 };
const SERIES = [
  { key: "down", label: "Down", color: "var(--critical)" },
  { key: "degraded", label: "Degraded", color: "var(--warning)" },
  { key: "up", label: "Up", color: "var(--good)" },
] as const;

/** Bucket start times covering [from, to), matching Postgres date_trunc(unit, ts, 'UTC'). */
export function bucketStarts(fromIso: string, toIso: string, unit: BucketUnit): number[] {
  const d = new Date(fromIso);
  if (unit === "hour") d.setUTCMinutes(0, 0, 0);
  else {
    d.setUTCHours(0, 0, 0, 0);
    if (unit === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // ISO weeks start Monday
  }
  const step = unit === "hour" ? 3_600_000 : unit === "day" ? 86_400_000 : 7 * 86_400_000;
  const end = new Date(toIso).getTime();
  const out: number[] = [];
  for (let t = d.getTime(); t < end && out.length < 500; t += step) out.push(t);
  return out;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function TimelineChart({ buckets, unit, from, to }: { buckets: TimelineBucket[]; unit: BucketUnit; from: string; to: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  const slots = useMemo(() => {
    const byStart = new Map(buckets.map((b) => [new Date(b.start).getTime(), b]));
    return bucketStarts(from, to, unit).map((t) => ({ t, b: byStart.get(t) ?? null }));
  }, [buckets, unit, from, to]);

  const maxTotal = niceMax(Math.max(0, ...buckets.map((b) => b.up + b.degraded + b.down)));
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const slotW = innerW / Math.max(1, slots.length);
  const barW = Math.max(2, Math.min(24, slotW * 0.7));
  const y = (v: number) => (v / maxTotal) * innerH;
  const ticks = [0, maxTotal / 2, maxTotal];
  const labelEvery = Math.max(1, Math.ceil(slots.length / 6));

  const hovered = hover !== null ? slots[hover] : null;

  return (
    <figure className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2" aria-hidden="true">
        {[...SERIES].reverse().map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="text-muted">Probe results per {unit}</span>
      </div>
      {/* Keep axis text legible on phones: scroll inside the card rather than shrink. */}
      <div className="overflow-x-auto">
      <div ref={wrapper} className="relative min-w-[560px]" onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Probe results per ${unit}: up, degraded and down`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={M.top + innerH - y(t)} y2={M.top + innerH - y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
              <text x={M.left - 6} y={M.top + innerH - y(t)} dy="0.32em" textAnchor="end" className="tabular" fontSize={11} fill="var(--muted)">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          {slots.map(({ t, b }, i) => {
            const cx = M.left + slotW * i + slotW / 2;
            const x = cx - barW / 2;
            let base = M.top + innerH;
            const segs = b ? SERIES.map((s) => ({ ...s, v: b[s.key] })).filter((s) => s.v > 0) : [];
            return (
              <g key={t}>
                {segs.map((s, j) => {
                  const h = Math.max(1, y(s.v) - (j > 0 ? 2 : 0));
                  const top = base - h;
                  const el =
                    j === segs.length - 1 ? (
                      <path key={s.key} d={topRounded(x, top, barW, h, 4)} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55} />
                    ) : (
                      <rect key={s.key} x={x} y={top} width={barW} height={h} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55} />
                    );
                  base = top - 2; // 2px surface gap between stacked segments
                  return el;
                })}
                {i % labelEvery === 0 && (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                    {formatBucket(new Date(t).toISOString(), unit).replace(/^Week of /, "")}
                  </text>
                )}
                {/* Hit target: the whole column, bigger than the mark. */}
                <rect
                  x={M.left + slotW * i}
                  y={M.top}
                  width={slotW}
                  height={innerH}
                  fill="transparent"
                  tabIndex={b ? 0 : -1}
                  aria-label={b ? `${formatBucket(new Date(t).toISOString(), unit)}: ${b.up} up, ${b.degraded} degraded, ${b.down} down` : undefined}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-48 rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-lg"
            style={{
              left: `clamp(0px, calc(${((M.left + slotW * (hover as number) + slotW / 2) / W) * 100}% - 96px), calc(100% - 192px))`,
            }}
          >
            <div className="text-xs text-muted">{formatBucket(new Date(hovered.t).toISOString(), unit)}</div>
            {hovered.b ? (
              <>
                {[...SERIES].reverse().map((s) => (
                  <div key={s.key} className="tabular mt-0.5 flex items-center gap-2">
                    <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                    <strong className="text-ink">{formatNumber(hovered.b![s.key])}</strong>
                    <span className="text-ink-2">{s.label}</span>
                  </div>
                ))}
                <div className="tabular mt-1 text-ink-2">
                  Availability{" "}
                  <strong className="text-ink">
                    {formatPercent(
                      hovered.b.up + hovered.b.degraded + hovered.b.down === 0
                        ? null
                        : (hovered.b.up + hovered.b.degraded) / (hovered.b.up + hovered.b.degraded + hovered.b.down),
                    )}
                  </strong>
                </div>
              </>
            ) : (
              <div className="mt-0.5 text-ink-2">No checks</div>
            )}
          </div>
        )}
      </div>
      </div>
    </figure>
  );
}
