import type { NextRequest } from "next/server";
import { createCheck } from "@/lib/checks";
import { clientIp, hashIp } from "@/lib/client-ip";
import { getDeps } from "@/lib/deps";
import { AppError, errorResponse } from "@/lib/errors";

const MAX_BODY_BYTES = 16 * 1024;

/** Reads the body as text, refusing more than `max` bytes without buffering the excess. */
async function readBodyLimited(request: NextRequest, max: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) throw new AppError("invalid_request", 413, "Request body is too large.");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new AppError("invalid_request", 413, "Request body is too large.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Starts a check. Body: { url: string, locations?: LocationRequest }.
 * 201 with a new check, or 200 when an identical check from the last minute is reused.
 */
export async function POST(request: NextRequest) {
  try {
    const deps = getDeps();
    const text = await readBodyLimited(request, MAX_BODY_BYTES);

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AppError("invalid_request", 400, "Request body must be JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AppError("invalid_request", 400, "Request body must be a JSON object.");
    }
    const { url, locations } = body as { url?: unknown; locations?: unknown };

    const clientHash = hashIp(clientIp(request.headers, deps.config.TRUST_PROXY_HEADERS), deps.config.IP_HASH_SECRET);
    const result = await createCheck(deps, { url, locations, clientHash });
    return Response.json(result, {
      status: result.reused ? 200 : 201,
      headers: { "Cache-Control": "no-store", Location: `/api/checks/${result.checkId}` },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
