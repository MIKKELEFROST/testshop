import { describe, expect, it } from "vitest";
import { cartReducer, deserializeCart, savedSubtotal, serializeCart, type CartLine } from "./cart";

const tshirt = { productId: 10, variationId: 0, name: "T-shirt", slug: "t-shirt", unitPrice: "249.00", maxQuantity: 25, quantity: 1 };
const hoodieM = { productId: 14, variationId: 16, name: "Hættetrøje", slug: "hood", variantLabel: "Størrelse: M", unitPrice: "449.00", maxQuantity: 2, quantity: 1 };
const hoodieS = { ...hoodieM, variationId: 15, variantLabel: "Størrelse: S", maxQuantity: 5 };

describe("cart reducer", () => {
  it("adds products and merges the same product/variation", () => {
    let lines: CartLine[] = [];
    lines = cartReducer(lines, { type: "add", line: tshirt });
    lines = cartReducer(lines, { type: "add", line: { ...tshirt, quantity: 2 } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ key: "10:0", quantity: 3 });
  });

  it("keeps different variations of the same product apart", () => {
    let lines: CartLine[] = [];
    lines = cartReducer(lines, { type: "add", line: hoodieM });
    lines = cartReducer(lines, { type: "add", line: hoodieS });
    expect(lines.map((l) => l.key)).toEqual(["14:16", "14:15"]);
  });

  it("never exceeds known stock when adding", () => {
    let lines: CartLine[] = [];
    lines = cartReducer(lines, { type: "add", line: { ...hoodieM, quantity: 5 } });
    expect(lines[0]!.quantity).toBe(2);
    lines = cartReducer(lines, { type: "add", line: hoodieM });
    expect(lines[0]!.quantity).toBe(2);
  });

  it("does not add sold-out products", () => {
    expect(cartReducer([], { type: "add", line: { ...hoodieM, maxQuantity: 0 } })).toEqual([]);
  });

  it("changes quantity and removes a line at zero", () => {
    let lines = cartReducer([], { type: "add", line: tshirt });
    lines = cartReducer(lines, { type: "setQuantity", key: "10:0", quantity: 4 });
    expect(lines[0]!.quantity).toBe(4);
    lines = cartReducer(lines, { type: "setQuantity", key: "10:0", quantity: 0 });
    expect(lines).toEqual([]);
  });

  it("caps quantity at 99 and removes lines", () => {
    let lines = cartReducer([], { type: "add", line: { ...tshirt, maxQuantity: null } });
    lines = cartReducer(lines, { type: "setQuantity", key: "10:0", quantity: 500 });
    expect(lines[0]!.quantity).toBe(99);
    lines = cartReducer(lines, { type: "remove", key: "10:0" });
    expect(lines).toEqual([]);
  });
});

describe("cart persistence", () => {
  it("round-trips through storage", () => {
    const lines = cartReducer(cartReducer([], { type: "add", line: tshirt }), { type: "add", line: hoodieM });
    expect(deserializeCart(serializeCart(lines))).toEqual(lines);
  });

  it("treats corrupt or tampered storage as an empty cart", () => {
    expect(deserializeCart("not json")).toEqual([]);
    expect(deserializeCart(JSON.stringify({ version: 2, lines: [] }))).toEqual([]);
    expect(
      deserializeCart(JSON.stringify({ version: 1, lines: [{ ...tshirt, quantity: -5 }] })),
    ).toEqual([]);
    expect(
      deserializeCart(JSON.stringify({ version: 1, lines: [{ ...tshirt, productId: "10; DROP" }] })),
    ).toEqual([]);
  });

  it("drops duplicate lines from storage", () => {
    const raw = JSON.stringify({ version: 1, lines: [tshirt, { ...tshirt, quantity: 3 }] });
    expect(deserializeCart(raw)).toHaveLength(1);
  });
});

describe("saved subtotal", () => {
  it("adds up the prices saved in the cart, or gives up when one is unknown", () => {
    let lines: CartLine[] = [];
    lines = cartReducer(lines, { type: "add", line: { ...tshirt, quantity: 2 } });
    lines = cartReducer(lines, { type: "add", line: hoodieM });
    expect(savedSubtotal(lines)).toBe("947.00");
    expect(savedSubtotal([])).toBeNull();
    expect(savedSubtotal(cartReducer(lines, { type: "add", line: { ...hoodieS, unitPrice: null } }))).toBeNull();
  });
});
