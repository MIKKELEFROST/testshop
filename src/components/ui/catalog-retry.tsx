"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { catalogRetryDelay } from "@/lib/catalog-retry";
import { Alert } from "./alert";
import { Button } from "./button";
import { Spinner } from "./spinner";

/**
 * Where a page's products would be when WooCommerce couldn't be read and nothing was cached.
 * Such a failure is never cached, so instead of a dead end the page asks the server again by
 * itself (router.refresh, see lib/catalog-retry.ts) and shows the products as soon as they
 * come: this component is then no longer rendered. A refresh also replaces a copy of the
 * failed page in the browser's router cache. After the last try: `message` and "Prøv igen".
 *
 * Search engines get `noindex` on such a page (see the pages' generateMetadata).
 */
export function CatalogRetry({ loading, message }: { loading: string; message: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [pending, startTransition] = useTransition();
  const delay = catalogRetryDelay(attempt);

  useEffect(() => {
    // One refresh at a time: the next pause starts when the last answer is in.
    if (delay === null || pending) return;
    const timer = setTimeout(() => {
      setAttempt((n) => n + 1);
      startTransition(() => router.refresh());
    }, delay);
    return () => clearTimeout(timer);
  }, [delay, pending, router]);

  if (delay === null) {
    return (
      <Alert tone="warning">
        <p>{message}</p>
        <Button className="mt-3" size="sm" variant="secondary" loading={pending} onClick={() => startTransition(() => router.refresh())}>
          Prøv igen
        </Button>
      </Alert>
    );
  }
  return (
    <div role="status" className="flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3 text-sm text-ink">
      <Spinner className="mt-0.5 size-4 shrink-0 text-muted" />
      <div>
        <p className="font-medium">{loading}</p>
        <p className="mt-0.5 text-muted">Det tager lidt længere end normalt. Siden prøver igen af sig selv.</p>
        <noscript>
          <p className="mt-0.5 text-muted">Opdatér siden om lidt.</p>
        </noscript>
      </div>
    </div>
  );
}
