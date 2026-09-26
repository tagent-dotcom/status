import type { NextRequest } from "next/server";
import { hasDatabase } from "@/lib/config";
import { getDeps } from "@/lib/deps";
import { AppError, errorResponse } from "@/lib/errors";
import { getHistory, historyQuerySchema } from "@/lib/history";
import { parseHostnameSlug } from "@/lib/target";

/**
 * Aggregated history for a site. Query: from, to (ISO dates, max 90 days apart, default last
 * 7 days), country (ISO alpha-2), city (requires country), asn, networkType (eyeball|datacenter).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/sites/[hostname]/history">) {
  try {
    if (!hasDatabase()) throw new AppError("not_found", 404, "History isn't enabled on this server.");
    const { hostname: slug } = await ctx.params;
    const hostname = parseHostnameSlug(slug);
    if (!hostname) throw new AppError("not_found", 404, "Unknown site.");

    const raw = Object.fromEntries([...request.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const parsed = historyQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("invalid_request", 400, parsed.error.issues[0]?.message ?? "Invalid filters.");
    }

    const history = await getHistory(getDeps().sql, hostname, parsed.data);
    if (!history) throw new AppError("not_found", 404, "This site hasn't been checked yet.");
    // Browsers always revalidate (so a just-finished check shows up immediately); shared caches
    // may serve it briefly to absorb traffic spikes on popular pages. Clients add a version
    // parameter after each finished check to skip those.
    return Response.json(history, { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" } });
  } catch (error) {
    return errorResponse(error);
  }
}
