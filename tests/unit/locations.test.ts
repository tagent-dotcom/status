import { describe, expect, it } from "vitest";
import {
  WORLDWIDE_COUNTRIES,
  canonicalLocationKey,
  dedupeLocations,
  locationRequestSchema,
  planProbes,
} from "@/lib/locations";

describe("locationRequestSchema", () => {
  it("parses worldwide with default network type", () => {
    expect(locationRequestSchema.parse({ mode: "worldwide" })).toEqual({ mode: "worldwide", networkType: "any" });
  });

  it("normalises country codes and city whitespace", () => {
    const parsed = locationRequestSchema.parse({
      mode: "custom",
      locations: [{ country: "pk", city: "  Karachi  " }, { asn: "17557" }],
    });
    expect(parsed).toEqual({
      mode: "custom",
      networkType: "any",
      locations: [{ country: "PK", city: "Karachi" }, { asn: 17557 }],
    });
  });

  it.each([
    [{ mode: "custom", locations: [] }, "empty list"],
    [{ mode: "custom", locations: [{}] }, "empty location"],
    [{ mode: "custom", locations: [{ city: "Hyderabad" }] }, "city without country"],
    [{ mode: "custom", locations: [{ country: "Pakistan" }] }, "country name instead of code"],
    [{ mode: "custom", locations: [{ country: "PK", city: "<script>" }] }, "bad city"],
    [{ mode: "custom", locations: [{ asn: -1 }] }, "bad asn"],
    [{ mode: "custom", locations: [{ country: "PK", magic: "anything" }] }, "unknown field"],
    [{ mode: "custom", locations: Array.from({ length: 26 }, () => ({ country: "US" })) }, "too many"],
    [{ mode: "worldwide", networkType: "satellite" }, "bad network type"],
    [{ mode: "everywhere" }, "bad mode"],
  ])("rejects %j (%s)", (input, why) => {
    expect(locationRequestSchema.safeParse(input).success, why).toBe(false);
  });
});

describe("planProbes", () => {
  it("spreads the probe cap across worldwide countries", () => {
    const plan = planProbes({ mode: "worldwide", networkType: "any" }, 50);
    expect(plan.locations).toHaveLength(WORLDWIDE_COUNTRIES.length);
    expect(plan.locations.every((l) => l.limit === 2)).toBe(true);
    expect(plan.requestedProbes).toBe(50);
  });

  it("truncates to the cap when there are more places than probes, never exceeding it", () => {
    const plan = planProbes({ mode: "worldwide", networkType: "any" }, 10);
    expect(plan.locations).toHaveLength(10);
    expect(plan.requestedProbes).toBe(10);
    // The first ten keep every inhabited continent represented.
    expect(plan.locations.map((l) => l.country)).toEqual(["US", "DE", "IN", "BR", "ZA", "AU", "JP", "GB", "PK", "SG"]);
  });

  it("caps per-location probes at 10", () => {
    const plan = planProbes({ mode: "custom", networkType: "any", locations: [{ country: "PK" }] }, 50);
    expect(plan.locations).toEqual([{ country: "PK", limit: 10 }]);
  });

  it("adds network type tags", () => {
    const plan = planProbes({ mode: "custom", networkType: "eyeball", locations: [{ country: "PK" }, { country: "US" }] }, 50);
    expect(plan.locations[0]).toEqual({ country: "PK", limit: 10, tags: ["eyeball-network"] });
  });

  it("maps every filter field", () => {
    const plan = planProbes(
      { mode: "custom", networkType: "any", locations: [{ country: "PK", city: "Karachi", asn: 17557, network: "PTCL" }] },
      5,
    );
    expect(plan.locations[0]).toEqual({ country: "PK", city: "Karachi", asn: 17557, network: "PTCL", limit: 5 });
  });
});

describe("canonicalLocationKey", () => {
  it("is order and case insensitive and ignores duplicates", () => {
    const a = canonicalLocationKey({
      mode: "custom",
      networkType: "any",
      locations: [{ country: "US" }, { country: "PK", city: "Karachi" }],
    });
    const b = canonicalLocationKey({
      mode: "custom",
      networkType: "any",
      locations: [{ country: "PK", city: "karachi" }, { country: "US" }, { country: "US" }],
    });
    expect(a).toBe(b);
  });

  it("differs by network type", () => {
    expect(canonicalLocationKey({ mode: "worldwide", networkType: "any" })).not.toBe(
      canonicalLocationKey({ mode: "worldwide", networkType: "eyeball" }),
    );
  });
});

describe("dedupeLocations", () => {
  it("removes case-insensitive duplicates, keeping the first", () => {
    const r = dedupeLocations({
      mode: "custom",
      networkType: "any",
      locations: [{ country: "PK", city: "Karachi" }, { country: "PK", city: "KARACHI" }, { country: "US" }],
    });
    expect(r).toEqual({ mode: "custom", networkType: "any", locations: [{ country: "PK", city: "Karachi" }, { country: "US" }] });
  });
});
