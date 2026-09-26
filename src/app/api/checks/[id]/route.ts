import type { NextRequest } from "next/server";
import { getCheck } from "@/lib/checks";
import { hasDatabase } from "@/lib/config";
import { getDeps, getQuickDeps } from "@/lib/deps";
import { AppError, errorResponse } from "@/lib/errors";
import { getQuickCheck } from "@/lib/quick-check";

/** Current state of a check. Clients poll this until `status` is no longer "pending". */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/checks/[id]">) {
  try {
    const { id } = await ctx.params;
    const view = hasDatabase() ? await getCheck(getDeps(), id) : await getQuickCheck(getQuickDeps().globalping, id);
    if (!view) throw new AppError("not_found", 404, "Check not found.");
    return Response.json(view, {
      headers: {
        // Finished checks never change; let CDNs/browsers cache them. Pending ones must not be cached.
        "Cache-Control": view.status === "pending" ? "no-store" : "public, max-age=300, s-maxage=86400",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
