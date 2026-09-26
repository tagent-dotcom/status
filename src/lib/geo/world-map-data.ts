import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { NUMERIC_TO_ALPHA2 } from "./iso-numeric";

export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 470;

export interface CountryShape {
  code: string; // ISO alpha-2, or "" when unknown
  name: string;
  d: string;
}

// Features in the 110m topology that have no numeric id.
const NAME_TO_ALPHA2: Record<string, string> = { Kosovo: "XK", "N. Cyprus": "CY", Somaliland: "SO" };

let cache: { shapes: CountryShape[]; project: (lon: number, lat: number) => [number, number] | null } | null = null;

/** Projected SVG paths for every country, computed once per page load. */
export function getWorldMap() {
  if (cache) return cache;
  const topology = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const collection = feature(topology, topology.objects.countries);
  // Antarctica takes a fifth of the map and has no probes.
  const features = collection.features.filter((f) => f.id !== "010");
  const projection = geoEqualEarth().fitSize([MAP_WIDTH, MAP_HEIGHT], { type: "FeatureCollection", features });
  const path = geoPath(projection);
  const shapes = features
    .map((f) => {
      const name = f.properties?.name ?? "";
      const code = (f.id !== undefined ? NUMERIC_TO_ALPHA2[String(f.id)] : undefined) ?? NAME_TO_ALPHA2[name] ?? "";
      return { code, name, d: path(f) ?? "" };
    })
    .filter((s) => s.d !== "");
  cache = {
    shapes,
    project: (lon, lat) => {
      const p = projection([lon, lat]);
      return p ? [p[0], p[1]] : null;
    },
  };
  return cache;
}
