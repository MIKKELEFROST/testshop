import type { NextConfig } from "next";
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import { SUPPLIER_IMAGE_HOSTS } from "./src/config/images";

/** Product images are served from the WooCommerce host (and supplier hosts, see src/config/images.ts). */
function wooImagePattern() {
  try {
    const url = new URL(process.env.WOOCOMMERCE_URL ?? "");
    return { protocol: url.protocol.replace(":", "") as "http" | "https", hostname: url.hostname, port: url.port, pathname: "/**" };
  } catch {
    return null;
  }
}

const pattern = wooImagePattern();
const isLocalBackend = pattern?.hostname === "localhost" || pattern?.hostname === "127.0.0.1";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")' },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Next.js's list of crawlers that get a page's metadata before the page, plus Google's search
  // crawler. The metadata can then set the status: a real 404 for an unknown product, category
  // or theme, or a page past the last one, instead of a 200 "not found" page. Visitors still
  // get the page streamed.
  htmlLimitedBots: new RegExp(`${HTML_LIMITED_BOT_UA_RE.source}|Googlebot`, "i"),
  images: {
    remotePatterns: [
      ...(pattern ? [pattern] : []),
      ...SUPPLIER_IMAGE_HOSTS.map((hostname) => ({ protocol: "https" as const, hostname, pathname: "/**" })),
    ],
    // Product photos rarely change: keep optimized copies for 31 days, which also keeps the
    // number of image transformations (limited on Vercel's Hobby plan) down.
    minimumCacheTTL: 2678400,
    // The image optimizer refuses private hosts; the local Docker test shop is served as-is.
    unoptimized: isLocalBackend,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
