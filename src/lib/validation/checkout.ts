import { z } from "zod";
import { storeConfig } from "@/config/store";

/**
 * Input validation shared by the browser (instant feedback) and the server (authoritative).
 * Nothing price-related is accepted from the client except the total the customer saw,
 * which is only used to detect changes — never to charge.
 */

const countryCodes = storeConfig.countries.map((c) => c.code) as [string, ...string[]];

export const cartLineSchema = z.object({
  productId: z.number().int().positive(),
  variationId: z.number().int().nonnegative().default(0),
  quantity: z.number().int().min(1).max(99),
});

export const cartLinesSchema = z.array(cartLineSchema).min(1, { error: "Kurven er tom." }).max(50);

const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `${label} skal udfyldes.` })
    .max(max, { error: `${label} er for lang.` });

export const postcodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, { error: "Postnummeret skal være 4 cifre." });

export const addressSchema = z.object({
  firstName: text(100, "Fornavn"),
  lastName: text(100, "Efternavn"),
  company: z.string().trim().max(100).optional().default(""),
  address1: text(200, "Adresse"),
  address2: z.string().trim().max(200).optional().default(""),
  postcode: postcodeSchema,
  city: text(100, "By"),
  country: z.enum(countryCodes, { error: "Vi leverer ikke til det valgte land." }),
});

export const contactSchema = z.object({
  email: z.email({ error: "Indtast en gyldig e-mailadresse." }).max(200),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^(\+?[\d\s()-]{8,20})?$/, { error: "Indtast et gyldigt telefonnummer." })
    .optional()
    .default(""),
});

export const quoteRequestSchema = z.object({
  items: cartLinesSchema,
  address: z
    .object({
      country: z.enum(countryCodes).optional(),
      postcode: z.string().trim().max(10).optional(),
      city: z.string().trim().max(100).optional(),
      address1: z.string().trim().max(200).optional(),
    })
    .optional()
    .default({}),
  shippingRateId: z
    .string()
    .regex(/^[a-z0-9_-]+(:[a-z0-9_-]+)*$/i)
    .max(100)
    .nullable()
    .optional(),
});

export const checkoutRequestSchema = z
  .object({
    items: cartLinesSchema,
    contact: contactSchema,
    shipping: addressSchema,
    billingSameAsShipping: z.boolean().default(true),
    billing: addressSchema.optional(),
    shippingRateId: z
      .string()
      .regex(/^[a-z0-9_-]+(:[a-z0-9_-]+)*$/i)
      .max(100)
      .nullable(),
    /** The total shown to the customer. Used only to detect price changes. */
    expectedTotal: z.string().regex(/^\d{1,9}(\.\d{1,4})?$/),
    customerNote: z.string().trim().max(500).optional().default(""),
  })
  .refine((value) => value.billingSameAsShipping || value.billing !== undefined, {
    error: "Faktureringsadressen mangler.",
    path: ["billing"],
  });

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type AddressFormValues = z.input<typeof addressSchema>;
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/** Flatten Zod issues to `{ "shipping.postcode": "message" }` for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}
