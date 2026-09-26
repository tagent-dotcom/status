import { z } from "zod";
import {
  apiErrorSchema,
  createMeasurementResponseSchema,
  measurementSchema,
  type GlobalpingLocation,
  type GlobalpingMeasurement,
} from "./schema";

export interface HttpMeasurementRequest {
  hostname: string;
  protocol: "HTTPS" | "HTTP";
  path: string;
  query: string;
  locations: GlobalpingLocation[];
}

export type GlobalpingErrorKind =
  | "rate_limited" // 429: upstream allowance exhausted
  | "no_probes" // 422: nothing matched the requested locations
  | "bad_request" // 400: our request was invalid (e.g. unknown city)
  | "not_found" // 404 on GET
  | "upstream" // 5xx / unexpected status
  | "network" // timeout / connection failure
  | "invalid_response"; // response didn't match the documented schema

export class GlobalpingError extends Error {
  constructor(
    readonly kind: GlobalpingErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GlobalpingError";
  }
}

export interface GlobalpingClientOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

// Per-test probe timeout in seconds. Globalping allows up to 20s; 15s gives slow sites a fair
// chance while keeping the whole measurement (plus ~10s API overhead) well under a minute.
export const PROBE_TIMEOUT_SECONDS = 15;

export class GlobalpingClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(private readonly options: GlobalpingClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.userAgent = options.userAgent ?? "WorldStatus/0.1 (+https://github.com/tagent-dotcom/status)";
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", this.userAgent);
    headers.set("Accept", "application/json");
    if (this.options.token) headers.set("Authorization", `Bearer ${this.options.token}`);
    try {
      return await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GlobalpingError("network", `Could not reach the probe network: ${message}`);
    }
  }

  private async toError(response: Response): Promise<GlobalpingError> {
    let message = `Probe network responded with HTTP ${response.status}`;
    try {
      const parsed = apiErrorSchema.safeParse(await response.json());
      if (parsed.success) {
        const { message: base, params } = parsed.data.error;
        // Validation errors name the offending fields in `params`; keep them for diagnosis.
        const details = params ? Object.entries(params).map(([k, v]) => `${k}: ${v}`).join("; ") : "";
        message = details ? `${base} (${details})` : base;
      }
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    const retryAfter = Number(response.headers.get("Retry-After") ?? response.headers.get("X-RateLimit-Reset"));
    const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
    switch (response.status) {
      case 400:
        return new GlobalpingError("bad_request", message, 400);
      case 404:
        return new GlobalpingError("not_found", message, 404);
      case 422:
        return new GlobalpingError("no_probes", message, 422);
      case 429:
        return new GlobalpingError("rate_limited", message, 429, retryAfterSeconds);
      default:
        return new GlobalpingError("upstream", message, response.status);
    }
  }

  private static parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new GlobalpingError("invalid_response", `Unexpected response from probe network: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async createHttpMeasurement(req: HttpMeasurementRequest): Promise<{ id: string; probesCount: number }> {
    const body = {
      type: "http",
      target: req.hostname,
      locations: req.locations,
      inProgressUpdates: true,
      timeout: PROBE_TIMEOUT_SECONDS,
      measurementOptions: {
        protocol: req.protocol,
        request: {
          // GET, not the default HEAD: some servers answer HEAD wrongly (405), and the first
          // 10 KB of body lets us spot ISP block pages.
          method: "GET",
          path: req.path,
          // Globalping validates strings with Joi, which rejects "" — omit empty values.
          ...(req.query ? { query: req.query } : {}),
        },
      },
    };
    const response = await this.request("/v1/measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status !== 202 && response.status !== 200) throw await this.toError(response);
    return GlobalpingClient.parse(createMeasurementResponseSchema, await response.json());
  }

  async getMeasurement(id: string): Promise<GlobalpingMeasurement> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new GlobalpingError("bad_request", "Invalid measurement id");
    }
    const response = await this.request(`/v1/measurements/${id}`, { method: "GET" });
    if (response.status !== 200) throw await this.toError(response);
    return GlobalpingClient.parse(measurementSchema, await response.json());
  }
}
