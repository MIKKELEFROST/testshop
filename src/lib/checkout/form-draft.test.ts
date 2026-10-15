import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCheckoutDraft, draftStorageKey, loadCheckoutDraft, parseDraft, saveCheckoutDraft, serializeDraft, type CheckoutDraft } from "./form-draft";

const address = { firstName: "Mikkel", lastName: "Frost", company: "", address1: "Testvej 1", address2: "", postcode: "8000", city: "Aarhus C", country: "DK" };
const draft: CheckoutDraft = {
  contact: { email: "kunde@example.com", phone: "" },
  shipping: address,
  billingSame: true,
  billing: { ...address, firstName: "", lastName: "", address1: "", postcode: "", city: "" },
  note: "Stil pakken ved døren",
};

/** A sessionStorage stand-in on `window`, as in the browser. */
function stubSession(storage: Partial<Storage>) {
  vi.stubGlobal("window", { sessionStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkout form draft", () => {
  it("survives a round trip, also while it is half typed", () => {
    expect(parseDraft(serializeDraft(draft))).toEqual(draft);
    const halfTyped = { ...draft, shipping: { ...address, postcode: "80", city: "" } };
    expect(parseDraft(serializeDraft(halfTyped))).toEqual(halfTyped);
  });

  it("gives no draft for corrupt, outdated or tampered storage", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, version: 2 }))).toBeNull();
    expect(parseDraft(JSON.stringify({ version: 1, ...draft, billingSame: "yes" }))).toBeNull();
    expect(parseDraft(JSON.stringify({ version: 1, ...draft, note: "x".repeat(501) }))).toBeNull();
    expect(parseDraft(JSON.stringify({ version: 1, ...draft, shipping: { ...address, postcode: "<b>" } }))).toBeNull();
    expect(parseDraft(JSON.stringify({ version: 1, ...draft, shipping: { ...address, country: "NO" } }))).toBeNull();
  });

  it("is kept per shop in sessionStorage and cleared after an order", () => {
    const data = new Map<string, string>();
    stubSession({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    });
    saveCheckoutDraft(draft, "piece-dk");
    expect([...data.keys()]).toEqual([draftStorageKey("piece-dk")]);
    expect(loadCheckoutDraft("piece-dk")).toEqual(draft);
    expect(loadCheckoutDraft("halloween-kostumer-dk")).toBeNull();
    clearCheckoutDraft("piece-dk");
    expect(loadCheckoutDraft("piece-dk")).toBeNull();
  });

  it("never throws without storage (server, private mode, blocked or full)", () => {
    expect(loadCheckoutDraft("piece-dk")).toBeNull(); // No window, as on the server.
    const fail = () => {
      throw new Error("SecurityError");
    };
    stubSession({ getItem: fail, setItem: fail, removeItem: fail });
    expect(loadCheckoutDraft("piece-dk")).toBeNull();
    expect(() => saveCheckoutDraft(draft, "piece-dk")).not.toThrow();
    expect(() => clearCheckoutDraft("piece-dk")).not.toThrow();
  });
});
