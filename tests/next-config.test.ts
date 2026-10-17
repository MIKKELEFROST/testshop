import { afterEach, describe, expect, it, vi } from "vitest";
import { WORDPRESS_MOVE_HOSTS } from "../src/config/images";

/** next.config.ts's image hosts when built with this WOOCOMMERCE_URL (it reads it when loaded). */
async function remotePatterns(wooUrl: string | undefined) {
  vi.stubEnv("WOOCOMMERCE_URL", wooUrl);
  vi.resetModules();
  const { default: config } = await import("../next.config");
  return config.images?.remotePatterns;
}

const uploads = (hostname: string) => ({ protocol: "https", hostname, port: "", pathname: "/wp-content/uploads/**", search: "" });
const supplier = { protocol: "https", hostname: "marketing.guirca.com", pathname: "/**", search: "" };
/** The move's hosts besides WOOCOMMERCE_URL's own, read from the list, so the tests still pass once it is emptied. */
const moveUploads = (wooHost?: string) => WORDPRESS_MOVE_HOSTS.filter((hostname) => hostname !== wooHost).map(uploads);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config.ts image hosts", () => {
  it("allows the uploads of the move's other WordPress hosts, whichever one WOOCOMMERCE_URL names, each host once", async () => {
    const forOld = await remotePatterns("https://test.piece.dk");
    const forNew = await remotePatterns("https://admin.onlinemarketing.nu/");
    expect(forOld).toEqual([uploads("test.piece.dk"), ...moveUploads("test.piece.dk"), supplier]);
    expect(forNew).toEqual([uploads("admin.onlinemarketing.nu"), ...moveUploads("admin.onlinemarketing.nu"), supplier]);
    for (const patterns of [forOld, forNew]) {
      const hostnames = patterns!.map((remote) => remote.hostname);
      expect(new Set(hostnames).size).toBe(hostnames.length);
    }
  });

  it("keeps them without WOOCOMMERCE_URL, and next to another host such as the local test shop", async () => {
    expect(await remotePatterns(undefined)).toEqual([...moveUploads(), supplier]);
    expect(await remotePatterns("http://localhost:8080")).toEqual([
      { protocol: "http", hostname: "localhost", port: "8080", pathname: "/wp-content/uploads/**", search: "" },
      ...moveUploads(),
      supplier,
    ]);
  });

  it("lets the image optimizer fetch only uploads, without a query string, from the WordPress host (also below a base path)", async () => {
    const [woo] = (await remotePatterns("https://admin.onlinemarketing.nu/wordpress/"))!;
    expect(woo).toMatchObject({ hostname: "admin.onlinemarketing.nu", pathname: "/wordpress/wp-content/uploads/**", search: "" });
    for (const remote of (await remotePatterns("https://admin.onlinemarketing.nu"))!) {
      expect(remote.search, remote.hostname).toBe("");
      if (remote.hostname !== "marketing.guirca.com") expect(remote.pathname, remote.hostname).toBe("/wp-content/uploads/**");
    }
  });
});

describe("next.config.ts security headers", () => {
  it("reports what a static Content-Security-Policy would block, with the shop's payment, review and video services allowed", async () => {
    vi.resetModules();
    const { default: config } = await import("../next.config");
    const rules = await config.headers!();
    const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy-Report-Only")?.value ?? "";
    for (const directive of ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"]) expect(csp).toContain(directive);
    expect(csp).toMatch(/script-src [^;]*https:\/\/js\.stripe\.com[^;]*https:\/\/widget\.trustpilot\.com/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/www\.youtube-nocookie\.com/);
    // Not enforced yet: nothing is blocked until the checkout has been tested with it.
    expect(rules[0]!.headers.some((h) => h.key === "Content-Security-Policy")).toBe(false);
  });
});

describe("next.config.ts rewrites", () => {
  it("answers /favicon.ico with the brand's icon", async () => {
    vi.resetModules();
    const { default: config } = await import("../next.config");
    expect(await config.rewrites!()).toEqual([{ source: "/favicon.ico", destination: "/icon" }]);
  });
});
