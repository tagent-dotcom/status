export type AppErrorCode =
  | "invalid_target"
  | "invalid_locations"
  | "invalid_request"
  | "private_address"
  | "rate_limited"
  | "capacity"
  | "no_probes"
  | "probe_network_error"
  | "not_found";

/** An error whose message is safe to show to end users. */
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (error.retryAfterSeconds !== undefined) headers["Retry-After"] = String(Math.ceil(error.retryAfterSeconds));
    return Response.json(
      { error: { code: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds } },
      { status: error.status, headers },
    );
  }
  console.error("Unhandled error", error);
  return Response.json(
    { error: { code: "internal", message: "Something went wrong on our side. Please try again." } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
