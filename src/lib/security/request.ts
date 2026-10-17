import type { RateLimitResult } from "./rate-limit";

/**
 * Helpers for API route hardening: same-origin enforcement (CSRF), JSON-only bodies,
 * client IP extraction and uniform error responses that never leak internals.
 */

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Browsers always send `Origin` on cross-origin POSTs. Reject those; requests without
 * Origin (server-to-server, curl) cannot ride on a customer's cookies anyway.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  const allowed = new Set([host]);
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    try {
      allowed.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).host);
    } catch {
      // ignore malformed config
    }
  }
  return allowed.has(originHost);
}

export function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ code, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export function rateLimited(result: RateLimitResult) {
  return Response.json(
    { code: "rate_limited", message: "For mange forsøg. Vent et øjeblik og prøv igen." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}

/** Parse a JSON body with a size cap. Returns undefined for invalid/oversized bodies. */
export async function readJson(request: Request, maxBytes = 32_768): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return undefined;
  const text = await request.text();
  if (text.length > maxBytes) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
