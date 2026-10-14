"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-shop py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Noget gik galt</h1>
      <p className="mt-3 text-muted">Siden kunne ikke vises. Prøv igen om et øjeblik.</p>
      <div className="mt-8">
        <Button onClick={reset}>Prøv igen</Button>
      </div>
    </div>
  );
}
