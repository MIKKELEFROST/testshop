import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/** Everything may be indexed except the cart, checkout, search results, favourites and the API. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/kurv", "/checkout", "/ordre/", "/soeg", "/favoritter", "/api/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
