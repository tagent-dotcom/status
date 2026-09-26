import { z } from "zod";

// Runtime schemas for the parts of the Globalping API we consume, derived from the official
// OpenAPI types (globalping@0.4.0, openapi-ts/types.gen.ts). Responses are external input:
// validate before use. Objects are loose so new upstream fields don't break parsing.

const nullableNumber = z.number().nullable();

export const probeSchema = z.looseObject({
  continent: z.string(),
  region: z.string(),
  country: z.string(),
  state: z.string().nullable().optional(),
  city: z.string(),
  asn: z.number().int(),
  network: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  tags: z.array(z.string()).default([]),
  resolvers: z.array(z.string()).default([]),
});

const tlsSchema = z.looseObject({
  protocol: z.string().optional(),
  authorized: z.boolean(),
  error: z.string().optional(),
  createdAt: z.string().optional(),
  expiresAt: z.string().optional(),
  issuer: z.looseObject({ C: z.string().optional(), O: z.string().optional(), CN: z.string().optional() }).optional(),
  subject: z.looseObject({ CN: z.string().optional(), alt: z.string().optional() }).optional(),
  fingerprint256: z.string().optional(),
});

export const finishedHttpResultSchema = z.looseObject({
  status: z.literal("finished"),
  rawOutput: z.string(),
  rawHeaders: z.string().optional(),
  rawBody: z.string().nullable().optional(),
  truncated: z.boolean().optional(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  statusCode: z.number().int(),
  statusCodeName: z.string().optional(),
  resolvedAddress: z.string().nullable(),
  timings: z.looseObject({
    total: nullableNumber,
    dns: nullableNumber,
    tcp: nullableNumber,
    tls: nullableNumber,
    firstByte: nullableNumber,
    download: nullableNumber,
  }),
  tls: tlsSchema.nullable(),
});

export const failedResultSchema = z.looseObject({
  status: z.literal("failed"),
  rawOutput: z.string(),
  failureSource: z.string().optional(),
});

export const inProgressResultSchema = z.looseObject({
  status: z.literal("in-progress"),
  rawOutput: z.string().default(""),
});

export const offlineResultSchema = z.looseObject({
  status: z.literal("offline"),
  rawOutput: z.string().default(""),
});

const KNOWN_STATUSES = new Set(["finished", "failed", "in-progress", "offline"]);

// The spec says "any value other than in-progress is final", so new statuses may appear.
// Map an unknown one to an internal failure (reported as inconclusive, never as downtime)
// instead of rejecting the whole measurement.
export const httpTestResultSchema = z.preprocess(
  (value) => {
    if (value && typeof value === "object" && "status" in value) {
      const status = (value as { status: unknown }).status;
      if (typeof status === "string" && !KNOWN_STATUSES.has(status)) {
        return { status: "failed", failureSource: "internal", rawOutput: `Unrecognised probe result status "${status}".` };
      }
    }
    return value;
  },
  z.discriminatedUnion("status", [finishedHttpResultSchema, failedResultSchema, inProgressResultSchema, offlineResultSchema]),
);

export const measurementSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  target: z.string(),
  status: z.string(), // "in-progress" | "finished"; anything else is also final per the spec
  createdAt: z.string(),
  updatedAt: z.string(),
  probesCount: z.number().int(),
  results: z.array(z.looseObject({ probe: probeSchema, result: httpTestResultSchema })),
});

export const createMeasurementResponseSchema = z.looseObject({
  id: z.string(),
  probesCount: z.number().int(),
});

export const apiErrorSchema = z.looseObject({
  error: z.looseObject({
    type: z.string(),
    message: z.string(),
    params: z.record(z.string(), z.string()).optional(),
  }),
});

export type GlobalpingProbe = z.infer<typeof probeSchema>;
export type GlobalpingHttpResult = z.infer<typeof httpTestResultSchema>;
export type GlobalpingFinishedHttpResult = z.infer<typeof finishedHttpResultSchema>;
export type GlobalpingMeasurement = z.infer<typeof measurementSchema>;
export type GlobalpingResultItem = GlobalpingMeasurement["results"][number];

/** Location selector as accepted by POST /v1/measurements. */
export interface GlobalpingLocation {
  continent?: string;
  country?: string;
  city?: string;
  asn?: number;
  network?: string;
  tags?: string[];
  magic?: string;
  limit?: number;
}
