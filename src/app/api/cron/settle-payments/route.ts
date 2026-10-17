import { timingSafeEqual } from "node:crypto";
import { settleDeps } from "@/lib/checkout/deps";
import { runSettleSweep } from "@/lib/checkout/settle";
import { ConfigError, cronEnv } from "@/lib/env";
import { describeError } from "@/lib/log";

/**
 * GET /api/cron/settle-payments — Vercel Cron Job (vercel.json, daily), the safety net for capture
 * at shipment: captures sent orders and releases cancelled ones that WordPress could not report
 * (e.g. the storefront was unreachable), and lets the plugin warn about reservations that are
 * more than five days old. Vercel sends `Authorization: Bearer $CRON_SECRET`; without the
 * variable nothing runs. Can also be called by hand with the same header.
 */

export const maxDuration = 60;

/** Stop starting new orders after this long, so the run ends within maxDuration; the rest waits for the next run. */
const BUDGET_MS = 45_000;

export async function GET(request: Request) {
  // Read first: a GET handler that reads no request data is prerendered at build time (Cache Components).
  const given = Buffer.from(request.headers.get("authorization") ?? "");

  let secret: string;
  try {
    secret = cronEnv().CRON_SECRET;
  } catch (error) {
    if (error instanceof ConfigError) console.error("[cron] configuration:", error.message);
    return Response.json({ error: "not configured" }, { status: 503 });
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSettleSweep(settleDeps(), Date.now() + BUDGET_MS);
    if (result.failed > 0 || result.skipped > 0) console.error("[cron] settle-payments:", JSON.stringify(result));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron] settle-payments failed:", describeError(error));
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
