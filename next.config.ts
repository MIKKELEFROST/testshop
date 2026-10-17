import type { NextConfig } from "next";
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import { SUPPLIER_IMAGE_HOSTS, WORDPRESS_MOVE_HOSTS } from "./src/config/images";

/**
 * Product images are served from the WooCommerce host's uploads (and supplier hosts, see
 * src/config/images.ts). Only that path and no query string (`search: ""`): with any path the
 * image optimizer could be made to fetch any page of the fragile WordPress host
 * (/?s=…, /wp-login.php …), past the shop's rate limits and read breaker.
 */
function wooImagePattern() {
  try {
    const url = new URL(process.env.WOOCOMMERCE_URL ?? "");
    const basePath = url.pathname.replace(/\/+$/, "");
    return {
      protocol: url.protocol.replace(":", "") as "http" | "https",
      hostname: url.hostname,
      port: url.port,
      pathname: `${basePath}/wp-content/uploads/**`,
      search: "",
    };
  } catch {
    return null;
  }
}

const pattern = wooImagePattern();
const isLocalBackend = pattern?.hostname === "localhost" || pattern?.hostname === "127.0.0.1";

/**
 * Content Security Policy without nonces, so pages stay static and cacheable (cacheComponents,
 * partial prerendering): see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md,
 * "Without Nonces". Next.js's own inline scripts need 'unsafe-inline'; what the policy adds is
 * that scripts, frames, connections and form posts can only go to the shop and the services
 * it uses: Stripe (payment form, Apple Pay and Google Pay, 3-D Secure, its hCaptcha check),
 * Trustpilot's TrustBoxes and YouTube's privacy-enhanced player.
 *
 * Sent as Content-Security-Policy-Report-Only for now: the browser only reports what the
 * policy would block (in the console). Switch the header to Content-Security-Policy once the
 * checkout, the wallets and a 3-D Secure card have been paid through without reports.
 */
const isDev = process.env.NODE_ENV === "development";
const STRIPE = "https://js.stripe.com https://*.js.stripe.com";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${STRIPE} https://pay.google.com https://widget.trustpilot.com https://*.hcaptcha.com https://hcaptcha.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.stripe.com https://merchant-ui-api.stripe.com https://*.stripe.com https://m.stripe.network https://pay.google.com https://widget.trustpilot.com https://*.hcaptcha.com https://hcaptcha.com",
  `frame-src ${STRIPE} https://hooks.stripe.com https://m.stripe.network https://pay.google.com https://widget.trustpilot.com https://www.youtube-nocookie.com https://*.hcaptcha.com https://hcaptcha.com`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
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
      // The move's other WordPress host (WOOCOMMERCE_URL's own is allowed above), its uploads only.
      ...WORDPRESS_MOVE_HOSTS.filter((hostname) => hostname !== pattern?.hostname).map((hostname) => ({
        protocol: "https" as const,
        hostname,
        port: "",
        pathname: "/wp-content/uploads/**",
        search: "",
      })),
      // The supplier's photo links carry no query string either.
      ...SUPPLIER_IMAGE_HOSTS.map((hostname) => ({ protocol: "https" as const, hostname, pathname: "/**", search: "" })),
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
  async rewrites() {
    // Browsers, bookmark tools and crawlers ask for /favicon.ico by themselves: the brand's own
    // icon (app/icon.tsx, a PNG, which browsers take at that address too), not the 404 page.
    return [{ source: "/favicon.ico", destination: "/icon" }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The projects' *.vercel.app addresses (and the previews) serve the whole shop too: keep
      // them out of search engines, which should only know the shops' own domains.
      { source: "/:path*", has: [{ type: "host", value: "(?<host>.+)\\.vercel\\.app" }], headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
