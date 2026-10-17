#!/usr/bin/env node
/**
 * Warms a shop after a deploy. A deploy starts with an empty catalogue cache (the cache's keys
 * include the build), so until a page has been viewed once its products are read from
 * WooCommerce while the visitor waits. This views the pages most visitors and search engines
 * start from: the front page, the themes, "Alle produkter", page 1 of every category and theme
 * in the sitemap, and the products those pages show (up to --products). Afterwards those reads
 * are kept for 30 days (src/lib/woocommerce/cache.ts).
 *
 *   node scripts/warm.mjs https://fastelavnskostumer.dk [--products 300] [--concurrency 2]
 *
 * Two pages at a time, so the WordPress host is asked gently, and it stops at the first page
 * that could not read WooCommerce (HTTP 5xx, or the page's "Vi henter …" retry state): the host
 * is then overloaded, and warming would only add to it. Run it again later.
 *
 * Only GET requests; it never touches the cart, the checkout or a payment.
 */
import { pathToFileURL } from "node:url";

const USER_AGENT = "Mozilla/5.0 (compatible; ShopWarmup/1.0; +scripts/warm.mjs)";
/** Text of the page's retry state (src/components/ui/catalog-retry.tsx): WooCommerce could not be read. */
const RETRYING = /Vi (henter|søger) [^<]{0,20}…/;

/**
 * The category and theme pages (page 1) in a sitemap.xml. The sitemap lists only the shop's own
 * pages, under its public domain, so their paths are taken whatever address is warmed (e.g. a
 * production deployment's own address).
 */
export function listingPaths(sitemap) {
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => {
      try {
        return new URL(m[1].trim()).pathname;
      } catch {
        return null;
      }
    })
    .filter((path) => path !== null && /^\/(kategori|tema)\/[^/]+$/.test(path));
  return [...new Set(paths)];
}

/** The product pages a page links to, in the order they appear. */
export function productPaths(html) {
  return [...new Set([...html.matchAll(/href="(\/produkter\/[a-z0-9-]+)"/g)].map((m) => m[1]))];
}

/** Whether a page could not read WooCommerce: a server error, or the page's retry state. */
export function failed(status, html) {
  return status >= 500 || RETRYING.test(html);
}

function parseArgs(argv) {
  const [base, ...rest] = argv;
  const option = (name, fallback) => {
    const i = rest.indexOf(`--${name}`);
    const value = i >= 0 ? Number(rest[i + 1]) : fallback;
    if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a whole number`);
    return value;
  };
  if (!base) throw new Error("usage: node scripts/warm.mjs https://<shop> [--products 300] [--concurrency 2]");
  const origin = new URL(base).origin;
  return { origin, products: option("products", 300), concurrency: Math.min(option("concurrency", 2), 4) };
}

async function view(origin, path) {
  const started = Date.now();
  const response = await fetch(origin + path, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, redirect: "follow" });
  const html = await response.text();
  return { status: response.status, html, ms: Date.now() - started };
}

/** Views the paths, `concurrency` at a time; stops (and returns false) at the first failed page. */
async function viewAll(origin, paths, concurrency, onPage) {
  let next = 0;
  let stopped = false;
  async function worker() {
    while (!stopped && next < paths.length) {
      const path = paths[next++];
      const page = await view(origin, path).catch((error) => ({ status: 0, html: "", ms: 0, error }));
      const bad = page.status === 0 || failed(page.status, page.html);
      console.log(`${bad ? "FAILED" : "ok    "} ${String(page.status).padStart(3)} ${String(page.ms).padStart(6)} ms  ${path}`);
      if (bad) stopped = true;
      else onPage?.(path, page.html);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return !stopped;
}

async function main() {
  const { origin, products, concurrency } = parseArgs(process.argv.slice(2));
  const sitemap = await view(origin, "/sitemap.xml");
  if (sitemap.status !== 200) throw new Error(`${origin}/sitemap.xml answered ${sitemap.status}`);
  const found = [];
  const collect = (_path, html) => {
    for (const path of productPaths(html)) if (!found.includes(path)) found.push(path);
  };
  const listings = ["/", "/tema", "/produkter", ...listingPaths(sitemap.html)];
  console.log(`Warming ${origin}: ${listings.length} pages, then up to ${products} products, ${concurrency} at a time.`);
  if (!(await viewAll(origin, listings, concurrency, collect))) {
    console.error("Stopped: a page could not read WooCommerce. Try again in a few minutes.");
    process.exit(1);
  }
  if (!(await viewAll(origin, found.slice(0, products), concurrency))) {
    console.error("Stopped: a product page could not read WooCommerce. Try again in a few minutes.");
    process.exit(1);
  }
  console.log(`Done: ${listings.length} pages and ${Math.min(found.length, products)} products.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
