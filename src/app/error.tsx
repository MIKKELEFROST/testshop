"use client";

import { Button } from "@/components/ui/button";

/**
 * A page that failed. "Prøv igen" uses `retry()`, which fetches the page from the server again
 * (Next.js 16.3+); `reset()` would only render the same failure again.
 */
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="container-shop py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Noget gik galt</h1>
      <p className="mt-3 text-muted">Siden kunne ikke vises. Prøv igen om et øjeblik.</p>
      <div className="mt-8">
        <Button onClick={() => retry()}>Prøv igen</Button>
      </div>
    </div>
  );
}
