import { describe, expect, it } from "vitest";
import { fillTokens, parseText, safeHref } from "./info-text";

describe("information page text", () => {
  it("fills in tokens and leaves unknown ones", () => {
    expect(fillTokens("Skriv til {email} hos {shop} ({ukendt})", { email: "a@b.dk", shop: "Halloweenkostumer.dk" })).toBe(
      "Skriv til a@b.dk hos Halloweenkostumer.dk ({ukendt})",
    );
  });

  it("splits text into links, placeholders and plain text", () => {
    expect(parseText("Læs [returret](/fortrydelsesret) og ring [Telefonnummer] nu.")).toEqual([
      { kind: "text", text: "Læs " },
      { kind: "link", text: "returret", href: "/fortrydelsesret" },
      { kind: "text", text: " og ring " },
      { kind: "placeholder", text: "[Telefonnummer]" },
      { kind: "text", text: " nu." },
    ]);
  });

  it("only allows safe link targets", () => {
    expect(safeHref("/kontakt")).toBe("/kontakt");
    expect(safeHref("mailto:a@b.dk")).toBe("mailto:a@b.dk");
    expect(safeHref("https://naevneneshus.dk")).toBe("https://naevneneshus.dk");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("http://insecure.example")).toBeNull();
  });
});
