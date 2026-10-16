import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

/** A WooCommerce answer: the JSON body and the paging headers. */
type Answer = { body: unknown; total?: number; totalPages?: number };
type Route = (path: string, query: Record<string, unknown>) => Answer | Promise<Answer>;

let route: Route = () => ({ body: [] });
const requests: { path: string; query: Record<string, unknown> }[] = [];

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("./client", () => ({
  wooRequest: async (path: string, options: { query?: Record<string, unknown>; schema: z.ZodType }) => {
    const query = options.query ?? {};
    requests.push({ path, query });
    const answer = await route(path, query);
    const headers = new Headers();
    if (answer.total !== undefined) headers.set("x-wp-total", String(answer.total));
    if (answer.totalPages !== undefined) headers.set("x-wp-totalpages", String(answer.totalPages));
    return { status: 200, data: options.schema.parse(answer.body), headers };
  },
}));

const { getProducts } = await import("./products");

beforeEach(() => {
  requests.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getProducts", () => {
  it("sorts 'Anbefalet' by the shop's merchandising order and 'Nyeste' by date", async () => {
    route = () => ({ body: [], total: 0, totalPages: 0 });
    await getProducts();
    expect(requests[0]?.query).toMatchObject({ orderby: "menu_order", order: "asc" });
    await getProducts({ sort: "nyeste" });
    expect(requests[1]?.query).toMatchObject({ orderby: "date", order: "desc" });
  });
});
