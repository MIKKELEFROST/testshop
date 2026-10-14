/**
 * Small fixed-window rate limiter.
 *
 * In-memory: limits apply per server instance. That is enough to stop accidental loops and
 * naive abuse in the prototype; for production traffic put a shared store (e.g. Upstash
 * Redis) or the Vercel Firewall's rate limiting in front of the same `check` interface.
 */
export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const maxKeys = options.maxKeys ?? 10_000;

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        if (hits.size >= maxKeys) {
          for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
          if (hits.size >= maxKeys) hits.delete(hits.keys().next().value as string);
        }
        entry = { count: 0, resetAt: now + options.windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= options.limit,
        remaining: Math.max(0, options.limit - entry.count),
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
      };
    },
  };
}
