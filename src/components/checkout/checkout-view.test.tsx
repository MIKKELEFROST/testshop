// @vitest-environment jsdom
import { Activity, act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storeConfig } from "@/config/store";
import type { CartLine } from "@/lib/cart/cart";
import { draftStorageKey, serializeDraft, type CheckoutDraft } from "@/lib/checkout/form-draft";
import type { ClientQuote } from "@/lib/checkout/quote";
import { CheckoutView } from "./checkout-view";

/**
 * The checkout form in a browser-like DOM, with Stripe, the router and the cart stubbed: what
 * the customer sees across a payment and Next.js's <Activity> (a hidden route keeps its state).
 */

const stubs = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() },
  stripe: { confirmPayment: vi.fn() },
  elements: { submit: vi.fn(async () => ({})), update: vi.fn() },
  lines: [] as CartLine[],
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: ReactNode }) => children,
  PaymentElement: function PaymentElement({ onReady }: { onReady?: () => void }) {
    useEffect(() => onReady?.(), [onReady]);
    return null;
  },
  ExpressCheckoutElement: () => null,
  useStripe: () => stubs.stripe,
  useElements: () => stubs.elements,
}));
vi.mock("next/navigation", () => ({ useRouter: () => stubs.router, usePathname: () => "/checkout" }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean }) => {
    void prefetch;
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));
vi.mock("@/lib/stripe/client", () => ({ getStripeClient: () => Promise.resolve({}) }));
vi.mock("@/components/cart/cart-provider", () => ({ useCart: () => ({ lines: stubs.lines, hydrated: true }) }));
vi.mock("@/components/marketing/trustbox", () => ({ TrustBox: () => null }));
vi.mock("@/components/products/product-image", () => ({ ProductImage: () => null }));

const line: CartLine = { key: "10:0", productId: 10, variationId: 0, quantity: 1, name: "Pirat-kostume", slug: "pirat", unitPrice: "199.00", maxQuantity: null };

const quote: ClientQuote = {
  currency: "DKK",
  taxDisplay: "incl",
  needsShipping: true,
  items: [{ productId: 10, variationId: 0, name: "Pirat-kostume", sku: "P1", quantity: 1, unitPrice: "199.00", lineTotal: "199.00", stockQuantity: null }],
  shippingRates: [{ id: "flat_rate:1", label: "PostNord pakkeshop", price: "39.00" }],
  shippingRateId: "flat_rate:1",
  totals: { subtotal: "199.00", discount: "0.00", shipping: "39.00", tax: "47.60", total: "238.00" },
  errors: [],
  couponsEnabled: false,
  coupons: [],
  couponErrors: [],
};

const address = { firstName: "Test", lastName: "Kunde", company: "", address1: "Testvej 1", address2: "", postcode: "8000", city: "Aarhus C", country: "DK" };
const draft: CheckoutDraft = { contact: { email: "kunde@example.com", phone: "" }, shipping: address, billingSame: true, billing: address, note: "" };

let container: HTMLDivElement;
let root: Root;
let quoteBodies: Record<string, unknown>[];

function render(mode: "visible" | "hidden") {
  act(() => {
    root.render(
      <Activity mode={mode}>
        <CheckoutView />
      </Activity>,
    );
  });
}

async function waitFor(check: () => boolean, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const payButton = () => [...container.querySelectorAll("button[type=submit]")][0] as HTMLButtonElement;
const field = (name: string) => container.querySelector(`[name="${name}"]`) as HTMLInputElement;
const errorOf = (name: string) => container.querySelector(`[id="${name}-error"]`)?.textContent ?? null;

/** What a keystroke does: React reads the new value from an input event. */
function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function blur(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  stubs.lines = [line];
  stubs.router.push.mockReset();
  stubs.stripe.confirmPayment.mockReset();
  stubs.elements.update.mockReset();
  quoteBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/checkout/quote") {
        quoteBodies.push(JSON.parse(String(init?.body)));
        return Response.json(quote);
      }
      if (url === "/api/checkout") {
        return Response.json({ type: "ready", clientSecret: "pi_1_secret_x", returnPath: "/ordre/bekraeftelse?order=101&key=wc_order_abc", order: { id: 101, number: "101", total: "238.00" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("CheckoutView", () => {
  it("can pay again after a completed payment when Next.js shows the hidden checkout again", async () => {
    window.sessionStorage.setItem(draftStorageKey(storeConfig.id), serializeDraft(draft));
    stubs.stripe.confirmPayment.mockResolvedValue({ paymentIntent: { id: "pi_1", status: "requires_capture" } });
    render("visible");
    await waitFor(() => payButton() !== undefined && !payButton().disabled, "the pay button");

    act(() => payButton().click());
    await waitFor(() => stubs.router.push.mock.calls.length > 0, "the confirmation");
    expect(stubs.router.push).toHaveBeenCalledWith("/ordre/bekraeftelse?order=101&key=wc_order_abc&payment_intent=pi_1");

    // The customer goes on to the confirmation (the checkout is hidden), later back with a new cart.
    render("hidden");
    render("visible");
    await waitFor(() => !payButton().disabled, "the pay button again");
    expect(payButton().textContent).toBe("Betal nu");
  });

  it("clears a field's error as soon as the value is valid, not first on blur", async () => {
    render("visible");
    await waitFor(() => field("shipping.postcode") !== null, "the form");
    const postcode = field("shipping.postcode");
    type(postcode, "80");
    blur(postcode);
    expect(errorOf("shipping.postcode")).toBe("Postnummeret skal være 4 cifre.");
    type(postcode, "800");
    expect(errorOf("shipping.postcode")).toBe("Postnummeret skal være 4 cifre.");
    type(postcode, "8000");
    expect(errorOf("shipping.postcode")).toBeNull();

    const firstName = field("shipping.firstName");
    blur(firstName);
    expect(errorOf("shipping.firstName")).toBe("Fornavn skal udfyldes.");
    type(firstName, "T");
    expect(errorOf("shipping.firstName")).toBeNull();
  });

  it("says at once that Greenland is not delivered to", async () => {
    render("visible");
    await waitFor(() => field("shipping.postcode") !== null, "the form");
    type(field("shipping.postcode"), "3900");
    expect(errorOf("shipping.postcode")).toBe("Vi leverer ikke til Grønland og Færøerne.");
  });

  it("asks for a quote by country and postcode only, not on every keystroke in the street", async () => {
    window.sessionStorage.setItem(draftStorageKey(storeConfig.id), serializeDraft(draft));
    render("visible");
    await waitFor(() => quoteBodies.length > 0, "the first quote");
    expect(quoteBodies[0]!.address).toEqual({ country: "DK", postcode: "8000" });

    type(field("shipping.address1"), "Vesterbrogade 12");
    type(field("shipping.city"), "Aarhus");
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(quoteBodies).toHaveLength(1);
  });

  it("keeps the place of the wallet buttons from the first render, before the quote", async () => {
    let answer: ((response: Response) => void) | null = null;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    render("visible");
    await waitFor(() => container.querySelector("form") !== null, "the form");
    const form = container.querySelector("form")!;
    expect(form.firstElementChild?.getAttribute("aria-labelledby")).toBe("hurtig-betaling");
    await waitFor(() => answer !== null, "the quote request");
    await act(async () => answer!(Response.json(quote)));
    await waitFor(() => container.textContent!.includes("238,00"), "the quote");
    expect(container.querySelector("form")!.firstElementChild?.getAttribute("aria-labelledby")).toBe("hurtig-betaling");
  });
});
