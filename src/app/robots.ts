import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Read SITE_URL at request time rather than baking in whatever was set at build.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
