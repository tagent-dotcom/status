import type { CheckView } from "./checks";
import type { HistoryResult } from "./history";
import type { LocationRequest } from "./locations";

// Browser-side helpers for our own API. Types are imported type-only, so no server code ships.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // fall through
  }
  if (!response.ok) {
    const err = (body as { error?: { message?: string; code?: string; retryAfterSeconds?: number } } | null)?.error;
    throw new ApiError(
      err?.message ?? `Request failed (${response.status}). Please try again.`,
      response.status,
      err?.code ?? "unknown",
      err?.retryAfterSeconds,
    );
  }
  return body as T;
}

export async function startCheck(url: string, locations: LocationRequest): Promise<{ checkId: string; hostname: string; reused: boolean }> {
  let response: Response;
  try {
    response = await fetch("/api/checks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, locations }),
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0, "network");
  }
  return parse(response);
}

export async function fetchCheck(id: string, signal?: AbortSignal): Promise<CheckView> {
  const response = await fetch(`/api/checks/${encodeURIComponent(id)}`, { signal, cache: "no-store" });
  return parse(response);
}

export interface HistoryFilters {
  from?: string;
  to?: string;
  country?: string;
  city?: string;
  asn?: string;
  networkType?: string;
}

/** `version` changes whenever new results exist, so cached responses are bypassed. */
export async function fetchHistory(hostname: string, filters: HistoryFilters, version: number, signal?: AbortSignal): Promise<HistoryResult> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  if (version > 0) params.set("v", String(version));
  const response = await fetch(`/api/sites/${encodeURIComponent(hostname)}/history?${params}`, { signal });
  return parse(response);
}
