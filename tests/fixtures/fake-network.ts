import { randomUUID } from "node:crypto";
import type { GlobalpingLocation } from "../../src/lib/globalping/schema";
import { failed, finished, probe, type ProbeOverrides } from "./globalping";

// A deterministic stand-in for the Globalping API, used by integration tests and by
// scripts/mock-globalping.ts for local development and end-to-end tests.
//
// Scenarios are chosen by hostname so they can be triggered from the real UI:
//   *pk-blocked*   Pakistan: DNS says the domain doesn't exist; everywhere else works.
//   *isp-reset*    One Pakistani ISP resets connections; other ISPs and countries work.
//   *geo-403*      Cloudflare-style country ban for Pakistan.
//   *down*         Every probe gets HTTP 502.
//   *slow-pk*      Pakistan takes ~9s; everywhere else is fast.
//   anything else  Up everywhere.

const CATALOG: Record<string, ProbeOverrides[]> = {
  PK: [
    { continent: "AS", region: "Southern Asia", country: "PK", city: "Karachi", asn: 17557, network: "Pakistan Telecommunication Company Limited", latitude: 24.86, longitude: 67.01, tags: ["eyeball-network"] },
    { continent: "AS", region: "Southern Asia", country: "PK", city: "Lahore", asn: 23674, network: "Nayatel (Pvt) Ltd", latitude: 31.55, longitude: 74.34, tags: ["eyeball-network"] },
    { continent: "AS", region: "Southern Asia", country: "PK", city: "Islamabad", asn: 38193, network: "Transworld Associates (Pvt.) Ltd.", latitude: 33.69, longitude: 73.05, tags: ["datacenter-network"] },
  ],
  US: [
    { continent: "NA", region: "Northern America", country: "US", state: "NY", city: "New York", asn: 7922, network: "Comcast Cable Communications, LLC", latitude: 40.71, longitude: -74.01, tags: ["eyeball-network"] },
    { continent: "NA", region: "Northern America", country: "US", state: "VA", city: "Ashburn", asn: 14618, network: "Amazon.com, Inc.", latitude: 39.04, longitude: -77.49, tags: ["datacenter-network"] },
    { continent: "NA", region: "Northern America", country: "US", state: "CA", city: "Los Angeles", asn: 7018, network: "AT&T Services, Inc.", latitude: 34.05, longitude: -118.24, tags: ["eyeball-network"] },
  ],
  DE: [
    { continent: "EU", region: "Western Europe", country: "DE", city: "Frankfurt", asn: 24940, network: "Hetzner Online GmbH", latitude: 50.11, longitude: 8.68, tags: ["datacenter-network"] },
    { continent: "EU", region: "Western Europe", country: "DE", city: "Berlin", asn: 3320, network: "Deutsche Telekom AG", latitude: 52.52, longitude: 13.4, tags: ["eyeball-network"] },
  ],
  GB: [{ continent: "EU", region: "Northern Europe", country: "GB", city: "London", asn: 2856, network: "British Telecommunications PLC", latitude: 51.51, longitude: -0.13, tags: ["eyeball-network"] }],
  IN: [{ continent: "AS", region: "Southern Asia", country: "IN", city: "Mumbai", asn: 55836, network: "Reliance Jio Infocomm Limited", latitude: 19.08, longitude: 72.88, tags: ["eyeball-network"] }],
  BR: [{ continent: "SA", region: "South America", country: "BR", city: "São Paulo", asn: 28573, network: "Claro NXT Telecomunicacoes Ltda", latitude: -23.55, longitude: -46.63, tags: ["eyeball-network"] }],
  ZA: [{ continent: "AF", region: "Southern Africa", country: "ZA", city: "Johannesburg", asn: 37457, network: "Telkom SA Ltd.", latitude: -26.2, longitude: 28.05, tags: ["eyeball-network"] }],
  AU: [{ continent: "OC", region: "Australia and New Zealand", country: "AU", city: "Sydney", asn: 1221, network: "Telstra Limited", latitude: -33.87, longitude: 151.21, tags: ["eyeball-network"] }],
  JP: [{ continent: "AS", region: "Eastern Asia", country: "JP", city: "Tokyo", asn: 2516, network: "KDDI Corporation", latitude: 35.68, longitude: 139.69, tags: ["eyeball-network"] }],
  SG: [{ continent: "AS", region: "South-eastern Asia", country: "SG", city: "Singapore", asn: 16509, network: "Amazon.com, Inc.", latitude: 1.35, longitude: 103.82, tags: ["datacenter-network"] }],
  AE: [{ continent: "AS", region: "Western Asia", country: "AE", city: "Dubai", asn: 5384, network: "Emirates Telecommunications Group Company (Etisalat Group) PJSC", latitude: 25.2, longitude: 55.27, tags: ["eyeball-network"] }],
  NG: [{ continent: "AF", region: "Western Africa", country: "NG", city: "Lagos", asn: 29465, network: "MTN Nigeria Communication Limited", latitude: 6.52, longitude: 3.38, tags: ["eyeball-network"] }],
  CA: [{ continent: "NA", region: "Northern America", country: "CA", city: "Toronto", asn: 812, network: "Rogers Communications Canada Inc.", latitude: 43.65, longitude: -79.38, tags: ["eyeball-network"] }],
  FR: [{ continent: "EU", region: "Western Europe", country: "FR", city: "Paris", asn: 3215, network: "Orange S.A.", latitude: 48.86, longitude: 2.35, tags: ["eyeball-network"] }],
};

