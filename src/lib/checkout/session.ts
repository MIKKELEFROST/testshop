import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Checkout session ID: an opaque random token in an httpOnly cookie. WooCommerce keeps
 * exactly one order per session ID, which is what makes "Betal" idempotent across double
 * clicks, retries and page reloads. It is rotated once an order has been paid.
 */

const isProd = process.env.NODE_ENV === "production";
const COOKIE_NAME = isProd ? "__Host-checkout" : "checkout_session";
const VALID = /^[A-Za-z0-9_-]{16,64}$/;

export async function readCheckoutId(): Promise<string | undefined> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  return value && VALID.test(value) ? value : undefined;
}

export async function ensureCheckoutId(): Promise<string> {
  return (await readCheckoutId()) ?? (await rotateCheckoutId());
}

export async function rotateCheckoutId(): Promise<string> {
  const id = randomBytes(24).toString("base64url");
  (await cookies()).set(COOKIE_NAME, id, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 2,
  });
  return id;
}
