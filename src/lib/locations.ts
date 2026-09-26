import { z } from "zod";
import type { GlobalpingLocation } from "./globalping/schema";

// What a user asks for, in our own format. Kept separate from Globalping's format so the
// probe provider can change (or be combined with our own probes) without touching stored data.

export const NETWORK_TYPES = ["any", "eyeball", "datacenter"] as const;
export type NetworkTypeFilter = (typeof NETWORK_TYPES)[number];

export const MAX_CUSTOM_LOCATIONS = 25;
const MAX_PROBES_PER_LOCATION = 10;

// Default "worldwide" spread. Ordered so that truncating the list (when the per-check probe cap
// is small) still keeps every continent represented. Countries with no online probe are
// skipped by Globalping rather than failing the request.
export const WORLDWIDE_COUNTRIES = [
  "US", "DE", "IN", "BR", "ZA", "AU", "JP", "GB", "PK", "SG",
  "CA", "FR", "NG", "AE", "MX", "NL", "ID", "KR", "AR", "PL",
  "TR", "EG", "BD", "SA", "KE",
] as const;

const countryCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/, "Country must be a two-letter ISO code"));

const placeName = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, "City contains unsupported characters"),
  );

const networkName = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(2)
      .max(100)
      .regex(/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,&()'/-]*$/u, "ISP name contains unsupported characters"),
  );

export const locationFilterSchema = z
  .object({
    country: countryCode.optional(),
    city: placeName.optional(),
    asn: z.coerce.number().int().min(1).max(4_294_967_295).optional(),
    network: networkName.optional(),
  })
  .strict()
  .refine((l) => l.country || l.city || l.asn || l.network, "Each location needs a country, city, ASN or ISP")
  // City names repeat across countries (Hyderabad IN/PK, Portland US...). Require the country.
  .refine((l) => !l.city || l.country, "Choose a country for the city");

export type LocationFilter = z.infer<typeof locationFilterSchema>;

export const locationRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("worldwide"), networkType: z.enum(NETWORK_TYPES).default("any") }).strict(),
  z
    .object({
      mode: z.literal("custom"),
      locations: z.array(locationFilterSchema).min(1).max(MAX_CUSTOM_LOCATIONS),
      networkType: z.enum(NETWORK_TYPES).default("any"),
    })
    .strict(),
]);

export type LocationRequest = z.infer<typeof locationRequestSchema>;

export interface ProbePlan {
  locations: GlobalpingLocation[];
  requestedProbes: number;
}

function tagsFor(networkType: NetworkTypeFilter): string[] | undefined {
  if (networkType === "eyeball") return ["eyeball-network"];
  if (networkType === "datacenter") return ["datacenter-network"];
  return undefined;
}

/**
 * Turns a user request into Globalping locations, spreading `maxProbes` evenly across the
 * requested places (at least 1, at most 10 per place). When there are more places than
 * probes, the list is truncated; for worldwide the order keeps continents balanced.
 */
export function planProbes(request: LocationRequest, maxProbes: number): ProbePlan {
  const filters: LocationFilter[] =
    request.mode === "worldwide" ? WORLDWIDE_COUNTRIES.map((country) => ({ country })) : request.locations;
  const usable = filters.slice(0, Math.max(1, maxProbes));
  const perLocation = Math.min(MAX_PROBES_PER_LOCATION, Math.max(1, Math.floor(maxProbes / usable.length)));
  const tags = tagsFor(request.networkType);

  const locations: GlobalpingLocation[] = usable.map((f) => {
    const loc: GlobalpingLocation = { limit: perLocation };
    if (f.country) loc.country = f.country;
    if (f.city) loc.city = f.city;
    if (f.asn) loc.asn = f.asn;
    if (f.network) loc.network = f.network;
    if (tags) loc.tags = tags;
    return loc;
  });
  return { locations, requestedProbes: perLocation * locations.length };
}

function filterKey(l: LocationFilter): string {
  return [l.country ?? "", (l.city ?? "").toLowerCase(), l.asn ?? "", (l.network ?? "").toLowerCase()].join(":");
}

/** Stable string for a request so identical requests can share a measurement. */
export function canonicalLocationKey(request: LocationRequest): string {
  if (request.mode === "worldwide") return `worldwide|${request.networkType}`;
  const parts = request.locations.map(filterKey).sort();
  // Duplicates add nothing; collapse them so "PK, PK" and "PK" share a key.
  return `custom|${request.networkType}|${[...new Set(parts)].join(";")}`;
}

/** Removes duplicate location entries (case-insensitive), preserving order. */
export function dedupeLocations(request: LocationRequest): LocationRequest {
  if (request.mode === "worldwide") return request;
  const seen = new Set<string>();
  const locations = request.locations.filter((l) => {
    const key = filterKey(l);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...request, locations };
}
