import "server-only";
import { z } from "zod";

/**
 * Server-side configuration. Validated lazily (on first use) so `next build` can run
 * without secrets, and so a missing variable produces a clear error naming the variable
 * — never its value.
 *
 * Values are trimmed: a key pasted with a trailing newline would otherwise end up in an
 * HTTP header and fail every request with an opaque connection error.
 */

const wooSchema = z.object({
  WOOCOMMERCE_URL: z.string().trim().pipe(z.url()).transform((url) => url.replace(/\/+$/, "")),
  WOOCOMMERCE_CONSUMER_KEY: z.string().trim().startsWith("ck_"),
  WOOCOMMERCE_CONSUMER_SECRET: z.string().trim().startsWith("cs_"),
  WOOCOMMERCE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
});

const stripeSchema = z.object({
  STRIPE_SECRET_KEY: z.string().trim().regex(/^(sk|rk)_(test|live)_/),
});

const webhookSchema = z.object({
  STRIPE_WEBHOOK_SECRET: z.string().trim().startsWith("whsec_"),
});

export class ConfigError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Missing or invalid environment variables: ${variables.join(", ")}`);
    this.name = "ConfigError";
  }
}

function parse<T extends z.ZodType>(schema: T): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new ConfigError([...new Set(result.error.issues.map((issue) => String(issue.path[0])))]);
  }
  return result.data;
}

let woo: z.infer<typeof wooSchema> | undefined;
export function wooEnv() {
  woo ??= parse(wooSchema);
  return woo;
}

let stripe: z.infer<typeof stripeSchema> | undefined;
export function stripeEnv() {
  stripe ??= parse(stripeSchema);
  return stripe;
}

let webhook: z.infer<typeof webhookSchema> | undefined;
export function stripeWebhookEnv() {
  webhook ??= parse(webhookSchema);
  return webhook;
}

export function isProduction() {
  return process.env.NODE_ENV === "production";
}
