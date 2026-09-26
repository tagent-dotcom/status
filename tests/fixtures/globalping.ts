// Builders for Globalping API payloads shaped exactly like the documented schema
// (globalping@0.4.0 OpenAPI types). Used by unit tests and the local mock server.

export interface ProbeOverrides {
  continent?: string;
  region?: string;
  country?: string;
  state?: string | null;
  city?: string;
  asn?: number;
  network?: string;
  latitude?: number;
  longitude?: number;
  tags?: string[];
}

export const PROBES = {
  karachiPtcl: { continent: "AS", region: "Southern Asia", country: "PK", city: "Karachi", asn: 17557, network: "Pakistan Telecommunication Company Limited", latitude: 24.86, longitude: 67.01, tags: ["eyeball-network"] },
  lahoreNayatel: { continent: "AS", region: "Southern Asia", country: "PK", city: "Lahore", asn: 23674, network: "Nayatel (Pvt) Ltd", latitude: 31.55, longitude: 74.34, tags: ["eyeball-network"] },
  newYorkComcast: { continent: "NA", region: "Northern America", country: "US", state: "NY", city: "New York", asn: 7922, network: "Comcast Cable Communications, LLC", latitude: 40.71, longitude: -74.01, tags: ["eyeball-network"] },
  ashburnAws: { continent: "NA", region: "Northern America", country: "US", state: "VA", city: "Ashburn", asn: 14618, network: "Amazon.com, Inc.", latitude: 39.04, longitude: -77.49, tags: ["datacenter-network", "aws-us-east-1"] },
  frankfurtHetzner: { continent: "EU", region: "Western Europe", country: "DE", city: "Frankfurt", asn: 24940, network: "Hetzner Online GmbH", latitude: 50.11, longitude: 8.68, tags: ["datacenter-network"] },
  londonBt: { continent: "EU", region: "Northern Europe", country: "GB", city: "London", asn: 2856, network: "British Telecommunications PLC", latitude: 51.51, longitude: -0.13, tags: ["eyeball-network"] },
} satisfies Record<string, ProbeOverrides>;

export function probe(overrides: ProbeOverrides = {}) {
  return {
    continent: "EU",
    region: "Western Europe",
    country: "DE",
    state: null,
    city: "Frankfurt",
    asn: 24940,
    network: "Hetzner Online GmbH",
    latitude: 50.11,
    longitude: 8.68,
    tags: ["datacenter-network"],
    resolvers: ["private"],
    ...overrides,
  };
}

export interface FinishedOverrides {
  statusCode?: number;
  headers?: Record<string, string | string[]>;
  rawBody?: string | null;
  resolvedAddress?: string | null;
  timings?: Partial<Record<"total" | "dns" | "tcp" | "tls" | "firstByte" | "download", number | null>>;
  tls?: Record<string, unknown> | null;
}

export function finished(o: FinishedOverrides = {}) {
  const statusCode = o.statusCode ?? 200;
  return {
    status: "finished" as const,
    rawOutput: `HTTP/1.1 ${statusCode}\n`,
    rawHeaders: "",
    rawBody: o.rawBody === undefined ? "<html><body>hello</body></html>" : o.rawBody,
    truncated: false,
    headers: o.headers ?? { "content-type": "text/html" },
    statusCode,
    statusCodeName: "OK",
    resolvedAddress: o.resolvedAddress === undefined ? "93.184.216.34" : o.resolvedAddress,
    timings: { total: 420, dns: 12, tcp: 30, tls: 60, firstByte: 250, download: 68, ...o.timings },
    tls:
      o.tls === undefined
        ? {
            protocol: "TLSv1.3",
            cipherName: "TLS_AES_256_GCM_SHA384",
            authorized: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2027-01-01T00:00:00.000Z",
            subject: { CN: "example.com", alt: "DNS:example.com" },
            issuer: { C: "US", O: "Let's Encrypt", CN: "R11" },
            keyType: "EC",
            keyBits: 256,
            serialNumber: "01:02",
            fingerprint256: "AA:BB:CC",
            publicKey: null,
          }
        : o.tls,
  };
}

export function failed(rawOutput: string, failureSource?: "target" | "resolver" | "internal") {
  return { status: "failed" as const, rawOutput, ...(failureSource ? { failureSource } : {}) };
}

export function item(probeOverrides: ProbeOverrides, result: unknown) {
  return { probe: probe(probeOverrides), result };
}

export function measurement(id: string, results: unknown[], status: "in-progress" | "finished" = "finished") {
  return {
    id,
    type: "http",
    target: "example.com",
    status,
    createdAt: "2026-09-26T10:00:00.000Z",
    updatedAt: "2026-09-26T10:00:05.000Z",
    probesCount: results.length,
    results,
  };
}
