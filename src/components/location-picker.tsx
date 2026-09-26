"use client";

import { useId, useMemo } from "react";
import { COUNTRY_CODES } from "@/lib/geo/country-codes";
import { countryFlag, countryName } from "@/lib/geo/countries";
import { MAX_CUSTOM_LOCATIONS, type NetworkTypeFilter } from "@/lib/locations";

export interface PickerRow {
  key: string;
  country: string;
  city: string;
  isp: string;
}

export interface PickerState {
  mode: "worldwide" | "custom";
  rows: PickerRow[];
  networkType: NetworkTypeFilter;
}

let rowCounter = 0;
export function newRow(country = ""): PickerRow {
  rowCounter += 1;
  return { key: `row-${rowCounter}`, country, city: "", isp: "" };
}

export function initialPickerState(): PickerState {
  return { mode: "worldwide", rows: [newRow("PK"), newRow("US")], networkType: "any" };
}

/** Converts picker state to the API's LocationRequest shape (validated server-side too). */
export function toLocationRequest(state: PickerState): unknown {
  if (state.mode === "worldwide") return { mode: "worldwide", networkType: state.networkType };
  const locations = state.rows
    .map((r) => {
      const loc: Record<string, string | number> = {};
      if (r.country) loc.country = r.country;
      if (r.city.trim()) loc.city = r.city.trim();
      const isp = r.isp.trim();
      const asn = /^(?:AS)?\s*(\d{1,10})$/i.exec(isp);
      if (asn) loc.asn = Number(asn[1]);
      else if (isp) loc.network = isp;
      return loc;
    })
    .filter((l) => Object.keys(l).length > 0);
  return { mode: "custom", locations, networkType: state.networkType };
}

const inputClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent";

export function LocationPicker({ state, onChange }: { state: PickerState; onChange: (s: PickerState) => void }) {
  const id = useId();
  const countries = useMemo(
    () => COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const update = (key: string, patch: Partial<PickerRow>) =>
    onChange({ ...state, rows: state.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });

  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Where to check from</legend>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Locations">
        {(["worldwide", "custom"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={state.mode === mode}
            onClick={() => onChange({ ...state, mode })}
            className={`h-9 rounded-full border px-4 text-sm transition-colors ${
              state.mode === mode ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-ink hover:bg-surface-2"
            }`}
          >
            {mode === "worldwide" ? "Worldwide (25 countries)" : "Choose countries, cities or ISPs"}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
          <span>Networks</span>
          <select
            value={state.networkType}
            onChange={(e) => onChange({ ...state, networkType: e.target.value as NetworkTypeFilter })}
            className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
          >
            <option value="any">All networks</option>
            <option value="eyeball">Home &amp; mobile ISPs only</option>
            <option value="datacenter">Data centers only</option>
          </select>
        </label>
      </div>

      {state.mode === "custom" && (
        <div className="space-y-2">
          <div className="hidden grid-cols-[1.3fr_1fr_1fr_auto] gap-2 px-0.5 text-xs text-muted sm:grid">
            <span id={`${id}-c`}>Country</span>
            <span id={`${id}-city`}>City (optional)</span>
            <span id={`${id}-isp`}>ISP name or ASN (optional)</span>
            <span className="w-9" />
          </div>
          {state.rows.map((row, index) => (
            <div key={row.key} className="grid grid-cols-1 gap-2 rounded-md border border-line p-2 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:border-0 sm:p-0">
              <select
                aria-label={`Country for location ${index + 1}`}
                value={row.country}
                onChange={(e) => update(row.key, { country: e.target.value })}
                className={inputClass}
              >
                <option value="">Any country</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {countryFlag(c.code)} {c.name}
                  </option>
                ))}
              </select>
              <input
                aria-label={`City for location ${index + 1}`}
                placeholder="e.g. Karachi"
                value={row.city}
                maxLength={64}
                onChange={(e) => update(row.key, { city: e.target.value })}
                className={inputClass}
              />
              <input
                aria-label={`ISP or ASN for location ${index + 1}`}
                placeholder="e.g. PTCL or AS17557"
                value={row.isp}
                maxLength={100}
                onChange={(e) => update(row.key, { isp: e.target.value })}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => onChange({ ...state, rows: state.rows.filter((r) => r.key !== row.key) })}
                disabled={state.rows.length === 1}
                aria-label={`Remove location ${index + 1}`}
                className="h-10 w-full rounded-md border border-line text-ink-2 hover:bg-surface-2 disabled:opacity-40 sm:w-9"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...state, rows: [...state.rows, newRow()] })}
            disabled={state.rows.length >= MAX_CUSTOM_LOCATIONS}
            className="text-sm font-medium text-accent-ink hover:underline disabled:opacity-40"
          >
            + Add location
          </button>
          <p className="text-xs text-muted">
            Probes run on real home, mobile and data-center connections. If nobody hosts a probe in a place you pick, that place is
            skipped. Comparing ISPs within one country is the fastest way to tell an ISP block from a site problem.
          </p>
        </div>
      )}
    </fieldset>
  );
}
