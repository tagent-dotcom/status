"use client";

import { useMemo, useRef, useState } from "react";
import type { AreaStatus } from "@/lib/analysis";
import { countryName } from "@/lib/geo/countries";
import { MAP_HEIGHT, MAP_WIDTH, getWorldMap } from "@/lib/geo/world-map-data";
import { formatPercent } from "@/lib/format";
import { StatusIcon, statusColor, statusLabel } from "./status-badge";

export interface MapCountry {
  country: string;
  status: AreaStatus;
  up: number;
  degraded: number;
  down: number;
  inconclusive: number;
}

export interface MapProbe {
  latitude: number;
  longitude: number;
  status: AreaStatus;
  label: string;
}

const LEGEND: AreaStatus[] = ["up", "degraded", "partial", "down", "unknown"];

interface Tip {
  x: number;
  y: number;
  country: string;
  data: MapCountry | undefined;
}

export function WorldMap({ countries, probes = [], onSelectCountry }: { countries: MapCountry[]; probes?: MapProbe[]; onSelectCountry?: (code: string) => void }) {
  const { shapes, project } = useMemo(() => getWorldMap(), []);
  const byCode = useMemo(() => new Map(countries.map((c) => [c.country, c])), [countries]);
  const [tip, setTip] = useState<Tip | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  const dots = useMemo(
    () =>
      probes
        .map((p) => ({ ...p, xy: project(p.longitude, p.latitude) }))
        .filter((p): p is MapProbe & { xy: [number, number] } => p.xy !== null),
    [probes, project],
  );

  function show(event: React.PointerEvent | React.FocusEvent, code: string) {
    const box = wrapper.current?.getBoundingClientRect();
    if (!box) return;
    let x: number;
    let y: number;
    if ("clientX" in event) {
      x = event.clientX - box.left;
      y = event.clientY - box.top;
    } else {
      const r = (event.target as SVGElement).getBoundingClientRect();
      x = r.left + r.width / 2 - box.left;
      y = r.top + r.height / 2 - box.top;
    }
    // Keep the tooltip inside the map on narrow screens.
    const half = 96;
    x = Math.min(Math.max(x, half), Math.max(half, box.width - half));
    y = Math.max(y, 88);
    setTip({ x, y, country: code, data: byCode.get(code) });
  }

  return (
    <figure className="space-y-2">
      <div ref={wrapper} className="relative" onPointerLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} className="h-auto w-full" role="img" aria-label="World map of results by country">
          {shapes.map((s, i) => {
            const data = s.code ? byCode.get(s.code) : undefined;
            const tested = data !== undefined;
            return (
              <path
                key={`${s.code}-${i}`}
                d={s.d}
                fill={tested ? statusColor(data.status) : "var(--untested)"}
                stroke="var(--surface)"
                strokeWidth={0.6}
                tabIndex={tested ? 0 : -1}
                role={tested ? "button" : undefined}
                aria-label={tested ? `${countryName(s.code)}: ${statusLabel(data.status)}` : undefined}
                onPointerMove={(e) => s.code && show(e, s.code)}
                onFocus={(e) => tested && show(e, s.code)}
                onBlur={() => setTip(null)}
                onClick={() => tested && onSelectCountry?.(s.code)}
                onKeyDown={(e) => {
                  if (tested && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onSelectCountry?.(s.code);
                  }
                }}
                className={tested ? "cursor-pointer outline-none hover:opacity-80 focus-visible:opacity-80" : undefined}
              />
            );
          })}
          {dots.map((d, i) => (
            <circle key={i} cx={d.xy[0]} cy={d.xy[1]} r={4} fill={statusColor(d.status)} stroke="var(--surface)" strokeWidth={2} pointerEvents="none">
              <title>{d.label}</title>
            </circle>
          ))}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-lg"
            style={{ left: tip.x, top: tip.y }}
            role="status"
          >
            <div className="font-medium text-ink">{countryName(tip.country)}</div>
            {tip.data ? (
              <>
                <div className="mt-1 flex items-center gap-1.5 text-ink-2">
                  <StatusIcon kind={tip.data.status} size={14} />
                  {statusLabel(tip.data.status)}
                </div>
                <div className="tabular mt-1 text-ink-2">
                  <strong className="text-ink">{tip.data.up + tip.data.degraded}</strong> of {tip.data.up + tip.data.degraded + tip.data.down} probes reached the site
                  {tip.data.up + tip.data.degraded + tip.data.down > 0 && (
                    <> ({formatPercent((tip.data.up + tip.data.degraded) / (tip.data.up + tip.data.degraded + tip.data.down), 0)})</>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-1 text-muted">Not tested</div>
            )}
          </div>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        {LEGEND.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <StatusIcon kind={s} size={12} />
            {statusLabel(s)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: "var(--untested)", boxShadow: "inset 0 0 0 1px var(--border)" }} />
          Not tested
        </span>
      </figcaption>
    </figure>
  );
}
