/**
 * A loggable description of an error: its message plus its chain of underlying causes
 * (e.g. Stripe's generic "connection" error wraps the real network/header error in
 * `detail`; fetch's "fetch failed" wraps the socket error in `cause`). Only messages and
 * error codes are included, never request data or credentials.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const parts = [error.message];
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    const next: unknown = (current as { detail?: unknown }).detail ?? (current as { cause?: unknown }).cause;
    if (!(next instanceof Error)) break;
    const code = (next as { code?: unknown }).code;
    const text = typeof code === "string" && !next.message.includes(code) ? `${next.message} [${code}]` : next.message;
    if (!parts.includes(text)) parts.push(text);
    current = next;
  }
  return parts.length === 1 ? parts[0] : `${parts[0]} (cause: ${parts.slice(1).join(" <- ")})`;
}
