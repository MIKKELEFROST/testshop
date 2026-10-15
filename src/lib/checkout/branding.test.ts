import { describe, expect, it } from "vitest";
import { storeConfig } from "@/config/store";
import { DEFAULT_EMAIL_COLOR, storeBranding } from "./branding";

const maskerade = { name: "Halloweenkostumer.dk", supportEmail: "kundeservice@halloweenkostumer.dk", theme: { action: "#5b2b82" } };

describe("storeBranding", () => {
  it("sends the brand's name, e-mail, colour, address and the logo on the storefront", () => {
    expect(storeBranding(maskerade, "https://halloweenkostumer.dk")).toEqual({
      name: "Halloweenkostumer.dk",
      url: "https://halloweenkostumer.dk",
      email: "kundeservice@halloweenkostumer.dk",
      color: "#5b2b82",
      logo: "https://halloweenkostumer.dk/email-logo.png",
    });
  });

  it("puts the logo at the root of the site, also when the address has a path", () => {
    expect(storeBranding(maskerade, " https://testshop-maskerade.vercel.app/shop/ ")).toMatchObject({
      url: "https://testshop-maskerade.vercel.app/shop/",
      logo: "https://testshop-maskerade.vercel.app/email-logo.png",
    });
  });

  it("uses the default action colour for a brand without its own", () => {
    expect(storeBranding({ ...maskerade, theme: {} }, "https://piece.dk").color).toBe(DEFAULT_EMAIL_COLOR);
    expect(DEFAULT_EMAIL_COLOR).toBe("#1d1b19");
  });

  it("leaves out the address and logo without a usable site URL", () => {
    for (const siteUrl of [undefined, "", "piece.dk", "ftp://piece.dk", "https://"]) {
      const branding = storeBranding(maskerade, siteUrl);
      expect(branding).toEqual({ name: "Halloweenkostumer.dk", email: "kundeservice@halloweenkostumer.dk", color: "#5b2b82" });
    }
  });

  it("defaults to this storefront's brand", () => {
    expect(storeBranding()).toMatchObject({ name: storeConfig.name, email: storeConfig.supportEmail });
  });
});
