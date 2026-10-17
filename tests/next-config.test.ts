import { afterEach, describe, expect, it, vi } from "vitest";
import { WORDPRESS_MOVE_HOSTS } from "../src/config/images";

/** next.config.ts's image hosts when built with this WOOCOMMERCE_URL (it reads it when loaded). */
async function remotePatterns(wooUrl: string | undefined) {
  vi.stubEnv("WOOCOMMERCE_URL", wooUrl);
  vi.resetModules();
  const { default: config } = await import("../next.config");
  return config.images?.remotePatterns;
}

const everything = (hostname: string) => ({ protocol: "https", hostname, port: "", pathname: "/**" });
const uploads = (hostname: string) => ({ protocol: "https", hostname, port: "", pathname: "/wp-content/uploads/**" });
const supplier = { protocol: "https", hostname: "marketing.guirca.com", pathname: "/**" };
/** The move's hosts besides WOOCOMMERCE_URL's own, read from the list, so the tests still pass once it is emptied. */
const moveUploads = (wooHost?: string) => WORDPRESS_MOVE_HOSTS.filter((hostname) => hostname !== wooHost).map(uploads);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config.ts image hosts", () => {
  it("allows the uploads of the move's other WordPress hosts, whichever one WOOCOMMERCE_URL names, each host once", async () => {
    const forOld = await remotePatterns("https://test.piece.dk");
    const forNew = await remotePatterns("https://admin.onlinemarketing.nu/");
    expect(forOld).toEqual([everything("test.piece.dk"), ...moveUploads("test.piece.dk"), supplier]);
    expect(forNew).toEqual([everything("admin.onlinemarketing.nu"), ...moveUploads("admin.onlinemarketing.nu"), supplier]);
    for (const patterns of [forOld, forNew]) {
      const hostnames = patterns!.map((remote) => remote.hostname);
      expect(new Set(hostnames).size).toBe(hostnames.length);
    }
  });

  it("keeps them without WOOCOMMERCE_URL, and next to another host such as the local test shop", async () => {
    expect(await remotePatterns(undefined)).toEqual([...moveUploads(), supplier]);
    expect(await remotePatterns("http://localhost:8080")).toEqual([
      { protocol: "http", hostname: "localhost", port: "8080", pathname: "/**" },
      ...moveUploads(),
      supplier,
    ]);
  });
});