function matches(p: ProbeOverrides, loc: GlobalpingLocation): boolean {
  if (loc.country && p.country !== loc.country) return false;
  if (loc.city && p.city?.toLowerCase() !== loc.city.toLowerCase()) return false;
  if (loc.asn && p.asn !== loc.asn) return false;
  if (loc.network && !p.network?.toLowerCase().includes(loc.network.toLowerCase())) return false;
  if (loc.tags && !loc.tags.every((t) => p.tags?.includes(t))) return false;
  return true;
}

export function selectProbes(locations: GlobalpingLocation[]): ProbeOverrides[] {
  const all = Object.values(CATALOG).flat();
  const chosen: ProbeOverrides[] = [];
  for (const loc of locations) {
    const found = all.filter((p) => matches(p, loc) && !chosen.includes(p));
    chosen.push(...found.slice(0, loc.limit ?? 1));
  }
  return chosen;
}

export function scenarioResult(hostname: string, p: ProbeOverrides, index: number): unknown {
  const jitter = 180 + ((index * 37) % 140);
  if (hostname.includes("pk-blocked") && p.country === "PK") return failed(`getaddrinfo ENOTFOUND ${hostname}`, "target");
  if (hostname.includes("isp-reset") && p.asn === 17557) return failed("read ECONNRESET", "target");
  if (hostname.includes("geo-403") && p.country === "PK") {
    return finished({ statusCode: 403, rawBody: "error code: 1009 The owner of this website has banned the country or region your IP address is in." });
  }
  if (hostname.includes("down")) return finished({ statusCode: 502, timings: { total: jitter } });
  if (hostname.includes("slow-pk") && p.country === "PK") return finished({ timings: { total: 9000 + index * 100, firstByte: 8500 } });
  return finished({ timings: { total: jitter, firstByte: Math.round(jitter * 0.6) } });
}

interface StoredMeasurement {
  id: string;
  hostname: string;
  probes: ProbeOverrides[];
  createdAt: number;
  measurementOptions: unknown;
}

export class FakeNetwork {
  readonly measurements = new Map<string, StoredMeasurement>();
  /** How long measurements stay "in-progress". */
  constructor(private readonly durationMs = 0) {}
  createCalls = 0;
  getCalls = 0;
  /** Force the next create to fail with this HTTP status. */
  failNextCreateWith: number | null = null;

  create(body: { target: string; locations: GlobalpingLocation[]; measurementOptions?: unknown }): { status: number; json: unknown } {
    this.createCalls += 1;
    if (this.failNextCreateWith !== null) {
      const status = this.failNextCreateWith;
      this.failNextCreateWith = null;
      return { status, json: { error: { type: "error", message: `Simulated ${status}` } } };
    }
    // Mirror Globalping's Joi validation for the fields we send: strings may not be empty,
    // and the sum of per-location limits is capped (50 for anonymous callers).
    const request = (body.measurementOptions as { request?: Record<string, unknown> } | undefined)?.request ?? {};
    for (const [key, value] of Object.entries(request)) {
      if (value === "") {
        return {
          status: 400,
          json: {
            error: {
              type: "validation_error",
              message: "Parameter validation failed.",
              params: { [`measurementOptions.request.${key}`]: `"measurementOptions.request.${key}" is not allowed to be empty` },
            },
          },
        };
      }
    }
    const total = body.locations.reduce((sum, l) => sum + (l.limit ?? 1), 0);
    if (total > 50) {
      return { status: 400, json: { error: { type: "validation_error", message: "Parameter validation failed.", params: { locations: "sum of limits must be <= 50" } } } };
    }
    const probes = selectProbes(body.locations);
    if (probes.length === 0) {
      return { status: 422, json: { error: { type: "no_probes_found", message: "No suitable probes supplied." } } };
    }
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    this.measurements.set(id, { id, hostname: body.target, probes, createdAt: Date.now(), measurementOptions: body.measurementOptions });
    return { status: 202, json: { id, probesCount: probes.length } };
  }

  get(id: string): { status: number; json: unknown } {
    this.getCalls += 1;
    const m = this.measurements.get(id);
    if (!m) return { status: 404, json: { error: { type: "not_found", message: "Couldn't find the requested measurement." } } };
    const elapsed = Date.now() - m.createdAt;
    const done = elapsed >= this.durationMs;
    const results = m.probes.map((p, i) => {
      // While running, reveal results progressively.
      const ready = done || i < Math.floor((elapsed / Math.max(1, this.durationMs)) * m.probes.length);
      return { probe: probe(p), result: ready ? scenarioResult(m.hostname, p, i) : { status: "in-progress", rawOutput: "" } };
    });
    return {
      status: 200,
      json: {
        id: m.id,
        type: "http",
        target: m.hostname,
        status: done ? "finished" : "in-progress",
        createdAt: new Date(m.createdAt).toISOString(),
        updatedAt: new Date().toISOString(),
        probesCount: m.probes.length,
        measurementOptions: m.measurementOptions,
        results,
      },
    };
  }

  /** A fetch implementation routing to this fake, for GlobalpingClient({ fetchImpl }). */
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    let out: { status: number; json: unknown };
    if (method === "POST" && url.pathname === "/v1/measurements") {
      out = this.create(JSON.parse(String(init?.body)));
    } else if (method === "GET" && url.pathname.startsWith("/v1/measurements/")) {
      out = this.get(url.pathname.split("/").pop() ?? "");
    } else {
      out = { status: 404, json: { error: { type: "not_found", message: "Not found" } } };
    }
    return new Response(JSON.stringify(out.json), { status: out.status, headers: { "Content-Type": "application/json" } });
  };
}
