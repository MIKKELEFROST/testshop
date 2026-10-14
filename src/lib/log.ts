/**
 * A loggable description of an error: its message plus the underlying cause, if any
 * (e.g. Stripe's generic "connection" error wraps the real network/header error in
 * `detail`). Only messages are included, never request data or credentials.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const cause = (error as { detail?: unknown }).detail ?? error.cause;
  return cause instanceof Error && cause.message !== error.message ? `${error.message} (cause: ${cause.message})` : error.message;
}
