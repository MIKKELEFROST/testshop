import { z } from "zod";

/** Zod schemas for the parts of WooCommerce REST API v3 responses we rely on. */

const decimalOrEmpty = z.string().default("");
const nullableDecimal = z.string().nullable().optional();

export const wcImageSchema = z.object({
  id: z.number().optional(),
  src: z.string(),
  alt: z.string().default(""),
  name: z.string().optional(),
});

export const wcHeadlessPricesSchema = z
  .object({
    tax_display: z.string().optional(),
    price: nullableDecimal,
    regular_price: nullableDecimal,
    sale_price: nullableDecimal,
    min_price: nullableDecimal,
    max_price: nullableDecimal,
  })
  .optional();

export const wcProductSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  type: z.string(),
  status: z.string(),
  description: z.string().default(""),
  short_description: z.string().default(""),
  sku: z.string().default(""),
  price: decimalOrEmpty,
  regular_price: decimalOrEmpty,
  sale_price: decimalOrEmpty,
  on_sale: z.boolean().default(false),
  purchasable: z.boolean().default(false),
  manage_stock: z.union([z.boolean(), z.literal("parent")]).default(false),
  stock_quantity: z.number().nullable().default(null),
  stock_status: z.string().default("instock"),
  backorders_allowed: z.boolean().default(false),
  categories: z.array(z.object({ id: z.number(), name: z.string(), slug: z.string() })).default([]),
  images: z.array(wcImageSchema).default([]),
  attributes: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        slug: z.string().optional(),
        variation: z.boolean().default(false),
        visible: z.boolean().default(true),
        options: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  variations: z.array(z.number()).default([]),
  headless_prices: wcHeadlessPricesSchema,
});

export const wcVariationSchema = z.object({
  id: z.number(),
  sku: z.string().default(""),
  status: z.string().default("publish"),
  price: decimalOrEmpty,
  regular_price: decimalOrEmpty,
  sale_price: decimalOrEmpty,
  on_sale: z.boolean().default(false),
  purchasable: z.boolean().default(false),
  manage_stock: z.union([z.boolean(), z.literal("parent")]).default(false),
  stock_quantity: z.number().nullable().default(null),
  stock_status: z.string().default("instock"),
  backorders_allowed: z.boolean().default(false),
  image: wcImageSchema.nullable().optional(),
  attributes: z.array(z.object({ id: z.number(), name: z.string(), slug: z.string().optional(), option: z.string() })).default([]),
  headless_prices: wcHeadlessPricesSchema,
});

export const wcCategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  parent: z.number().default(0),
  description: z.string().default(""),
  count: z.number().default(0),
  image: wcImageSchema.nullable().optional(),
});

export type WcProduct = z.infer<typeof wcProductSchema>;
export type WcVariation = z.infer<typeof wcVariationSchema>;
export type WcCategory = z.infer<typeof wcCategorySchema>;

/* ---------- Headless Checkout Bridge plugin (wc-headless/v1) ---------- */

const money = z.string().regex(/^-?\d+(\.\d+)?$/);

export const quoteErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  product_id: z.number(),
  variation_id: z.number(),
  available: z.number().nullable().optional(),
});

export const quoteSchema = z.object({
  currency: z.string(),
  price_decimals: z.number(),
  prices_include_tax: z.boolean(),
  tax_display_cart: z.string(),
  items: z.array(
    z.object({
      key: z.string(),
      product_id: z.number(),
      variation_id: z.number(),
      name: z.string(),
      sku: z.string(),
      quantity: z.number(),
      unit_price: money,
      line_subtotal: money,
      line_subtotal_tax: money,
      line_total: money,
      line_tax: money,
      stock_quantity: z.number().nullable(),
      stock_status: z.string(),
    }),
  ),
  needs_shipping: z.boolean(),
  shipping_rates: z.array(
    z.object({
      id: z.string(),
      method_id: z.string(),
      instance_id: z.number(),
      label: z.string(),
      cost: money,
      tax: money,
    }),
  ),
  shipping_rate_id: z.string().nullable(),
  totals: z.object({
    subtotal: money,
    subtotal_tax: money,
    discount: money,
    shipping: money,
    shipping_tax: money,
    fees: money,
    tax: money,
    total: money,
  }),
  errors: z.array(quoteErrorSchema),
  cart_hash: z.string(),
});

export const orderSummarySchema = z.object({
  id: z.number(),
  number: z.string(),
  order_key: z.string(),
  status: z.string(),
  currency: z.string(),
  total: money,
  total_tax: money,
  shipping_total: money,
  needs_payment: z.boolean(),
  payment_intent_id: z.string().nullable(),
  email: z.string(),
  items: z.array(
    z.object({
      product_id: z.number(),
      variation_id: z.number(),
      name: z.string(),
      quantity: z.number(),
      total: money,
    }),
  ),
});

export const orderDetailsSchema = orderSummarySchema.extend({
  shipping_address: z.object({
    first_name: z.string(),
    last_name: z.string(),
    address_1: z.string(),
    address_2: z.string(),
    postcode: z.string(),
    city: z.string(),
    country: z.string(),
  }),
  shipping_method: z.string(),
  subtotal: money,
  discount_total: money,
  date_paid: z.string().nullable(),
});

/** Every plugin response is either a result or an error object; both are JSON. */
export const pluginResponseSchema = z.object({
  result: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  order: orderSummarySchema.optional(),
  quote: quoteSchema.optional(),
  payment_intent_id: z.string().optional(),
  previous_payment_intent_id: z.string().nullable().optional(),
});

export type WcQuote = z.infer<typeof quoteSchema>;
export type WcOrderSummary = z.infer<typeof orderSummarySchema>;
export type WcOrderDetails = z.infer<typeof orderDetailsSchema>;
export type PluginResponse = z.infer<typeof pluginResponseSchema>;
