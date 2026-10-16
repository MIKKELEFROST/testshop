import { describe, expect, it } from "vitest";
import { company } from "@/config/company";
import { storeConfig } from "@/config/store";
import { DEFAULT_EMAIL_COLOR, RETURN_DAYS, storeBranding } from "./branding";

const maskerade = { name: "Halloweenkostumer.dk", supportEmail: "hej@halloweenkostumer.dk", theme: { action: "#5b2b82" } };
const seller = {
  name: "Kostumer ApS",
  address: "Testvej 1, 8000 Aarhus C",
  cvr: "12345678",
  returnAddress: "Kostumer ApS, Returvej 2, 8000 Aarhus C",
  returnShipping: "Du betaler selv returfragten.",
};
const sellerFields = {
  company_name: "Kostumer ApS",
  company_address: "Testvej 1, 8000 Aarhus C",
  cvr: "12345678",
  return_address: "Kostumer ApS, Returvej 2, 8000 Aarhus C",
  return_shipping: "Du betaler selv returfragten.",
  return_days: 30,
};

describe("storeBranding", () => {
  it("sends the brand's name, e-mail, colour, address and the logo on the storefront", () => {
    expect(storeBranding(maskerade, "https://halloweenkostumer.dk", seller)).toEqual({
      name: "Halloweenkostumer.dk",
      url: "https://halloweenkostumer.dk",
      email: "hej@halloweenkostumer.dk",
      color: "#5b2b82",
      logo: "https://halloweenkostumer.dk/email-logo.png",
      ...sellerFields,
    });
  });

  it("sends the seller and the return rules for the withdrawal information in the order confirmation", () => {
    expect(RETURN_DAYS).toBe(30);
    // The company's details as configured, placeholders included.
    expect(storeBranding()).toMatchObject({
      company_name: company.name,
      company_address: company.address,
      cvr: company.cvr,
      return_address: company.returnAddress,
      return_shipping: company.returnShipping,
      return_days: RETURN_DAYS,
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
      const branding = storeBranding(maskerade, siteUrl, seller);
      expect(branding).toEqual({ name: "Halloweenkostumer.dk", email: "hej@halloweenkostumer.dk", color: "#5b2b82", ...sellerFields });
    }
  });

  it("defaults to this storefront's brand", () => {
    expect(storeBranding()).toMatchObject({ name: storeConfig.name, email: storeConfig.supportEmail });
  });
});
